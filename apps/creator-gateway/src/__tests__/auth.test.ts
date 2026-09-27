import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import authRouter from '../routes/auth';
import { CONFIG } from '../config';

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: jest.fn(
          (opts: { state?: string }) =>
            `https://accounts.google.com/oauth?state=${encodeURIComponent(opts.state ?? '')}`
        ),
        getToken: jest.fn().mockResolvedValue({
          tokens: { access_token: 'mock-yt-token', refresh_token: 'mock-yt-refresh' },
        }),
      })),
    },
  },
}));

const app = express();
app.use(express.json());
app.use('/auth', authRouter);

const WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const OAUTH_COOKIE = 'cg_oauth';

function bearerJwt(claims: Record<string, unknown>): string {
  return jwt.sign(claims, CONFIG.jwtSecret, { algorithm: 'HS256', expiresIn: '1h' });
}

async function startGoogleFlow(
  bearer?: string
): Promise<{ state: string; cookie: string; setCookie: string }> {
  let pending = request(app).get('/auth/google');
  if (bearer) pending = pending.set('Authorization', `Bearer ${bearer}`);
  const res = await pending;
  expect(res.status).toBe(302);
  const state = new URL(res.headers.location).searchParams.get('state');
  expect(state).toBeTruthy();
  const setCookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
    c.startsWith(`${OAUTH_COOKIE}=`)
  );
  expect(setCookie).toBeTruthy();
  return {
    state: state as string,
    cookie: (setCookie as string).split(';')[0],
    setCookie: setCookie as string,
  };
}

function callback(state: string, cookie?: string) {
  let pending = request(app).get(`/auth/google/callback?code=dummy&state=${state}`);
  if (cookie) pending = pending.set('Cookie', cookie);
  return pending;
}

function decode(token: string): jwt.JwtPayload {
  return jwt.verify(token, CONFIG.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
}

describe('Google OAuth flow', () => {
  test('GET /auth/google redirects with an opaque server-side state', async () => {
    const res = await request(app).get('/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
    const state = new URL(res.headers.location).searchParams.get('state');
    expect(state).toBeTruthy();
    expect(state).not.toContain(WALLET);
  });

  test('each flow issues a unique state and verifier cookie', async () => {
    const a = await startGoogleFlow();
    const b = await startGoogleFlow();
    expect(a.state).not.toBe(b.state);
    expect(a.cookie).not.toBe(b.cookie);
  });

  test('initiator cookie is HttpOnly/SameSite=Lax and carries no wallet or tokens', async () => {
    const { setCookie, state } = await startGoogleFlow(bearerJwt({ walletAddress: WALLET }));
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/auth');
    expect(setCookie).toContain('Max-Age=600');
    expect(setCookie).not.toContain('Secure'); // test env is not production
    const value = setCookie.split(';')[0].split('=')[1];
    expect(value).not.toBe(state);
    expect(setCookie).not.toContain(WALLET);
    expect(setCookie).not.toContain('mock-yt-token');
    expect(setCookie).not.toContain('mock-yt-refresh');
  });

  test('untrusted wallet query input is rejected and starts no flow', async () => {
    const res = await request(app).get(`/auth/google?wallet=${WALLET}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('SIWE bearer');
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('untrusted wallet body input is rejected and starts no flow', async () => {
    const res = await request(app).get('/auth/google').send({ wallet: WALLET });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('invalid bearer token returns 401 and starts no flow', async () => {
    const res = await request(app).get('/auth/google').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid token');
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('canonical flow: SIWE bearer links the wallet; JWT carries minimal claims only', async () => {
    const { state, cookie } = await startGoogleFlow(bearerJwt({ walletAddress: WALLET }));
    const res = await callback(state, cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    // CWA-41: provider tokens must not leak into response or JWT
    expect(JSON.stringify(res.body)).not.toContain('mock-yt-token');
    expect(JSON.stringify(res.body)).not.toContain('mock-yt-refresh');
    const decoded = decode(res.body.token);
    expect(decoded.walletAddress).toBe(WALLET);
    expect(typeof decoded.sid).toBe('string');
    expect(decoded.youtubeAccessToken).toBeUndefined();
    expect(decoded.refreshToken).toBeUndefined();
  });

  test('wallet-less flow: Google JWT carries only the YouTube session', async () => {
    const { state, cookie } = await startGoogleFlow();
    const res = await callback(state, cookie);
    expect(res.status).toBe(200);
    const decoded = decode(res.body.token);
    expect(decoded.walletAddress).toBeUndefined();
    expect(typeof decoded.sid).toBe('string');
  });

  test('bearer without a wallet claim starts a wallet-less flow', async () => {
    const { state, cookie } = await startGoogleFlow(bearerJwt({ sid: 'unrelated-session' }));
    const res = await callback(state, cookie);
    expect(res.status).toBe(200);
    expect(decode(res.body.token).walletAddress).toBeUndefined();
  });

  test('callback without state or code is rejected', async () => {
    const noState = await request(app).get('/auth/google/callback?code=dummy');
    expect(noState.status).toBe(400);
    expect(noState.body.error).toBe('code and state required');
    const noCode = await request(app).get('/auth/google/callback?state=whatever');
    expect(noCode.status).toBe(400);
  });

  test('callback with untrusted wallet input is rejected', async () => {
    const { state, cookie } = await startGoogleFlow(bearerJwt({ walletAddress: WALLET }));
    const other = '0x1234567890123456789012345678901234567890';
    const res = await request(app)
      .get(`/auth/google/callback?code=dummy&state=${state}&wallet=${other}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  test('callback without the initiator cookie is rejected', async () => {
    const { state } = await startGoogleFlow();
    const res = await callback(state);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing OAuth session cookie');
    expect(res.body.token).toBeUndefined();
  });

  test('callback with a foreign session cookie is rejected (cross-session)', async () => {
    const a = await startGoogleFlow();
    const b = await startGoogleFlow();
    const res = await callback(a.state, b.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid or expired OAuth state');
    expect(res.body.token).toBeUndefined();
    // the failed binding attempt burns the state — even the right cookie now fails
    const retry = await callback(a.state, a.cookie);
    expect(retry.status).toBe(400);
    // the other session stays usable
    const ok = await callback(b.state, b.cookie);
    expect(ok.status).toBe(200);
  });

  test('callback with a tampered cookie verifier is rejected', async () => {
    const { state } = await startGoogleFlow();
    const res = await callback(state, `${OAUTH_COOKIE}=${'A'.repeat(43)}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid or expired OAuth state');
  });

  test('forged state is rejected even with a valid session cookie', async () => {
    const { cookie } = await startGoogleFlow();
    const forged = 'A'.repeat(43); // well-formed but never issued by us
    const res = await callback(forged, cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid or expired OAuth state');
  });

  test('state replay is rejected (single-use)', async () => {
    const { state, cookie } = await startGoogleFlow();
    const first = await callback(state, cookie);
    expect(first.status).toBe(200);
    const replay = await callback(state, cookie);
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('Invalid or expired OAuth state');
  });

  test('expired state is rejected', async () => {
    const { state, cookie } = await startGoogleFlow();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
    try {
      const res = await callback(state, cookie);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid or expired OAuth state');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('CWA-28: legacy wallet-only auth removed', () => {
  test('POST /auth/wallet no longer exists and issues no token', async () => {
    const res = await request(app)
      .post('/auth/wallet')
      .send({ walletAddress: '0x1234567890123456789012345678901234567890' });
    expect(res.status).toBe(404);
    expect(res.body.token).toBeUndefined();
  });
});
