import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';

// ── Mock ifrLockService ────────────────────────────────────────────

const mockCheckLock = jest.fn();
const mockRecoverSigner = jest.fn();

jest.mock('../src/services/ifrLockService', () => ({
  checkLock: (...args: unknown[]) => mockCheckLock(...args),
  recoverSigner: (...args: unknown[]) => mockRecoverSigner(...args),
  initProvider: jest.fn(),
}));

jest.mock('../src/config', () => ({
  config: {
    CHAIN_ID: 11155111,
    RPC_URL: 'https://mock-rpc.example.com',
    IFRLOCK_ADDRESS: '0x0000000000000000000000000000000000000001',
    ADMIN_SECRET: 'test-secret-12345',
    DATABASE_URL: 'file:./test.db',
    PORT: 3001,
  },
}));

import {
  createSession,
  buildChallengeMessage,
  attest,
  redeem,
  prisma,
} from '../src/services/sessionService';

// ── Test Setup ──────────────────────────────────────────────────────

const TEST_WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
let testBusinessId: string;

beforeAll(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.business.deleteMany();

  const biz = await prisma.business.create({
    data: {
      name: 'Integration Test Business',
      discountPercent: 15,
      requiredLockIFR: 5000,
      ttlSeconds: 60,
      tierLabel: 'Silver',
    },
  });
  testBusinessId = biz.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.business.deleteMany();
  await prisma.$disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── E2E: Lock → Verify → Redeem Flow ─────────────────────────────

describe('E2E: IFR Lock → Benefits Network Verification', () => {
  it('complete flow: create session → challenge → attest (locked) → redeem', async () => {
    // Step 1: Business creates a session (QR code generation)
    const session = await createSession(testBusinessId);
    expect(session.sessionId).toBeDefined();
    expect(session.discountPercent).toBe(15);
    expect(session.requiredLockIFR).toBe(5000);
    expect(session.tierLabel).toBe('Silver');

    // Step 2: Customer gets challenge message (nonce is internal, fetched from DB)
    const challenge = await buildChallengeMessage(session.sessionId);
    expect(challenge).toContain('IFR Benefits Network');
    expect(challenge).toContain(session.sessionId);

    // Step 3: Customer signs challenge and submits → on-chain lock check
    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '10000.0' });

    const attestResult = await attest(session.sessionId, '0xmocksignature');
    expect(attestResult.status).toBe('APPROVED');
    expect(attestResult.wallet).toBe(TEST_WALLET);
    expect(attestResult.eligible).toBe(true);

    // Step 4: Business redeems the discount
    const redeemResult = await redeem(session.sessionId);
    expect(redeemResult.status).toBe('REDEEMED');
  });

  it('rejects user with insufficient lock amount', async () => {
    const session = await createSession(testBusinessId);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    // User has 2000 IFR locked, business requires 5000
    mockCheckLock.mockResolvedValue({ eligible: false, lockedAmount: '2000.0' });

    const result = await attest(session.sessionId, '0xmocksignature');
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toContain('Insufficient lock');
    expect(result.reason).toContain('2000.0');
  });

  it('prevents replay of approved session', async () => {
    const session = await createSession(testBusinessId);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });

    await attest(session.sessionId, '0xmocksignature');

    // Replay attempt
    await expect(attest(session.sessionId, '0xmocksignature'))
      .rejects.toThrow('Session is APPROVED, cannot attest');
  });

  it('prevents double redemption', async () => {
    const session = await createSession(testBusinessId);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });

    await attest(session.sessionId, '0xmocksignature');
    await redeem(session.sessionId);

    await expect(redeem(session.sessionId)).rejects.toThrow('already redeemed');
  });

  it('handles invalid signature gracefully', async () => {
    const session = await createSession(testBusinessId);

    mockRecoverSigner.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const result = await attest(session.sessionId, '0xinvalid');
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('Invalid signature');
  });
});

// ── Signature Verification (EIP-191) ─────────────────────────────

describe('EIP-191 Signature Verification', () => {
  it('verifies ethers.js personal sign round-trip', async () => {
    const wallet = ethers.Wallet.createRandom();
    const message = 'IFR Benefits: verify-nonce-abc123';
    const signature = await wallet.signMessage(message);
    const recovered = ethers.utils.verifyMessage(message, signature);
    expect(recovered).toBe(wallet.address);
  });

  it('different messages produce different signatures', async () => {
    const wallet = ethers.Wallet.createRandom();
    const sig1 = await wallet.signMessage('message1');
    const sig2 = await wallet.signMessage('message2');
    expect(sig1).not.toBe(sig2);
  });
});

// ── 9-Decimal IFR Conversion ─────────────────────────────────────

describe('IFR 9-Decimal Handling', () => {
  it('checkLock is called with human-readable IFR amount', async () => {
    // Create own business to avoid cross-test interference
    const biz = await prisma.business.create({
      data: {
        name: 'Decimal Test Business',
        discountPercent: 10,
        requiredLockIFR: 5000,
        ttlSeconds: 60,
      },
    });
    const session = await createSession(biz.id);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });

    await attest(session.sessionId, '0xmocksignature');

    // Service should pass 5000 (human units), not 5000000000000 (base units)
    expect(mockCheckLock).toHaveBeenCalledWith(TEST_WALLET, 5000);
  });
});
