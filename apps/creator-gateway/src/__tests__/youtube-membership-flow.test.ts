import { afterEach, beforeEach, expect, test, vi, type Mock } from 'vitest';
import express, { type Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
// Load the route's signature dependency during collection, outside HTTP case timing.
import 'siwe';

interface ClientFixture {
  options: unknown;
  credentials: Record<string, unknown>;
  generateAuthUrl: Mock;
  getToken: Mock;
  setCredentials: Mock;
}
const { clients, channelsList, membersList, lockIsLocked, tokenExchange } = vi.hoisted(() => ({
  clients: [] as ClientFixture[], channelsList: vi.fn(), membersList: vi.fn(),
  lockIsLocked: vi.fn(), tokenExchange: vi.fn(),
}));
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn(function (options: unknown) {
        const client: ClientFixture = {
          options, credentials: {},
          generateAuthUrl: vi.fn(({ state }: { state: string }) => `https://accounts.google.com/oauth?state=${state}`),
          getToken: vi.fn((code: string) => tokenExchange(code)),
          setCredentials: vi.fn((credentials: Record<string, unknown>) => { client.credentials = { ...credentials }; }),
        };
        clients.push(client);
        return client;
      }),
    },
    youtube: () => ({ channels: { list: channelsList }, members: { list: membersList } }),
  },
}));
vi.mock('../services/lock-checker', () => ({ lockChecker: { isLocked: lockIsLocked } }));

const CREATOR = `UC${'C'.repeat(22)}`;
const VISITOR_A = `UC${'A'.repeat(22)}`;
const VISITOR_B = `UC${'B'.repeat(22)}`;
const WALLET = '0x1234567890123456789012345678901234567890';
const CREATOR_TOKEN = 'synthetic-creator-refresh';
const savedEnv = process.env;
beforeEach(() => {
  process.env = {
    NODE_ENV: 'test', JWT_SECRET: 'synthetic-membership-flow-jwt-at-least-32-bytes',
    SIWE_DOMAIN: 'localhost', SIWE_URI: 'http://localhost:3005',
    GOOGLE_CLIENT_ID: 'synthetic-app-client', GOOGLE_CLIENT_SECRET: 'synthetic-app-secret',
    YOUTUBE_CHANNEL_ID: CREATOR, YOUTUBE_CREATOR_REFRESH_TOKEN: CREATOR_TOKEN,
  };
  vi.resetModules();
  clients.length = 0;
  tokenExchange.mockReset().mockImplementation(async (code: string) => ({
    tokens: { access_token: `visitor-access-${code}`, refresh_token: `visitor-refresh-${code}` },
  }));
  channelsList.mockReset().mockImplementation(async ({ auth }: { auth: ClientFixture }) => ({
    data: { items: [{ id: auth.credentials.access_token === 'visitor-access-flow-b' ? VISITOR_B : VISITOR_A }] },
  }));
  membersList.mockReset().mockResolvedValue({ data: { items: [
    { snippet: { creatorChannelId: CREATOR, memberDetails: { channelId: VISITOR_A } } },
  ] } });
  lockIsLocked.mockReset().mockResolvedValue(false);
});
afterEach(() => { process.env = savedEnv; vi.restoreAllMocks(); });

async function loadApp() {
  const { CONFIG } = await import('../config');
  const { default: authRouter } = await import('../routes/auth');
  const { default: accessRouter } = await import('../routes/access');
  const sessions = await import('../services/session-store');
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.use('/access', accessRouter);
  return { app, CONFIG, sessions };
}
async function start(app: Express, bearer?: string) {
  const pending = request(app).get('/auth/google');
  if (bearer) pending.set('Authorization', `Bearer ${bearer}`);
  const response = await pending;
  expect(response.status).toBe(302);
  const state = new URL(response.headers.location).searchParams.get('state');
  const cookies = response.headers['set-cookie'] as unknown as string[];
  const cookie = cookies.find((value) => value.startsWith('cg_oauth='))!.split(';')[0];
  return { state, cookie };
}
async function login(app: Express, code = 'flow-a', bearer?: string) {
  const flow = await start(app, bearer);
  const response = await request(app).get('/auth/google/callback')
    .query({ code, state: flow.state }).set('Cookie', flow.cookie);
  expect(response.status).toBe(200);
  return response.body.token as string;
}

test('OAuth -> server identity/session -> access uses distinct viewer and creator principals', async () => {
  const { app, CONFIG, sessions } = await loadApp();
  const token = await login(app);
  const claims = jwt.verify(token, CONFIG.jwtSecret) as jwt.JwtPayload;
  expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'sid']);
  expect(sessions.getYouTubeSession(claims.sid)).toEqual({
    channelId: VISITOR_A, accessToken: 'visitor-access-flow-a', refreshToken: 'visitor-refresh-flow-a',
  });
  const response = await request(app).get('/access/check').set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ granted: true, reasons: ['YouTube Member'], hasYouTubeAuth: true });

  const viewer = clients.find((client) => client.credentials.access_token === 'visitor-access-flow-a')!;
  const creator = clients.find((client) => client.credentials.refresh_token === CREATOR_TOKEN)!;
  expect(viewer).toBeDefined();
  expect(creator).toBeDefined();
  expect(viewer).not.toBe(creator);
  expect(viewer.getToken).toHaveBeenCalledExactlyOnceWith('flow-a');
  expect(creator.getToken).not.toHaveBeenCalled();
  expect(creator.credentials).toEqual({ refresh_token: CREATOR_TOKEN });
  expect(clients[0].generateAuthUrl).toHaveBeenCalledExactlyOnceWith({
    scope: ['https://www.googleapis.com/auth/youtube.readonly'], state: expect.any(String),
  });
  expect(channelsList).toHaveBeenCalledExactlyOnceWith({
    auth: viewer, part: ['id'], mine: true,
  }, { timeout: 5_000, retry: false });
  expect(membersList).toHaveBeenCalledExactlyOnceWith({
    auth: creator, part: ['snippet'], mode: 'all_current', filterByMemberChannelId: VISITOR_A, maxResults: 1,
  }, { timeout: 5_000, retry: false });
  expect(viewer.options).toEqual({
    clientId: CONFIG.google.clientId, clientSecret: CONFIG.google.clientSecret,
    redirectUri: CONFIG.google.redirectUri, transporterOptions: { timeout: 5_000 },
  });
  for (const value of [CREATOR_TOKEN, 'visitor-access-flow-a', 'visitor-refresh-flow-a', CONFIG.google.clientSecret, VISITOR_A]) {
    expect(JSON.stringify(claims)).not.toContain(value);
    expect(JSON.stringify(response.body)).not.toContain(value);
  }
});

test.each([
  { creator: VISITOR_B, visitor: VISITOR_A },
  { creator: CREATOR, visitor: VISITOR_B },
])('full authenticated path denies wrong membership principal (%j)', async ({ creator, visitor }) => {
  membersList.mockResolvedValue({ data: { items: [
    { snippet: { creatorChannelId: creator, memberDetails: { channelId: visitor } } },
  ] } });
  const { app } = await loadApp();
  const token = await login(app);
  const response = await request(app).get('/access/check').set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
  expect(response.body.granted).toBe(false);
  expect(response.body.reasons).toEqual([]);
  expect(membersList).toHaveBeenCalledTimes(1);
});

test.each([{ nextPageToken: 'another-page' }, { pageInfo: { totalResults: 2 } }])(
  'full authenticated path denies ambiguous result metadata despite exact IDs (%j)', async (metadata) => {
    membersList.mockResolvedValue({ data: { ...metadata, items: [
      { snippet: { creatorChannelId: CREATOR, memberDetails: { channelId: VISITOR_A } } },
    ] } });
    const { app } = await loadApp();
    const token = await login(app);
    const response = await request(app).get('/access/check').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ granted: false, reasons: [], hasYouTubeAuth: true });
    expect(membersList).toHaveBeenCalledTimes(1);
  }
);

test.each([undefined, '', '   '])('full authenticated path denies missing creator authority (%s)', async (credential) => {
  if (credential === undefined) delete process.env.YOUTUBE_CREATOR_REFRESH_TOKEN;
  else process.env.YOUTUBE_CREATOR_REFRESH_TOKEN = credential;
  const { app } = await loadApp();
  const token = await login(app);
  const response = await request(app).get('/access/check').set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
  expect(response.body.granted).toBe(false);
  expect(membersList).not.toHaveBeenCalled();
  expect(clients.some((client) => client.credentials.refresh_token === CREATOR_TOKEN)).toBe(false);
});

test('unconfigured membership preserves IFR OR access for the proven wallet', async () => {
  delete process.env.YOUTUBE_CREATOR_REFRESH_TOKEN;
  lockIsLocked.mockResolvedValue(true);
  const { app, CONFIG } = await loadApp();
  const bearer = jwt.sign({ walletAddress: WALLET }, CONFIG.jwtSecret, { algorithm: 'HS256', expiresIn: '1h' });
  const token = await login(app, 'flow-a', bearer);
  const response = await request(app).get('/access/check').set('Authorization', `Bearer ${token}`);
  expect(response.body.granted).toBe(true);
  expect(response.body.reasons).toEqual(['IFR Lock >= 1000 IFR']);
  expect(lockIsLocked).toHaveBeenCalledWith(WALLET, '1000');
  expect(membersList).not.toHaveBeenCalled();
});

test('parallel viewer callbacks keep each flow credential and channel identity independent', async () => {
  const { app, CONFIG, sessions } = await loadApp();
  const [a, b] = await Promise.all([login(app, 'flow-a'), login(app, 'flow-b')]);
  const claimsA = jwt.verify(a, CONFIG.jwtSecret) as jwt.JwtPayload;
  const claimsB = jwt.verify(b, CONFIG.jwtSecret) as jwt.JwtPayload;
  expect(claimsA.sid).not.toBe(claimsB.sid);
  expect(sessions.getYouTubeSession(claimsA.sid)?.channelId).toBe(VISITOR_A);
  expect(sessions.getYouTubeSession(claimsB.sid)?.channelId).toBe(VISITOR_B);
  const aClient = clients.find((client) => client.credentials.access_token === 'visitor-access-flow-a')!;
  const bClient = clients.find((client) => client.credentials.access_token === 'visitor-access-flow-b')!;
  expect(aClient).not.toBe(bClient);
  expect(aClient.setCredentials).toHaveBeenCalledTimes(1);
  expect(bClient.setCredentials).toHaveBeenCalledTimes(1);
  expect(channelsList).toHaveBeenCalledTimes(2);
  expect(membersList).not.toHaveBeenCalled();
});

test('caller channel/subject/email input cannot replace provider-derived identity', async () => {
  const { app, CONFIG, sessions } = await loadApp();
  const flow = await start(app);
  const callback = await request(app).get('/auth/google/callback')
    .query({ code: 'flow-a', state: flow.state, channelId: VISITOR_B, sub: VISITOR_B, email: 'visitor@example.invalid' })
    .send({ channelId: VISITOR_B }).set('Cookie', flow.cookie);
  expect(callback.status).toBe(200);
  const claims = jwt.verify(callback.body.token, CONFIG.jwtSecret) as jwt.JwtPayload;
  expect(sessions.getYouTubeSession(claims.sid)?.channelId).toBe(VISITOR_A);
  const forgedClaims = jwt.sign({ sid: claims.sid, channelId: VISITOR_B, sub: VISITOR_B }, CONFIG.jwtSecret, { algorithm: 'HS256' });
  const access = await request(app).get('/access/check').query({ channelId: VISITOR_B })
    .send({ channelId: VISITOR_B }).set('Authorization', `Bearer ${forgedClaims}`);
  expect(access.body.granted).toBe(true);
  expect(membersList).toHaveBeenCalledWith(expect.objectContaining({ filterByMemberChannelId: VISITOR_A }), expect.anything());
});

test.each([
  {}, { items: [] }, { items: [{}] }, { items: [{ id: '' }] }, { items: [{ id: 123 }] },
  { items: [{ id: 'not-a-channel' }] }, { items: [{ id: VISITOR_A }, { id: VISITOR_B }] },
  { items: [{ id: VISITOR_A }], nextPageToken: 'more-identities' },
  { items: [{ id: VISITOR_A }], prevPageToken: 'other-page' },
  { items: [{ id: VISITOR_A }], pageInfo: { totalResults: 2 } },
])('missing/malformed/ambiguous visitor identity creates no session (%j)', async (data) => {
  channelsList.mockResolvedValue({ data });
  const { app, sessions } = await loadApp();
  const createSession = vi.spyOn(sessions, 'createYouTubeSession');
  const flow = await start(app);
  const response = await request(app).get('/auth/google/callback')
    .query({ code: 'flow-a', state: flow.state }).set('Cookie', flow.cookie);
  expect(response.status).toBe(502);
  expect(response.body).toEqual({ error: 'OAuth failed' });
  expect(createSession).not.toHaveBeenCalled();
  expect(membersList).not.toHaveBeenCalled();
});

test('viewer provider error returns a generic failure and never creates a session', async () => {
  channelsList.mockRejectedValue(Object.assign(new Error('SYNTHETIC-SECRET-SENTINEL'), {
    config: { headers: { authorization: 'Bearer SYNTHETIC-SECRET-SENTINEL' } },
  }));
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { app, sessions } = await loadApp();
  const createSession = vi.spyOn(sessions, 'createYouTubeSession');
  const flow = await start(app);
  const response = await request(app).get('/auth/google/callback')
    .query({ code: 'flow-a', state: flow.state }).set('Cookie', flow.cookie);
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: 'OAuth failed' });
  expect(createSession).not.toHaveBeenCalled();
  expect(errorLog).not.toHaveBeenCalled();
  expect(warnLog).not.toHaveBeenCalled();
});

test.each([{}, { access_token: '' }, { access_token: '   ' }])('missing exchanged viewer token creates no session (%j)', async (tokens) => {
  tokenExchange.mockResolvedValue({ tokens });
  const { app, sessions } = await loadApp();
  const createSession = vi.spyOn(sessions, 'createYouTubeSession');
  const flow = await start(app);
  const response = await request(app).get('/auth/google/callback')
    .query({ code: 'flow-a', state: flow.state }).set('Cookie', flow.cookie);
  expect(response.status).toBe(502);
  expect(createSession).not.toHaveBeenCalled();
  expect(channelsList).not.toHaveBeenCalled();
});

test('legacy token-only sessions and caller claims cannot establish a visitor identity', async () => {
  const { app, CONFIG, sessions } = await loadApp();
  const sid = sessions.createYouTubeSession({ accessToken: 'legacy-viewer-access' });
  const token = jwt.sign({ sid, channelId: VISITOR_A, youtubeAccessToken: 'forged' }, CONFIG.jwtSecret, { algorithm: 'HS256' });
  const response = await request(app).get('/access/check').set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
  expect(response.body.granted).toBe(false);
  expect(membersList).not.toHaveBeenCalled();
});

test('the one-hour server session expiry denies YouTube even while its JWT is valid', async () => {
  const { app } = await loadApp();
  const token = await login(app);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60 * 1000);
  const response = await request(app).get('/access/check').set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ granted: false, reasons: [], hasYouTubeAuth: false });
  expect(membersList).not.toHaveBeenCalled();
});
