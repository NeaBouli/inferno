import request from 'supertest';
import express from 'express';
import { ethers } from 'ethers';
import { SiweMessage } from 'siwe';
import jwt from 'jsonwebtoken';
import authRouter from '../routes/auth';
import { CONFIG } from '../config';

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

// Hardhat fixture key #1 — public test data, never a real wallet
const signer = new ethers.Wallet(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
);

async function getIssuedNonce(): Promise<string> {
  const res = await request(app).get('/auth/siwe/nonce');
  expect(res.status).toBe(200);
  return res.body.nonce;
}

async function signSiweMessage(
  overrides: Record<string, any> = {}
): Promise<{ message: string; signature: string }> {
  const nonce = overrides.nonce ?? (await getIssuedNonce());
  const msg = new SiweMessage({
    domain: 'localhost',
    address: signer.address,
    statement: 'Sign in to IFR Creator Gateway',
    uri: 'http://localhost:3005',
    version: '1',
    chainId: 11155111,
    nonce,
    issuedAt: new Date().toISOString(),
    ...overrides,
  });
  const message = msg.prepareMessage();
  const signature = await signer.signMessage(message);
  return { message, signature };
}

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
    const res = await request(app).post('/auth/siwe/verify').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('message and signature required');
  });

  test('POST /auth/siwe/verify without message returns 400', async () => {
    const res = await request(app).post('/auth/siwe/verify').send({ signature: '0xabc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('message and signature required');
  });

  test('POST /auth/siwe/verify without signature returns 400', async () => {
    const res = await request(app).post('/auth/siwe/verify').send({ message: 'some message' });
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

describe('CWA-30: SIWE binding to domain, URI, chain, nonce and time', () => {
  test('canonical flow: valid bound message issues a JWT', async () => {
    const { message, signature } = await signSiweMessage();
    const res = await request(app).post('/auth/siwe/verify').send({ message, signature });
    expect(res.status).toBe(200);
    expect(res.body.wallet).toBe(signer.address);
    const decoded = jwt.verify(res.body.token, CONFIG.jwtSecret, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    expect(decoded.walletAddress).toBe(signer.address);
    expect(decoded.sid).toBeUndefined();
  });

  test('nonce replay with the same valid message is rejected', async () => {
    const { message, signature } = await signSiweMessage();
    const first = await request(app).post('/auth/siwe/verify').send({ message, signature });
    expect(first.status).toBe(200);
    const replay = await request(app).post('/auth/siwe/verify').send({ message, signature });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('Invalid or expired nonce');
  });

  test('domain mismatch is rejected', async () => {
    const { message, signature } = await signSiweMessage({ domain: 'evil.example.com' });
    const res = await request(app).post('/auth/siwe/verify').send({ message, signature });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('SIWE verification failed');
  });

  test('URI mismatch is rejected', async () => {
    const { message, signature } = await signSiweMessage({ uri: 'http://evil.example.com' });
    const res = await request(app).post('/auth/siwe/verify').send({ message, signature });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('SIWE verification failed');
  });

  test('chain ID mismatch is rejected', async () => {
    const { message, signature } = await signSiweMessage({ chainId: 1 });
    const res = await request(app).post('/auth/siwe/verify').send({ message, signature });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`Wrong chain. Expected ${CONFIG.chainId}`);
  });

  test('nonce not issued by us is rejected', async () => {
    const { message, signature } = await signSiweMessage({ nonce: 'abcdef0123456789' });
    const res = await request(app).post('/auth/siwe/verify').send({ message, signature });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid or expired nonce');
  });

  test('expired message is rejected (time window)', async () => {
    const { message, signature } = await signSiweMessage({
      expirationTime: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await request(app).post('/auth/siwe/verify').send({ message, signature });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('SIWE verification failed');
  });

  test('message not yet valid is rejected (time window)', async () => {
    const { message, signature } = await signSiweMessage({
      notBefore: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const res = await request(app).post('/auth/siwe/verify').send({ message, signature });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('SIWE verification failed');
  });
});
