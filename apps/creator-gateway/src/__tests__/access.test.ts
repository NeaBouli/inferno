import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import accessRouter from '../routes/access';
import { authMiddleware } from '../middleware/auth';
import { CONFIG } from '../config';

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
  return jwt.sign(payload, CONFIG.jwtSecret, { expiresIn: '1h' });
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

  test('GET /access/check detects YouTube auth', async () => {
    mockCheckEntitlement.mockResolvedValue({
      granted: true,
      reasons: ['YouTube Member'],
    });
    const token = makeToken({
      walletAddress: '0xABCD',
      youtubeAccessToken: 'yt-token-123',
    });
    const res = await request(app)
      .get('/access/check')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasYouTubeAuth).toBe(true);
    expect(res.body.walletAddress).toBe('0xABCD');
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
