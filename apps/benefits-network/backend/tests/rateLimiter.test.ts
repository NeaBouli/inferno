jest.mock('../src/config', () => ({
  config: {
    RATE_LIMIT_STORE: 'memory',
  },
}));

import {
  AuthenticatedRateLimitError,
  FixedWindowKeyLimiter,
  RedisFixedWindowKeyLimiter,
} from '../src/services/authenticatedRateLimiter';
import { RateLimitStoreUnavailableError } from '../src/services/rateLimitInfrastructure';
import { getRateLimitTopologyIssues } from '../src/services/rateLimitTopology';

describe('Authenticated seller wallet limiter', () => {
  it('limits one normalized recovered-wallet key without affecting another wallet', () => {
    let now = 1_000;
    const limiter = new FixedWindowKeyLimiter({ windowMs: 10_000, max: 2, now: () => now });

    limiter.consume('seller:0xAbC');
    limiter.consume('SELLER:0xabc');
    expect(() => limiter.consume('seller:0xABC')).toThrow(AuthenticatedRateLimitError);
    expect(() => limiter.consume('seller:0xdef')).not.toThrow();

    now += 10_001;
    expect(() => limiter.consume('seller:0xabc')).not.toThrow();
  });

  it('reports a bounded retry time and evicts the oldest key when the store is full', () => {
    const limiter = new FixedWindowKeyLimiter({ windowMs: 5_000, max: 1, maxKeys: 1, now: () => 2_000 });

    limiter.consume('seller:wallet-a');
    expect(() => limiter.consume('seller:wallet-a')).toThrow(
      expect.objectContaining({ retryAfterSeconds: 5 })
    );
    expect(() => limiter.consume('seller:wallet-b')).not.toThrow();
    expect(() => limiter.consume('seller:wallet-a')).not.toThrow();
  });

  it('rejects empty or invalid limiter configuration', () => {
    expect(() => new FixedWindowKeyLimiter({ windowMs: 0, max: 1 })).toThrow('must be positive');
    const limiter = new FixedWindowKeyLimiter({ windowMs: 1_000, max: 1 });
    expect(() => limiter.consume('   ')).toThrow('key is required');
  });

  it('uses one atomic Redis counter per normalized recovered-wallet key', async () => {
    const sendCommand = jest.fn()
      .mockResolvedValueOnce([1, 5_000])
      .mockResolvedValueOnce([2, 4_200]);
    const limiter = new RedisFixedWindowKeyLimiter({
      windowMs: 5_000,
      max: 1,
      prefix: 'test:',
      sendCommand,
    });

    await limiter.consume('SELLER:0xAbC');
    await expect(limiter.consume('seller:0xabc')).rejects.toEqual(
      expect.objectContaining({
        name: 'AuthenticatedRateLimitError',
        retryAfterSeconds: 5,
      })
    );
    expect(sendCommand).toHaveBeenNthCalledWith(
      1,
      'EVAL',
      expect.stringContaining("redis.call('INCR', KEYS[1])"),
      '1',
      'test:seller:0xabc',
      '5000'
    );
  });

  it('fails closed when Redis errors or returns an invalid counter response', async () => {
    const failedStore = new RedisFixedWindowKeyLimiter({
      windowMs: 5_000,
      max: 1,
      prefix: 'test:',
      sendCommand: jest.fn().mockRejectedValue(new Error('connection lost')),
    });
    await expect(failedStore.consume('seller:wallet-a')).rejects.toBeInstanceOf(
      RateLimitStoreUnavailableError
    );

    const invalidReply = new RedisFixedWindowKeyLimiter({
      windowMs: 5_000,
      max: 1,
      prefix: 'test:',
      sendCommand: jest.fn().mockResolvedValue(['invalid']),
    });
    await expect(invalidReply.consume('seller:wallet-a')).rejects.toBeInstanceOf(
      RateLimitStoreUnavailableError
    );
  });

  it('refuses unsafe multi-replica and incomplete Redis topologies', () => {
    expect(getRateLimitTopologyIssues({
      store: 'memory',
      replicaCount: 1,
      databaseUrl: 'file:./benefits.db',
    })).toEqual([]);

    expect(getRateLimitTopologyIssues({
      store: 'redis',
      replicaCount: 1,
      databaseUrl: 'file:./benefits.db',
    })).toEqual([
      expect.objectContaining({ path: 'RATE_LIMIT_REDIS_URL' }),
    ]);

    expect(getRateLimitTopologyIssues({
      store: 'memory',
      replicaCount: 2,
      databaseUrl: 'file:./benefits.db',
    })).toEqual([
      expect.objectContaining({ path: 'RATE_LIMIT_STORE' }),
      expect.objectContaining({ path: 'DATABASE_URL' }),
    ]);

    expect(getRateLimitTopologyIssues({
      store: 'redis',
      redisUrl: 'redis://redis:6379',
      replicaCount: 2,
      databaseUrl: 'postgresql://benefits-db/benefits',
    })).toEqual([]);
  });
});
