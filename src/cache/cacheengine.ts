import { ICache } from '@api/abstract/abstract.cache';
import { CacheConf, ConfigService } from '@config/env.config';
import { Logger } from '@config/logger.config';

import { LocalCache } from './localcache';
import { RedisCache } from './rediscache';
import { redisClient } from './rediscache.client';

const logger = new Logger('CacheEngine');

export class CacheEngine {
  private engine: ICache;

  constructor(
    private readonly configService: ConfigService,
    module: string,
  ) {
    const cacheConf = configService.get<CacheConf>('CACHE');
    // Se CACHE_TYPE não estiver definido, usa lógica de fallback baseada nas configurações
    let cacheType = cacheConf?.TYPE;
    if (!cacheType) {
      // Compatibilidade: se Redis estiver habilitado e URI configurada, usa Redis
      if (cacheConf?.REDIS?.ENABLED && cacheConf?.REDIS?.URI && cacheConf.REDIS.URI !== '') {
        cacheType = 'redis';
      } else {
        cacheType = 'local';
      }
    }

    if (cacheType === 'redis') {
      if (!cacheConf?.REDIS?.ENABLED) {
        const error = new Error(
          `CACHE_TYPE=redis but CACHE_REDIS_ENABLED is not true. Redis cache is required but not enabled.`,
        );
        logger.error(error.message);
        throw error;
      }

      if (!cacheConf?.REDIS?.URI || cacheConf.REDIS.URI === '') {
        const error = new Error(
          `CACHE_TYPE=redis but CACHE_REDIS_URI is empty. Redis cache is required but URI is not configured.`,
        );
        logger.error(error.message);
        throw error;
      }

      logger.verbose(`Initializing RedisCache for ${module} (CACHE_TYPE=redis)`);
      this.engine = new RedisCache(configService, module);

      const client = redisClient.getConnection();
      if (!client) {
        const error = new Error(
          `Failed to initialize Redis client for ${module}. Redis connection is required when CACHE_TYPE=redis.`,
        );
        logger.error(error.message);
        throw error;
      }

      // Verificar conexão Redis de forma assíncrona (fail-fast)
      // Como o construtor é síncrono, verificamos após um pequeno delay
      setTimeout(async () => {
        try {
          const isConnected = await redisClient.waitForConnection(5000);
          if (!isConnected) {
            const errorMsg = `Redis connection failed for ${module}. CACHE_TYPE=redis requires a working Redis connection. Application will exit.`;
            logger.error(errorMsg);
            logger.error('Please check your Redis configuration and ensure Redis is running and accessible.');
            process.exit(1);
          } else {
            logger.verbose(`RedisCache successfully initialized and connected for ${module}`);
          }
        } catch (error) {
          const errorMsg = `Redis connection error for ${module}: ${error.message}. CACHE_TYPE=redis requires a working Redis connection. Application will exit.`;
          logger.error(errorMsg);
          process.exit(1);
        }
      }, 100);
    } else if (cacheType === 'local') {
      if (!cacheConf?.LOCAL?.ENABLED) {
        logger.warn(`CACHE_TYPE=local but CACHE_LOCAL_ENABLED is not true. Cache will be disabled for ${module}.`);
        this.engine = null;
        return;
      }

      logger.verbose(`LocalCache initialized for ${module}`);
      this.engine = new LocalCache(configService, module);
    } else {
      logger.warn(`Unknown CACHE_TYPE=${cacheType}. Cache will be disabled for ${module}.`);
      this.engine = null;
    }
  }

  public getEngine() {
    return this.engine;
  }
}
