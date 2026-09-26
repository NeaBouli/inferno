import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import accessRouter from '../routes/access';
import { CONFIG } from '../config';
import { createYouTubeSession } from '../services/session-store';

// Mock entitlement service
jest.mock('../services/entitlement', () => ({
  checkEntitlement: jest.fn(),
  DEFAULT_ENTITLEMENT: { logic: 'OR', conditions: [] },
}));

import { checkEntitlement } from '../services/entitlement';
const mockCheckEntitlement = checkEntitlement as jest.MockedFunction<typeof checkEntitlement>;

const app = express();
app.use(express.json());
app.use('/access', accessRouter);

function makeToken(payload: Record<string, any>): string {
  return jwt.sign(payload, CONFIG.jwtSecret, { algorithm: 'HS256', expiresIn: '1h' });
}

describe('Access Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /access/check without token returns 401', async () => {
    const res = await request(app).get('/access/check');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No token');
  });

  test('GET /access/check with invalid token returns 401', async () => {
    const res = await request(app)
      .get('/access/check')
      .set('Authorization', 'Bearer invalid-jwt-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid token');
  });

  test('GET /access/check returns granted=true when entitled', async () => {
    mockCheckEntitlement.mockResolvedValue({
      granted: true,
      reasons: ['IFR Lock >= 1000 IFR'],
    });
    const token = makeToken({ walletAddress: '0x1234' });
    const res = await request(app)
      .get('/access/check')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(true);
    expect(res.body.reasons).toContain('IFR Lock >= 1000 IFR');
  });

  test('GET /access/check returns granted=false when not entitled', async () => {
    mockCheckEntitlement.mockResolvedValue({
      granted: false,
      reasons: [],
    });
    const token = makeToken({ walletAddress: '0x5678' });
    const res = await request(app)
      .get('/access/check')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(false);
    expect(res.body.reasons).toEqual([]);
  });

  test('GET /access/check resolves YouTube session server-side via sid', async () => {
    mockCheckEntitlement.mockResolvedValue({
      granted: true,
      reasons: ['YouTube Member'],
    });
    const sid = createYouTubeSession({ accessToken: 'yt-token-123' });
    const token = makeToken({ walletAddress: '0xABCD', sid });
    const res = await request(app)
      .get('/access/check')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasYouTubeAuth).toBe(true);
    expect(res.body.walletAddress).toBe('0xABCD');
    expect(mockCheckEntitlement).toHaveBeenCalledWith(
      '0xABCD',
      'yt-token-123',
      expect.anything()
    );
    // CWA-41: provider token must not leak into the response
    expect(JSON.stringify(res.body)).not.toContain('yt-token-123');
  });

  test('GET /access/check ignores legacy youtubeAccessToken claims', async () => {
    mockCheckEntitlement.mockResolvedValue({
      granted: false,
      reasons: [],
    });
    const token = makeToken({
      walletAddress: '0xABCD',
      youtubeAccessToken: 'forged-yt-token',
    });
    const res = await request(app)
      .get('/access/check')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasYouTubeAuth).toBe(false);
    expect(mockCheckEntitlement).toHaveBeenCalledWith('0xABCD', undefined, expect.anything());
    expect(JSON.stringify(res.body)).not.toContain('forged-yt-token');
  });

  test('GET /access/check with unknown sid has no YouTube auth', async () => {
    mockCheckEntitlement.mockResolvedValue({
      granted: false,
      reasons: [],
    });
    const token = makeToken({ walletAddress: '0xABCD', sid: 'never-issued-sid' });
    const res = await request(app)
      .get('/access/check')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasYouTubeAuth).toBe(false);
    expect(mockCheckEntitlement).toHaveBeenCalledWith('0xABCD', undefined, expect.anything());
  });

  test('GET /access/check with no wallet and no YouTube', async () => {
    mockCheckEntitlement.mockResolvedValue({
      granted: false,
      reasons: [],
    });
    const token = makeToken({});
    const res = await request(app)
      .get('/access/check')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(false);
    expect(res.body.hasYouTubeAuth).toBe(false);
  });
});
