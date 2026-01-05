import { CacheConf, CacheConfRedis, configService } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { createClient, RedisClientType } from 'redis';

class Redis {
  private logger = new Logger('Redis');
  private client: RedisClientType = null;
  private conf: CacheConfRedis;
  private connected = false;
  private connectionPromise: Promise<void> = null;

  constructor() {
    this.conf = configService.get<CacheConf>('CACHE')?.REDIS;
  }

  async waitForConnection(timeout: number = 5000): Promise<boolean> {
    if (this.connected) {
      return true;
    }

    if (!this.connectionPromise) {
      return false;
    }

    try {
      await Promise.race([
        this.connectionPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout)),
      ]);
      return this.connected;
    } catch (error) {
      this.logger.error(`Redis connection wait failed: ${error.message}`);
      return false;
    }
  }

  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  getConnection(): RedisClientType {
    if (this.connected && this.client) {
      return this.client;
    }

    if (this.client && !this.connected) {
      return this.client;
    }

    this.client = createClient({
      url: this.conf.URI,
    });

    this.client.on('connect', () => {
      this.logger.verbose('redis connecting');
    });

    this.client.on('ready', () => {
      this.logger.verbose('redis ready');
      this.logger.verbose('redis connected');
      this.connected = true;
    });

    this.client.on('error', (error) => {
      const errorMsg = error?.message || error?.toString() || 'Unknown error';
      this.logger.error(`redis disconnected: ${errorMsg}`);
      if (error?.stack) {
        this.logger.error(`redis error stack: ${error.stack}`);
      }
      this.connected = false;
    });

    this.client.on('end', () => {
      this.logger.verbose('redis connection ended');
      this.connected = false;
    });

    this.connectionPromise = (async () => {
      try {
        this.logger.verbose(`Attempting to connect to Redis at: ${this.conf?.URI ? this.conf.URI.replace(/:[^:@]+@/, ':****@') : 'URI not configured'}`);
        await this.client.connect();
        this.connected = true;
        this.logger.verbose('Redis connection established successfully');
      } catch (e) {
        this.connected = false;
        const errorMsg = e?.message || e?.toString() || 'Unknown connection error';
        this.logger.error(`redis connect exception caught: ${errorMsg}`);
        if (e?.stack) {
          this.logger.error(`redis connect stack: ${e.stack}`);
        }
        throw e;
      }
    })();

    return this.client;
  }
}

export const redisClient = new Redis();
