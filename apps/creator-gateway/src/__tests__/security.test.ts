import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import authRouter from '../routes/auth';
import { authMiddleware } from '../middleware/auth';
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
      JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
      Contract: jest.fn().mockImplementation(() => ({
        isLocked: jest.fn(),
        lockedBalance: jest.fn(),
      })),
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
      const { parseUnits } = jest.requireActual('ethers');
      const mockBalance = parseUnits('5000', 9);
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

  // CWA-28: the legacy wallet-only route bypassed SIWE proof entirely
  describe('CWA-28: legacy wallet-only auth removed', () => {
    test('POST /auth/wallet is gone (404), even for valid addresses', async () => {
      const res = await request(app)
        .post('/auth/wallet')
        .send({ walletAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' });
      expect(res.status).toBe(404);
      expect(res.body.token).toBeUndefined();
    });

    test('POST /auth/wallet does not issue tokens for malformed input', async () => {
      const res = await request(app).post('/auth/wallet').send({ walletAddress: 'not-an-address' });
      expect(res.status).toBe(404);
      expect(res.body.token).toBeUndefined();
    });
  });
});

describe('CWA-42: JWT algorithm pinning', () => {
  const protectedApp = express();
  protectedApp.use(express.json());
  protectedApp.get('/protected', authMiddleware, (_req, res) => res.json({ ok: true }));

  const b64url = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  test('alg=none token is rejected', async () => {
    const noneToken = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      walletAddress: '0x1234567890123456789012345678901234567890',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.`;
    const res = await request(protectedApp)
      .get('/protected')
      .set('Authorization', `Bearer ${noneToken}`);
    expect(res.status).toBe(401);
  });

  test('HS512 token signed with the same secret is rejected (not pinned)', async () => {
    const token = jwt.sign({ walletAddress: '0xabc' }, CONFIG.jwtSecret, {
      algorithm: 'HS512',
    });
    const res = await request(protectedApp)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  test('HS256 token signed with a different secret is rejected', async () => {
    const token = jwt.sign({ walletAddress: '0xabc' }, 'some-other-secret', {
      algorithm: 'HS256',
    });
    const res = await request(protectedApp)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  test('pinned HS256 token with the configured secret is accepted', async () => {
    const token = jwt.sign({ walletAddress: '0xabc' }, CONFIG.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });
    const res = await request(protectedApp)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('CWA-42/CWA-30: fail-closed configuration', () => {
  function withPatchedEnv(patch: Record<string, string | undefined>): () => void {
    const saved: Record<string, string | undefined> = {};
    for (const key of Object.keys(patch)) {
      saved[key] = process.env[key];
      if (patch[key] === undefined) delete process.env[key];
      else process.env[key] = patch[key];
    }
    return () => {
      for (const key of Object.keys(patch)) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key] as string;
      }
    };
  }

  function loadConfig(): typeof CONFIG {
    let loaded: typeof CONFIG | undefined;
    jest.isolateModules(() => {
      loaded = require('../config').CONFIG;
    });
    return loaded as typeof CONFIG;
  }

  test('missing JWT_SECRET aborts startup (no dev fallback secret)', () => {
    const restore = withPatchedEnv({ JWT_SECRET: undefined });
    try {
      jest.isolateModules(() => {
        expect(() => require('../config')).toThrow(/JWT_SECRET/);
      });
    } finally {
      restore();
    }
  });

  test('missing SIWE_DOMAIN aborts startup (no permissive fallback)', () => {
    const restore = withPatchedEnv({ SIWE_DOMAIN: undefined });
    try {
      jest.isolateModules(() => {
        expect(() => require('../config')).toThrow(/SIWE_DOMAIN/);
      });
    } finally {
      restore();
    }
  });

  test('missing SIWE_URI aborts startup (no permissive fallback)', () => {
    const restore = withPatchedEnv({ SIWE_URI: undefined });
    try {
      jest.isolateModules(() => {
        expect(() => require('../config')).toThrow(/SIWE_URI/);
      });
    } finally {
      restore();
    }
  });

  test('CHAIN_ID without IFRLOCK_ADDRESS aborts startup (no mixed-network default)', () => {
    const restore = withPatchedEnv({ CHAIN_ID: '1', IFRLOCK_ADDRESS: undefined });
    try {
      jest.isolateModules(() => {
        expect(() => require('../config')).toThrow(/together/);
      });
    } finally {
      restore();
    }
  });

  test('IFRLOCK_ADDRESS without CHAIN_ID aborts startup (no mixed-network default)', () => {
    const restore = withPatchedEnv({
      CHAIN_ID: undefined,
      IFRLOCK_ADDRESS: '0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb',
    });
    try {
      jest.isolateModules(() => {
        expect(() => require('../config')).toThrow(/together/);
      });
    } finally {
      restore();
    }
  });

  test('explicit CHAIN_ID + IFRLOCK_ADDRESS pair is honored', () => {
    const restore = withPatchedEnv({
      CHAIN_ID: '1',
      IFRLOCK_ADDRESS: '0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb',
    });
    try {
      const cfg = loadConfig();
      expect(cfg.chainId).toBe(1);
      expect(cfg.ifrLockAddress).toBe('0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb');
    } finally {
      restore();
    }
  });

  test('default network is one consistent Sepolia pair', () => {
    const restore = withPatchedEnv({ CHAIN_ID: undefined, IFRLOCK_ADDRESS: undefined });
    try {
      const cfg = loadConfig();
      expect(cfg.chainId).toBe(11155111);
      expect(cfg.ifrLockAddress).toBe('0x0Cab0A9440643128540222acC6eF5028736675d3');
    } finally {
      restore();
    }
  });

  test('test env is not production (OAuth cookie without Secure flag)', () => {
    expect(CONFIG.isProduction).toBe(false);
  });

  test('NODE_ENV=production enables isProduction (Secure OAuth cookie)', () => {
    const restore = withPatchedEnv({ NODE_ENV: 'production' });
    try {
      const cfg = loadConfig();
      expect(cfg.isProduction).toBe(true);
    } finally {
      restore();
    }
  });
});
