import express from 'express';
import type { Server } from 'node:http';
import rateLimit from 'express-rate-limit';

jest.mock('../src/config', () => ({
  config: {
    RATE_LIMIT_STORE: 'redis',
    RATE_LIMIT_REDIS_URL: process.env.TEST_REDIS_URL,
  },
}));

import { RedisFixedWindowKeyLimiter } from '../src/services/authenticatedRateLimiter';
import {
  RateLimitStoreUnavailableError,
  closeRateLimitInfrastructure,
  createPublicRateLimitStore,
  initializeRateLimitInfrastructure,
  sendRateLimitRedisCommand,
} from '../src/services/rateLimitInfrastructure';

const describeWithRedis = process.env.TEST_REDIS_URL ? describe : describe.skip;

describeWithRedis('Redis-backed rate limiting', () => {
  const servers: Server[] = [];
  const baseUrls: string[] = [];

  beforeAll(async () => {
    await initializeRateLimitInfrastructure();
    for (let instance = 0; instance < 2; instance += 1) {
      const app = express();
      app.get('/discover', rateLimit({
        windowMs: 60_000,
        max: 60,
        store: createPublicRateLimitStore('integration-discovery'),
        standardHeaders: true,
        legacyHeaders: false,
      }), (_req, res) => {
        res.json({ status: 'ok' });
      });
      app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        if (error instanceof RateLimitStoreUnavailableError) {
          res.status(503).json({ error: error.message });
          return;
        }
        res.status(500).json({ error: 'Internal server error' });
      });
      const server = await new Promise<Server>((resolve) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Redis rate-limit test server did not bind');
      servers.push(server);
      baseUrls.push(`http://127.0.0.1:${address.port}`);
    }
  });

  beforeEach(async () => {
    await sendRateLimitRedisCommand('FLUSHDB');
  });

  afterAll(async () => {
    for (const server of servers) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    await closeRateLimitInfrastructure();
  });

  it('shares public discovery request counts across two API instances', async () => {
    for (let request = 0; request < 60; request += 1) {
      const response = await fetch(`${baseUrls[request % 2]}/discover`);
      expect(response.status).toBe(200);
    }
    const limited = await fetch(`${baseUrls[1]}/discover`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('ratelimit-policy')).toContain('60;w=60');
  });

  it('shares an atomic authenticated-wallet counter through Redis', async () => {
    const limiter = new RedisFixedWindowKeyLimiter({
      windowMs: 10_000,
      max: 2,
      prefix: 'integration:seller-wallet:',
    });

    await limiter.consume('seller:0xAbC');
    await limiter.consume('SELLER:0xabc');
    await expect(limiter.consume('seller:0xABC')).rejects.toEqual(
      expect.objectContaining({
        name: 'AuthenticatedRateLimitError',
        retryAfterSeconds: expect.any(Number),
      })
    );
  });

  it('returns HTTP 503 instead of passing requests when the Redis store is unavailable', async () => {
    await closeRateLimitInfrastructure();
    const unavailable = await fetch(`${baseUrls[0]}/discover`);
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({
      error: 'Rate limit service is temporarily unavailable.',
    });
  });
});
