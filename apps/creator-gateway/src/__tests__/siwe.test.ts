import request from 'supertest';
import express from 'express';
import authRouter from '../routes/auth';

// Mock googleapis to prevent real OAuth calls
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/oauth'),
        getToken: jest.fn().mockResolvedValue({ tokens: { access_token: 'mock' } }),
      })),
    },
  },
}));

const app = express();
app.use(express.json());
app.use('/auth', authRouter);

describe('SIWE Auth', () => {
  test('GET /auth/siwe/nonce returns a nonce string', async () => {
    const res = await request(app).get('/auth/siwe/nonce');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('nonce');
    expect(typeof res.body.nonce).toBe('string');
    expect(res.body.nonce.length).toBeGreaterThan(0);
  });

  test('GET /auth/siwe/nonce returns unique nonces', async () => {
    const res1 = await request(app).get('/auth/siwe/nonce');
    const res2 = await request(app).get('/auth/siwe/nonce');
    expect(res1.body.nonce).not.toBe(res2.body.nonce);
  });

  test('POST /auth/siwe/verify without body returns 400', async () => {
    const res = await request(app)
      .post('/auth/siwe/verify')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('message and signature required');
  });

  test('POST /auth/siwe/verify without message returns 400', async () => {
    const res = await request(app)
      .post('/auth/siwe/verify')
      .send({ signature: '0xabc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('message and signature required');
  });

  test('POST /auth/siwe/verify without signature returns 400', async () => {
    const res = await request(app)
      .post('/auth/siwe/verify')
      .send({ message: 'some message' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('message and signature required');
  });

  test('POST /auth/siwe/verify with invalid SIWE message returns 401', async () => {
    const res = await request(app)
      .post('/auth/siwe/verify')
      .send({ message: 'not a valid SIWE message', signature: '0xbad' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('SIWE verification failed');
  });
});
