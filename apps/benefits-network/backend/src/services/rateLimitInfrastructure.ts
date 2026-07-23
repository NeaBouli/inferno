import type {
  ClientRateLimitInfo,
  IncrementResponse,
  Options,
  Store,
} from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { createClient } from 'redis';
import { config } from '../config';

export class RateLimitStoreUnavailableError extends Error {
  constructor() {
    super('Rate limit service is temporarily unavailable.');
    this.name = 'RateLimitStoreUnavailableError';
  }
}

type RedisClient = ReturnType<typeof createClient>;

let redisClient: RedisClient | undefined;
let redisConnectPromise: Promise<void> | undefined;

function getRedisClient() {
  if (redisClient) return redisClient;
  if (!config.RATE_LIMIT_REDIS_URL) throw new RateLimitStoreUnavailableError();

  redisClient = createClient({
    url: config.RATE_LIMIT_REDIS_URL,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: (retries) => (
        retries >= 5
          ? new Error('Rate limit Redis reconnect attempts exhausted')
          : Math.min(100 * (2 ** retries), 1_000)
      ),
    },
  });
  redisClient.on('error', (error) => {
    console.error('Rate limit Redis error:', error instanceof Error ? error.message : 'unknown error');
  });
  return redisClient;
}

export async function initializeRateLimitInfrastructure() {
  if (config.RATE_LIMIT_STORE !== 'redis') return;
  const client = getRedisClient();
  if (!redisConnectPromise) {
    redisConnectPromise = (async () => {
      if (!client.isOpen) await client.connect();
      await client.ping();
    })();
  }
  await redisConnectPromise;
}

export async function sendRateLimitRedisCommand(...args: string[]): Promise<RedisReply> {
  try {
    await initializeRateLimitInfrastructure();
    const client = getRedisClient();
    if (!client.isReady) throw new RateLimitStoreUnavailableError();
    return await client.sendCommand(args) as RedisReply;
  } catch (error) {
    if (error instanceof RateLimitStoreUnavailableError) throw error;
    throw new RateLimitStoreUnavailableError();
  }
}

class LazyRedisRateLimitStore implements Store {
  private inner: RedisStore | undefined;
  private options: Options | undefined;

  constructor(private readonly keyPrefix: string) {}

  init(options: Options) {
    this.options = options;
  }

  private store() {
    if (!this.options) throw new RateLimitStoreUnavailableError();
    if (!this.inner) {
      this.inner = new RedisStore({
        prefix: `ifr-benefits:${this.keyPrefix}:`,
        sendCommand: sendRateLimitRedisCommand,
      });
      this.inner.init(this.options);
    }
    return this.inner;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    try {
      return await this.store().get(key);
    } catch {
      throw new RateLimitStoreUnavailableError();
    }
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      return await this.store().increment(key);
    } catch {
      throw new RateLimitStoreUnavailableError();
    }
  }

  async decrement(key: string) {
    try {
      await this.store().decrement(key);
    } catch {
      throw new RateLimitStoreUnavailableError();
    }
  }

  async resetKey(key: string) {
    try {
      await this.store().resetKey(key);
    } catch {
      throw new RateLimitStoreUnavailableError();
    }
  }
}

export function createPublicRateLimitStore(prefix: string): Store | undefined {
  return config.RATE_LIMIT_STORE === 'redis'
    ? new LazyRedisRateLimitStore(prefix)
    : undefined;
}

export async function isRateLimitInfrastructureReady() {
  if (config.RATE_LIMIT_STORE !== 'redis') return true;
  try {
    const client = getRedisClient();
    return client.isReady && await client.ping() === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRateLimitInfrastructure() {
  if (!redisClient?.isOpen) return;
  await redisClient.quit();
}
