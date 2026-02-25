import request from 'supertest';
import express from 'express';
import authRouter from '../routes/auth';

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/oauth'),
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

describe('Auth Routes', () => {
  test('GET /auth/google redirects to Google OAuth', async () => {
    const res = await request(app).get('/auth/google?wallet=0x1234');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
  });

  test('POST /auth/wallet returns JWT token', async () => {
    const res = await request(app)
      .post('/auth/wallet')
      .send({ walletAddress: '0x1234567890123456789012345678901234567890' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  test('POST /auth/wallet without address returns 400', async () => {
    const res = await request(app).post('/auth/wallet').send({});
    expect(res.status).toBe(400);
  });
});
