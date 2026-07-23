import { config } from '../config';
import {
  RateLimitStoreUnavailableError,
  sendRateLimitRedisCommand,
} from './rateLimitInfrastructure';

export class AuthenticatedRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Too many authenticated seller actions. Try again later.');
    this.name = 'AuthenticatedRateLimitError';
  }
}

type FixedWindowLimiterOptions = {
  windowMs: number;
  max: number;
  maxKeys?: number;
  now?: () => number;
};

type WindowEntry = {
  count: number;
  resetAt: number;
};

type KeyLimiter = {
  consume(rawKey: string): void | Promise<void>;
};

export class FixedWindowKeyLimiter {
  private readonly entries = new Map<string, WindowEntry>();
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(private readonly options: FixedWindowLimiterOptions) {
    if (options.windowMs <= 0 || options.max <= 0) {
      throw new Error('Authenticated limiter window and max must be positive');
    }
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  consume(rawKey: string) {
    const key = rawKey.trim().toLowerCase();
    if (!key) throw new Error('Authenticated limiter key is required');

    const now = this.now();
    const current = this.entries.get(key);
    if (current && current.resetAt > now) {
      if (current.count >= this.options.max) {
        throw new AuthenticatedRateLimitError(Math.max(1, Math.ceil((current.resetAt - now) / 1000)));
      }
      current.count += 1;
      return;
    }

    if (current) this.entries.delete(key);
    if (this.entries.size >= this.maxKeys) {
      for (const [entryKey, entry] of this.entries) {
        if (entry.resetAt <= now) this.entries.delete(entryKey);
      }
    }
    if (this.entries.size >= this.maxKeys) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey) this.entries.delete(oldestKey);
    }

    this.entries.set(key, { count: 1, resetAt: now + this.options.windowMs });
  }
}

type RedisFixedWindowKeyLimiterOptions = {
  windowMs: number;
  max: number;
  prefix: string;
  sendCommand?: typeof sendRateLimitRedisCommand;
};

const incrementFixedWindowScript = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export class RedisFixedWindowKeyLimiter implements KeyLimiter {
  private readonly sendCommand: typeof sendRateLimitRedisCommand;

  constructor(private readonly options: RedisFixedWindowKeyLimiterOptions) {
    if (options.windowMs <= 0 || options.max <= 0) {
      throw new Error('Authenticated limiter window and max must be positive');
    }
    this.sendCommand = options.sendCommand ?? sendRateLimitRedisCommand;
  }

  async consume(rawKey: string) {
    const normalizedKey = rawKey.trim().toLowerCase();
    if (!normalizedKey) throw new Error('Authenticated limiter key is required');

    let reply;
    try {
      reply = await this.sendCommand(
        'EVAL',
        incrementFixedWindowScript,
        '1',
        `${this.options.prefix}${normalizedKey}`,
        String(this.options.windowMs)
      );
    } catch {
      throw new RateLimitStoreUnavailableError();
    }

    if (!Array.isArray(reply) || reply.length !== 2) {
      throw new RateLimitStoreUnavailableError();
    }
    const count = Number(reply[0]);
    const ttlMs = Number(reply[1]);
    if (!Number.isFinite(count) || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RateLimitStoreUnavailableError();
    }
    if (count > this.options.max) {
      throw new AuthenticatedRateLimitError(Math.max(1, Math.ceil(ttlMs / 1000)));
    }
  }
}

const sellerWalletLimiter: KeyLimiter = config.RATE_LIMIT_STORE === 'redis'
  ? new RedisFixedWindowKeyLimiter({
      windowMs: 60 * 60 * 1000,
      max: 120,
      prefix: 'ifr-benefits:seller-wallet:',
    })
  : new FixedWindowKeyLimiter({
      windowMs: 60 * 60 * 1000,
      max: 120,
    });

export async function assertSellerWalletActionAllowed(walletAddress: string) {
  await sellerWalletLimiter.consume(`seller:${walletAddress}`);
}
