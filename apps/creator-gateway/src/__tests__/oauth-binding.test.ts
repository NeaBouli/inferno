import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import authRouter from '../routes/auth';
import accessRouter from '../routes/access';
import { CONFIG } from '../config';

// The victim has a (mocked) on-chain lock that would satisfy the entitlement —
// the tests prove an attacker can never spend it through a Google login.
const VICTIM = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
// A user who proves their own wallet via the canonical SIWE flow.
const OWNER = '0x1234567890123456789012345678901234567890';

const mockIsLocked = jest.fn().mockResolvedValue(true);
const mockIsMember = jest.fn().mockResolvedValue(false);

jest.mock('../services/lock-checker', () => ({
  lockChecker: { isLocked: (...args: unknown[]) => mockIsLocked(...args) },
}));

jest.mock('../services/youtube-checker', () => ({
  youtubeChecker: { isMember: (...args: unknown[]) => mockIsMember(...args) },
}));

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: jest.fn(
          (opts: { state?: string }) =>
            `https://accounts.google.com/oauth?state=${encodeURIComponent(opts.state ?? '')}`
        ),
        getToken: jest.fn().mockResolvedValue({
          tokens: { access_token: 'mock-yt-token' },
        }),
      })),
    },
  },
}));

const app = express();
app.use(express.json());
app.use('/auth', authRouter);
app.use('/access', accessRouter);

function siweBearer(walletAddress: string): string {
  return jwt.sign({ walletAddress }, CONFIG.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

async function completeGoogleFlow(bearer?: string): Promise<string> {
  let pending = request(app).get('/auth/google');
  if (bearer) pending = pending.set('Authorization', `Bearer ${bearer}`);
  const start = await pending;
  expect(start.status).toBe(302);
  const state = new URL(start.headers.location).searchParams.get('state') as string;
  const cookie = (start.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cg_oauth='))!
    .split(';')[0];
  const cb = await request(app)
    .get(`/auth/google/callback?code=dummy&state=${state}`)
    .set('Cookie', cookie);
  expect(cb.status).toBe(200);
  return cb.body.token as string;
}

describe('wallet provenance: a Google login cannot spend a victim lock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /auth/google?wallet=<victim> is rejected and starts no flow', async () => {
    const res = await request(app).get(`/auth/google?wallet=${VICTIM}`);
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('completed attacker Google login never satisfies /access/check via the victim lock', async () => {
    // attacker first tries to inject the victim wallet (rejected), then completes a clean flow
    await request(app).get(`/auth/google?wallet=${VICTIM}`);
    const token = await completeGoogleFlow();

    const decoded = jwt.verify(token, CONFIG.jwtSecret, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    expect(decoded.walletAddress).toBeUndefined();

    const check = await request(app)
      .get('/access/check')
      .set('Authorization', `Bearer ${token}`);
    expect(check.status).toBe(200);
    expect(check.body.granted).toBe(false);
    expect(check.body.reasons).toEqual([]);
    expect(check.body.walletAddress).toBeUndefined();
    // the victim's lock is never consulted on the attacker's behalf
    expect(mockIsLocked).not.toHaveBeenCalled();
  });

  test('legitimate linking is preserved: SIWE bearer wallet reaches /access/check', async () => {
    const token = await completeGoogleFlow(siweBearer(OWNER));
    const decoded = jwt.verify(token, CONFIG.jwtSecret, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    expect(decoded.walletAddress).toBe(OWNER);

    const check = await request(app)
      .get('/access/check')
      .set('Authorization', `Bearer ${token}`);
    expect(check.status).toBe(200);
    expect(check.body.granted).toBe(true);
    expect(check.body.reasons).toContain('IFR Lock >= 1000 IFR');
    expect(mockIsLocked).toHaveBeenCalledWith(OWNER, '1000');
  });
});
