jest.mock('../src/config', () => ({
  config: {
    RATE_LIMIT_STORE: 'memory',
  },
}));

import express from 'express';
import type { Request } from 'express';
import type { Server } from 'node:http';
import {
  AuthenticatedRateLimitError,
  FixedWindowKeyLimiter,
  RedisFixedWindowKeyLimiter,
} from '../src/services/authenticatedRateLimiter';
import { RateLimitStoreUnavailableError } from '../src/services/rateLimitInfrastructure';
import { getRateLimitTopologyIssues } from '../src/services/rateLimitTopology';
import {
  clientIpRateLimitKey,
  createAdminRateLimiter,
  customerPassControlRateLimitKey,
  rateLimitIpKey,
  TRUSTED_PROXY_SUBNETS,
} from '../src/middleware/rateLimiter';

describe('Authenticated seller wallet limiter', () => {
  it('isolates customer-pass read budgets without storing bearer tokens', () => {
    const first = customerPassControlRateLimitKey({
      params: { id: 'pass-a' },
      get: () => 'Bearer private-control-token-a',
    });
    const same = customerPassControlRateLimitKey({
      params: { id: 'pass-a' },
      get: () => 'Bearer private-control-token-a',
    });
    const differentToken = customerPassControlRateLimitKey({
      params: { id: 'pass-a' },
      get: () => 'Bearer private-control-token-b',
    });
    const differentPass = customerPassControlRateLimitKey({
      params: { id: 'pass-b' },
      get: () => 'Bearer private-control-token-a',
    });

    expect(first).toBe(same);
    expect(first).not.toBe(differentToken);
    expect(first).not.toBe(differentPass);
    expect(first).toMatch(/^pass-a:[a-f0-9]{64}$/);
    expect(first).not.toContain('private-control-token');
  });

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

describe('Admin pre-auth limiter', () => {
  it('shares one IP budget across different guessed bearer tokens and emits standard headers', async () => {
    const app = express();
    app.use(createAdminRateLimiter({ windowMs: 60_000, max: 2 }));
    app.get('/probe', (_req, res) => res.json({ ok: true }));
    const probeServer = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });

    try {
      const address = probeServer.address();
      if (!address || typeof address === 'string') throw new Error('Probe server did not bind');
      const url = `http://127.0.0.1:${address.port}/probe`;
      expect((await fetch(url, { headers: { authorization: 'Bearer guess-a' } })).status).toBe(200);
      expect((await fetch(url, { headers: { authorization: 'Bearer guess-b' } })).status).toBe(200);
      const limited = await fetch(url);
      expect(limited.status).toBe(429);
      expect(limited.headers.get('ratelimit-limit')).toBe('2');
      expect(limited.headers.get('ratelimit-remaining')).toBe('0');
      expect(await limited.json()).toEqual({ error: 'Too many admin requests. Try again later.' });
    } finally {
      await new Promise<void>((resolve, reject) => {
        probeServer.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});

describe('IPv6 /64 rate-limit keys (T-259)', () => {
  it('keys IPv4 by address, IPv4-mapped as IPv4 and IPv6 by its /64', () => {
    expect(rateLimitIpKey('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitIpKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitIpKey('::FFFF:cb00:7107')).toBe('203.0.113.7');
    expect(rateLimitIpKey('2001:db8:abcd:ef01::1')).toBe('2001:db8:abcd:ef01::/64');
    expect(rateLimitIpKey('2001:0DB8:abcd:ef01:ffff:1:2:3')).toBe('2001:db8:abcd:ef01::/64');
    expect(rateLimitIpKey('2001:db8:abcd:ef02::1')).not.toBe(rateLimitIpKey('2001:db8:abcd:ef01::1'));
    expect(rateLimitIpKey('unknown')).toBe('unknown');
    expect(clientIpRateLimitKey({})).toBe('unknown');
  });

  it('caps rotation inside one /64 behind the trusted proxy chain', async () => {
    const app = express();
    app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
    app.use(createAdminRateLimiter({ windowMs: 60_000, max: 3 }));
    app.get('/probe', (_req, res) => res.json({ ok: true }));
    const probeServer = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });

    try {
      const address = probeServer.address();
      if (!address || typeof address === 'string') throw new Error('Probe server did not bind');
      const url = `http://127.0.0.1:${address.port}/probe`;
      const hit = async (client: string) =>
        (await fetch(url, { headers: { 'X-Forwarded-For': client } })).status;
      const rotated: number[] = [];
      for (let i = 1; i <= 10; i++) rotated.push(await hit(`2001:db8:abcd:ef01::${i.toString(16)}`));
      expect(rotated.slice(0, 3)).toEqual([200, 200, 200]);
      expect(rotated.slice(3).every((status) => status === 429)).toBe(true);
      expect(await hit('2001:db8:abcd:ef02::1')).toBe(200);
      for (let i = 0; i < 3; i++) await hit('198.51.100.20');
      expect(await hit('::ffff:198.51.100.20')).toBe(429);
    } finally {
      await new Promise<void>((resolve, reject) => {
        probeServer.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});

describe('Client IP behind the trusted proxy chain (T-282, GHSA-jqcg-44mw-7w3h)', () => {
  function appTrusting(subnets: string[]) {
    const trusting = express();
    trusting.set('trust proxy', subnets);
    return trusting;
  }
  const app = appTrusting(TRUSTED_PROXY_SUBNETS);

  /** Resolves Express `req.ip` for a TCP peer and an optional X-Forwarded-For header. */
  function clientIp(peer: string, forwardedFor?: string, on = app): string | undefined {
    const socket = { remoteAddress: peer };
    const req = Object.create(on.request) as Request;
    Object.defineProperty(req, 'headers', {
      value: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
    });
    Object.defineProperty(req, 'socket', { value: socket });
    Object.defineProperty(req, 'connection', { value: socket });
    return req.ip;
  }

  it('ignores a spoofed X-Forwarded-For from untrusted IPv4, IPv4-mapped and IPv6 peers', () => {
    const spoof = '10.0.0.1, 198.51.100.66';
    expect(clientIp('203.0.113.9', spoof)).toBe('203.0.113.9');
    expect(clientIp('::ffff:203.0.113.9', spoof)).toBe('::ffff:203.0.113.9');
    expect(clientIp('2001:db8:abcd:ef01::9', spoof)).toBe('2001:db8:abcd:ef01::9');
    expect(clientIpRateLimitKey({ ip: clientIp('203.0.113.9', spoof) })).toBe('203.0.113.9');
    expect(clientIpRateLimitKey({ ip: clientIp('::ffff:203.0.113.9', spoof) })).toBe('203.0.113.9');
    expect(clientIpRateLimitKey({ ip: clientIp('2001:db8:abcd:ef01::9', spoof) })).toBe('2001:db8:abcd:ef01::/64');
  });

  it('takes the first untrusted hop when the peer is a trusted private proxy', () => {
    // Traefik on a private Docker network (IPv4, IPv4-mapped and unique-local IPv6 peers).
    expect(clientIp('172.18.0.5', '198.51.100.7')).toBe('198.51.100.7');
    expect(clientIp('::ffff:172.18.0.5', '198.51.100.7')).toBe('198.51.100.7');
    expect(clientIp('fd00::5', '2001:db8:1::7')).toBe('2001:db8:1::7');
    expect(clientIp('127.0.0.1', '198.51.100.7')).toBe('198.51.100.7');
    expect(clientIp('::1', '198.51.100.7')).toBe('198.51.100.7');
    expect(clientIp('169.254.10.1', '198.51.100.7')).toBe('198.51.100.7');
    expect(clientIp('fe80::1', '198.51.100.7')).toBe('198.51.100.7');
    // Frontend -> Traefik -> client: a value the client prepended before the public hop is ignored.
    expect(clientIp('172.18.0.6', '6.6.6.6, 198.51.100.7, 172.18.0.5')).toBe('198.51.100.7');
    expect(clientIpRateLimitKey({ ip: clientIp('172.18.0.6', '6.6.6.6, 198.51.100.7, 172.18.0.5') })).toBe('198.51.100.7');
    expect(clientIpRateLimitKey({ ip: clientIp('172.18.0.5', '2001:db8:1:2::7') })).toBe('2001:db8:1:2::/64');
    // Without a forwarded header the trusted peer itself is the client.
    expect(clientIp('172.18.0.5')).toBe('172.18.0.5');
  });

  it('runs a patched proxy-addr: zero-prefix IPv6 trust subnets no longer trust every IPv4 peer', () => {
    // Advisory precondition (not our configuration): these subnets trusted every IPv4 peer in <= 2.0.7,
    // so req.ip became the spoofed header value.
    for (const subnet of ['::ffff:10.0.0.0/8', '::/1']) {
      const misconfigured = appTrusting([subnet]);
      expect(clientIp('203.0.113.9', '6.6.6.6', misconfigured)).toBe('203.0.113.9');
      expect(clientIp('::ffff:203.0.113.9', '6.6.6.6', misconfigured)).toBe('::ffff:203.0.113.9');
    }
    // The correctly written mapped block still covers exactly 10.0.0.0/8.
    const mapped = appTrusting(['::ffff:10.0.0.0/104']);
    expect(clientIp('10.1.2.3', '198.51.100.7', mapped)).toBe('198.51.100.7');
    expect(clientIp('11.1.2.3', '198.51.100.7', mapped)).toBe('11.1.2.3');
  });
});
