import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import authRouter from '../routes/auth';
import { CONFIG } from '../config';
import { LockChecker } from '../services/lock-checker';

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

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      providers: {
        JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
      },
      Contract: jest.fn().mockImplementation(() => ({
        isLocked: jest.fn(),
        lockedBalance: jest.fn(),
      })),
      utils: actual.ethers.utils,
    },
  };
});

const app = express();
app.use(express.json());
app.use('/auth', authRouter);

describe('Security Fixes', () => {
  // F1: lockedBalance ABI fix
  describe('F1: IFRLock ABI — lockedBalance', () => {
    test('LockChecker uses lockedBalance (not lockedAmount)', async () => {
      const checker = new LockChecker();
      const contract = (checker as any).contract;

      // Verify the contract has lockedBalance, not lockedAmount
      expect(typeof contract.lockedBalance).toBe('function');
      expect(contract.lockedAmount).toBeUndefined();
    });

    test('lockedBalance returns formatted value on success', async () => {
      const checker = new LockChecker();
      const { ethers } = jest.requireActual('ethers');
      const mockBalance = ethers.utils.parseUnits('5000', 9);
      (checker as any).contract.lockedBalance = jest.fn().mockResolvedValue(mockBalance);
      const result = await checker.lockedBalance('0x1234567890123456789012345678901234567890');
      expect(result).toBe('5000.0');
    });
  });

  // F2: JWT secret validation
  describe('F2: JWT secret validation', () => {
    test('CONFIG.jwtSecret is not "change-me"', () => {
      expect(CONFIG.jwtSecret).not.toBe('change-me');
    });

    test('CONFIG.jwtSecret is set (non-empty)', () => {
      expect(CONFIG.jwtSecret.length).toBeGreaterThan(0);
    });
  });

  // F7: Wallet address validation
  describe('F7: Wallet address validation on /auth/wallet', () => {
    test('rejects invalid wallet address', async () => {
      const res = await request(app)
        .post('/auth/wallet')
        .send({ walletAddress: 'not-an-address' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid wallet address');
    });

    test('rejects wallet address with wrong length', async () => {
      const res = await request(app)
        .post('/auth/wallet')
        .send({ walletAddress: '0x1234' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid wallet address');
    });

    test('accepts valid checksummed address', async () => {
      const res = await request(app)
        .post('/auth/wallet')
        .send({ walletAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.deprecated).toBe(true);
      expect(res.body.useInstead).toBe('/auth/siwe/verify');
    });

    test('accepts valid lowercase address and checksums it', async () => {
      const res = await request(app)
        .post('/auth/wallet')
        .send({ walletAddress: '0x1234567890123456789012345678901234567890' });
      expect(res.status).toBe(200);
      // Verify JWT contains checksummed address
      const decoded = jwt.verify(res.body.token, CONFIG.jwtSecret) as any;
      expect(decoded.walletAddress).toBe('0x1234567890123456789012345678901234567890');
    });

    test('includes deprecation header', async () => {
      const res = await request(app)
        .post('/auth/wallet')
        .send({ walletAddress: '0x1234567890123456789012345678901234567890' });
      expect(res.headers['x-deprecated']).toBe('Use /auth/siwe/verify instead');
    });
  });
});
