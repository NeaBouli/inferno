import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { EntitlementConfig } from '../services/entitlement';

const { contractIsLocked, youtubeIsMember } = vi.hoisted(() => ({
  contractIsLocked: vi.fn(),
  youtubeIsMember: vi.fn(),
}));

// Keep the real decimal parser and service/route stack; replace only providers.
vi.mock('ethers', async () => {
  const actual = await vi.importActual<typeof import('ethers')>('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: vi.fn(function () { return {}; }),
      Contract: vi.fn(function () { return { isLocked: contractIsLocked }; }),
    },
  };
});
vi.mock('../services/youtube-checker', () => ({
  youtubeChecker: { isMember: youtubeIsMember },
}));

const walletAddress = '0x1234567890123456789012345678901234567890';
const savedEnv = process.env;
beforeEach(() => {
  process.env = {
    NODE_ENV: 'test',
    JWT_SECRET: 'access-policy-synthetic-jwt-fixture-at-least-32-bytes',
    SIWE_DOMAIN: 'localhost',
    SIWE_URI: 'http://localhost:3005',
  };
  vi.resetModules();
  contractIsLocked.mockReset();
  youtubeIsMember.mockReset();
});
afterEach(() => { process.env = savedEnv; });

async function loadPolicy(minLockIFR?: string) {
  if (minLockIFR !== undefined) process.env.MIN_LOCK_IFR = minLockIFR;
  const { CONFIG } = await import('../config');
  const entitlement = await import('../services/entitlement');
  const { default: accessRouter } = await import('../routes/access');
  const app = express();
  app.use('/access', accessRouter);
  const token = (claims: { walletAddress?: string; sid?: string }) => jwt.sign(
    claims, CONFIG.jwtSecret, { algorithm: 'HS256', expiresIn: '1h' }
  );
  return { app, token, CONFIG, ...entitlement };
}

test.each([
  { setting: undefined, threshold: '1000', baseUnits: 1000000000000n },
  { setting: '25.123456789', threshold: '25.123456789', baseUnits: 25123456789n },
  { setting: '0.000000001', threshold: '0.000000001', baseUnits: 1n },
  {
    setting: '9007199254740993.000000001',
    threshold: '9007199254740993.000000001',
    baseUnits: 9007199254740993000000001n,
  },
])('authenticated access enforces exact threshold $threshold', async ({ setting, threshold, baseUnits }) => {
  const { app, token, CONFIG, DEFAULT_ENTITLEMENT } = await loadPolicy(setting);
  const originalPolicy = JSON.stringify(DEFAULT_ENTITLEMENT);
  let lockedAmount = baseUnits - 1n;
  contractIsLocked.mockImplementation(async (_wallet: string, minimum: bigint) => lockedAmount >= minimum);
  const authorization = `Bearer ${token({ walletAddress })}`;

  const below = await request(app).get('/access/check').set('Authorization', authorization);
  expect(below.status).toBe(200);
  expect(below.body).toEqual({ granted: false, reasons: [], walletAddress, hasYouTubeAuth: false });
  expect(contractIsLocked).toHaveBeenNthCalledWith(1, walletAddress, baseUnits);

  lockedAmount = baseUnits;
  const exact = await request(app).get('/access/check').set('Authorization', authorization);
  expect(exact.status).toBe(200);
  expect(exact.body).toEqual({
    granted: true, reasons: [`IFR Lock >= ${threshold} IFR`], walletAddress, hasYouTubeAuth: false,
  });
  expect(contractIsLocked).toHaveBeenNthCalledWith(2, walletAddress, baseUnits);
  expect(contractIsLocked).toHaveBeenCalledTimes(2);
  expect(CONFIG.minLockIFR).toBe(threshold);
  expect(JSON.stringify(DEFAULT_ENTITLEMENT)).toBe(originalPolicy);
  expect(youtubeIsMember).not.toHaveBeenCalled();
});

test('explicit AND policy retains its threshold and does not mutate the configured default', async () => {
  const { app, token, checkEntitlement, DEFAULT_ENTITLEMENT } = await loadPolicy('25.123456789');
  const custom: EntitlementConfig = {
    logic: 'AND', conditions: [{ type: 'youtube_member' }, { type: 'ifr_lock', minIFR: '5000' }],
  };
  const originalDefault = JSON.stringify(DEFAULT_ENTITLEMENT);
  const originalCustom = JSON.stringify(custom);
  contractIsLocked.mockResolvedValue(true);
  youtubeIsMember.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

  expect(await checkEntitlement(walletAddress, 'synthetic-provider-token', custom)).toEqual({
    granted: false, reasons: ['IFR Lock >= 5000 IFR'],
  });
  expect(await checkEntitlement(walletAddress, 'synthetic-provider-token', custom)).toEqual({
    granted: true, reasons: ['YouTube Member', 'IFR Lock >= 5000 IFR'],
  });
  expect(contractIsLocked).toHaveBeenNthCalledWith(1, walletAddress, 5000000000000n);
  expect(contractIsLocked).toHaveBeenNthCalledWith(2, walletAddress, 5000000000000n);

  const defaultAccess = await request(app).get('/access/check')
    .set('Authorization', `Bearer ${token({ walletAddress })}`);
  expect(defaultAccess.body.reasons).toEqual(['IFR Lock >= 25.123456789 IFR']);
  expect(contractIsLocked).toHaveBeenLastCalledWith(walletAddress, 25123456789n);
  expect(JSON.stringify(DEFAULT_ENTITLEMENT)).toBe(originalDefault);
  expect(JSON.stringify(custom)).toBe(originalCustom);
});

test('configured default keeps YouTube OR access when the lock condition is false', async () => {
  const { app, token } = await loadPolicy('25.123456789');
  const { createYouTubeSession } = await import('../services/session-store');
  const sid = createYouTubeSession({ accessToken: 'synthetic-provider-token' });
  contractIsLocked.mockResolvedValue(false);
  youtubeIsMember.mockResolvedValue(true);

  const response = await request(app).get('/access/check')
    .set('Authorization', `Bearer ${token({ walletAddress, sid })}`);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    granted: true, reasons: ['YouTube Member'], walletAddress, hasYouTubeAuth: true,
  });
  expect(youtubeIsMember).toHaveBeenCalledWith('synthetic-provider-token');
  expect(contractIsLocked).toHaveBeenCalledWith(walletAddress, 25123456789n);
});

test.each([undefined, 'Bearer invalid-jwt-token'])(
  'rejects unauthenticated access before checking providers (%s)', async (authorization) => {
    const { app } = await loadPolicy('9007199254740993.000000001');
    const pending = request(app).get('/access/check');
    if (authorization) pending.set('Authorization', authorization);
    const response = await pending;
    expect(response.status).toBe(401);
    expect(response.body.error).toBe(authorization ? 'Invalid token' : 'No token');
    expect(contractIsLocked).not.toHaveBeenCalled();
    expect(youtubeIsMember).not.toHaveBeenCalled();
  }
);
