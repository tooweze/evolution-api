# Investigação: Problema de Geração de QR Code na Evolution API

## 🔍 Resumo Executivo

**CAUSA RAIZ IDENTIFICADA**: Você está criando a instância com `integration: "EVOLUTION"` quando deveria usar `integration: "WHATSAPP_BAILEYS"`.

A integração `EVOLUTION` é para um caso de uso diferente e **não gera QR code**.

## 📋 Análise Detalhada do Problema

### O que acontece quando você usa `integration: "EVOLUTION"`

1. **Na criação da instância** (`saveInstance` em `monitor.service.ts` linha 251-252):

```typescript
connectionStatus:
  data.integration && data.integration === Integration.WHATSAPP_BAILEYS 
    ? 'close' 
    : (data.status ?? 'open'),
```

- Se `integration: "EVOLUTION"` → `connectionStatus = 'open'`
- Se `integration: "WHATSAPP_BAILEYS"` → `connectionStatus = 'close'`

2. **Quando você chama `/instance/connect`** (`instance.controller.ts` linhas 309-343):

```typescript
public async connectToWhatsapp({ instanceName, number = null }: InstanceDto) {
  const instance = this.waMonitor.waInstances[instanceName];
  const state = instance?.connectionStatus?.state;

  if (state == 'open') {
    // ⚠️ Com EVOLUTION, entra aqui porque state = 'open'
    return await this.connectionState({ instanceName });
  }

  if (state == 'close') {
    // ✅ Com WHATSAPP_BAILEYS, entra aqui e gera QR code
    await instance.connectToWhatsapp(number);
    await delay(2000);
    return instance.qrCode;
  }
  // ...
}
```

**Com `EVOLUTION`**: O estado inicial é `'open'`, então o código retorna apenas `connectionState` (objeto vazio ou estado).

**Com `WHATSAPP_BAILEYS`**: O estado inicial é `'close'`, então chama `connectToWhatsapp()` que gera QR code.

3. **O serviço `EvolutionStartupService`** (`evolution.channel.service.ts` linhas 43-128):

```typescript
export class EvolutionStartupService extends ChannelStartupService {
  // Estado SEMPRE inicializado como 'open'
  public stateConnection: wa.StateConnection = { state: 'open' };

  public async connectToWhatsapp(data?: any): Promise<any> {
    if (!data) {
      this.loadChatwoot();
      return;  // ⚠️ Não faz nada sem data!
    }
    // eventHandler para processar webhooks de OUTRA API
  }
}
```

A integração `EVOLUTION` foi projetada para **receber eventos de outra Evolution API**, não para conectar diretamente ao WhatsApp.

### O que acontece quando você usa `integration: "WHATSAPP_BAILEYS"` (ou default)

1. `connectionStatus = 'close'`
2. Ao chamar `/connect`, o código entra no `if (state == 'close')`:
   - Chama `instance.connectToWhatsapp(number)`
   - O `BaileysStartupService` cria conexão com Baileys
   - Baileys emite evento com QR code
   - O método `connectionUpdate` processa o QR code
   - Chama `sendDataWebhook(Events.QRCODE_UPDATED, {...})` - **ENVIA WEBHOOK!**
   - Retorna QR code na resposta

## ✅ Solução

### Opção 1: Criar nova instância com integração correta

**DELETE** a instância atual e crie uma nova com `integration: "WHATSAPP_BAILEYS"` ou sem especificar (default):

```bash
# 1. Deletar instância atual
curl -X DELETE "https://evolution-api-production-fe0a.up.railway.app/instance/delete/INSTANCE_NAME" \
  -H "apikey: API_KEY"

# 2. Criar nova instância SEM especificar integration (usa default WHATSAPP_BAILEYS)
curl -X POST "https://evolution-api-production-fe0a.up.railway.app/instance/create" \
  -H "apikey: API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "INSTANCE_NAME"
  }'

# OU especificar explicitamente:
curl -X POST "https://evolution-api-production-fe0a.up.railway.app/instance/create" \
  -H "apikey: API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "INSTANCE_NAME",
    "integration": "WHATSAPP-BAILEYS"
  }'
```

### Opção 2: Configurar webhook e depois conectar

```bash
# 1. Criar instância (default = WHATSAPP_BAILEYS)
curl -X POST "https://evolution-api-production-fe0a.up.railway.app/instance/create" \
  -H "apikey: API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "INSTANCE_NAME"
  }'

# 2. Configurar webhook
curl -X POST "https://evolution-api-production-fe0a.up.railway.app/webhook/set/INSTANCE_NAME" \
  -H "apikey: API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://sua-url.ngrok-free.app/api/webhooks/whatsapp/evolution",
      "byEvents": false,
      "base64": false,
      "events": ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE"]
    }
  }'

# 3. Conectar (vai gerar QR code e enviar via webhook)
curl -X GET "https://evolution-api-production-fe0a.up.railway.app/instance/connect/INSTANCE_NAME" \
  -H "apikey: API_KEY"
```

## 📊 Comparação das Integrações

| Aspecto | `WHATSAPP_BAILEYS` | `EVOLUTION` |
|---------|-------------------|-------------|
| Estado inicial | `close` | `open` |
| Gera QR code | ✅ Sim | ❌ Não |
| Conecta ao WhatsApp | ✅ Direto via Baileys | ❌ Recebe de outra API |
| Caso de uso | Conexão direta | Proxy/agregador |
| Webhook QRCODE_UPDATED | ✅ Enviado | ❌ Nunca enviado |

## 🔧 Verificar Qual Integração Está Usando

```bash
curl -X GET "https://evolution-api-production-fe0a.up.railway.app/instance/fetchInstances?instanceName=INSTANCE_NAME" \
  -H "apikey: API_KEY"
```

A resposta mostrará:
- `"integration": "EVOLUTION"` → **PROBLEMA!** Precisa recriar
- `"integration": "WHATSAPP-BAILEYS"` → OK, verifique webhook

## 📝 Por Que o Endpoint Retorna `{}`?

Com `integration: "EVOLUTION"`:

1. `state` = `'open'` (sempre)
2. Código entra em `if (state == 'open') { return await this.connectionState({ instanceName }); }`
3. `connectionState` retorna:
```typescript
return {
  instance: {
    instanceName: instanceName,
    state: this.waMonitor.waInstances[instanceName]?.connectionStatus?.state,
  },
};
```

Se `state` for `undefined` ou houver problema, retorna `{}`.

## 📝 Por Que o Webhook Não É Enviado?

O webhook `QRCODE_UPDATED` só é enviado pelo `BaileysStartupService` quando há QR code:

```typescript
// whatsapp.baileys.service.ts linha 391-393
this.sendDataWebhook(Events.QRCODE_UPDATED, {
  qrcode: { instance: this.instance.name, pairingCode: this.instance.qrcode.pairingCode, code: qr, base64 },
});
```

Como `EvolutionStartupService` não gera QR code, nunca chama `sendDataWebhook(Events.QRCODE_UPDATED, ...)`.

## 🎯 Fluxo Correto Esperado

1. **Criar instância** com `integration: "WHATSAPP_BAILEYS"` (ou default)
2. **Configurar webhook** com evento `QRCODE_UPDATED`
3. **Chamar `/connect`**:
   - Estado inicial é `'close'`
   - Código chama `instance.connectToWhatsapp()`
   - Baileys inicia conexão
   - Baileys emite QR code
   - `connectionUpdate` processa QR code
   - `sendDataWebhook(Events.QRCODE_UPDATED, {...})` é chamado
   - Webhook é enviado para sua URL
   - QR code é retornado na resposta
4. **Usuário escaneia QR code**
5. **Webhook `CONNECTION_UPDATE`** é enviado com `state: 'open'`

## 📚 Referências no Código

- **Lógica de estado por integração**: `src/api/services/monitor.service.ts:251-252`
- **Controller connect**: `src/api/controllers/instance.controller.ts:309-343`
- **Serviço EVOLUTION**: `src/api/integrations/channel/evolution/evolution.channel.service.ts`
- **Serviço BAILEYS**: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts:334-417`
- **Webhook emit**: `src/api/integrations/event/webhook/webhook.controller.ts:57-200`
- **Tipos de integração**: `src/api/types/wa.types.ts:153-157`

