import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';

// ── Mock ifrLockService BEFORE importing sessionService ────────────

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

// ── Test Setup ─────────────────────────────────────────────────────

const TEST_WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TEST_OWNER = ethers.Wallet.createRandom().address;
const REDEEM_ACTOR = { walletAddress: TEST_OWNER, role: 'OWNER' as const };
const TEST_SIGNATURE = '0xdeadbeef';

let testBusinessId: string;

beforeAll(async () => {
  // Clean DB
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.benefitRule.deleteMany();
  await prisma.checkoutOperator.deleteMany();
  await prisma.business.deleteMany();

  // Create test business
  const biz = await prisma.business.create({
    data: {
      name: 'Test Business',
      ownerAddress: TEST_OWNER,
      discountPercent: 20,
      requiredLockIFR: 5000,
      ttlSeconds: 60,
      tierLabel: 'Gold',
    },
  });
  testBusinessId = biz.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.benefitRule.deleteMany();
  await prisma.checkoutOperator.deleteMany();
  await prisma.business.deleteMany();
  await prisma.$disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Test 1: Signature Verification ─────────────────────────────────

describe('Signature Verification', () => {
  it('recovers the correct wallet address from a valid signature', async () => {
    // Use real ethers to create and verify a signature
    const wallet = ethers.Wallet.createRandom();
    const message = 'test message';
    const signature = await wallet.signMessage(message);
    const recovered = ethers.utils.verifyMessage(message, signature);

    expect(recovered).toBe(wallet.address);
  });
});

// ── Test 2: Session Expiry ─────────────────────────────────────────

describe('Session Expiry', () => {
  it('rejects attest on expired session', async () => {
    // Create a business with 1-second TTL
    const biz = await prisma.business.create({
      data: {
        name: 'Expiry Test',
        discountPercent: 10,
        requiredLockIFR: 1000,
        ttlSeconds: 1,
      },
    });

    const session = await createSession(biz.id);

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 1100));

    mockRecoverSigner.mockReturnValue(TEST_WALLET);

    await expect(attest(session.sessionId, TEST_SIGNATURE)).rejects.toThrow(
      'Session expired'
    );
  });
});

// ── Test 3: Replay Prevention ──────────────────────────────────────

describe('Replay Prevention', () => {
  it('rejects attest on a session that was already approved', async () => {
    const session = await createSession(testBusinessId);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '10000.0' });

    // First attest succeeds
    const result = await attest(session.sessionId, TEST_SIGNATURE);
    expect(result.status).toBe('APPROVED');

    // Second attest on same session fails
    await expect(attest(session.sessionId, TEST_SIGNATURE)).rejects.toThrow(
      'Session is APPROVED, cannot attest'
    );
  });
});

// ── Test 4: Redeem-Once ────────────────────────────────────────────

describe('Redeem-Once', () => {
  it('allows redeem only once', async () => {
    const session = await createSession(testBusinessId);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '10000.0' });

    await attest(session.sessionId, TEST_SIGNATURE);

    // First redeem succeeds
    const result = await redeem(session.sessionId, REDEEM_ACTOR);
    expect(result.status).toBe('REDEEMED');

    // Second redeem fails
    await expect(redeem(session.sessionId, REDEEM_ACTOR)).rejects.toThrow('already redeemed');
  });
});

// ── Test 5: Lock Threshold + 9 Decimal Conversion ──────────────────

describe('Lock Threshold', () => {
  it('rejects when locked amount is below required threshold', async () => {
    const session = await createSession(testBusinessId);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    // Business requires 5000 IFR, user only has 2500
    mockCheckLock.mockResolvedValue({ eligible: false, lockedAmount: '2500.0' });

    const result = await attest(session.sessionId, TEST_SIGNATURE);
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toContain('Insufficient lock');
    expect(result.reason).toContain('2500.0');
  });

  it('calls checkLock with human IFR units (service handles 9-decimal conversion)', async () => {
    const session = await createSession(testBusinessId);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });

    await attest(session.sessionId, TEST_SIGNATURE);

    // Verify checkLock was called with human units (5000), not base units
    expect(mockCheckLock).toHaveBeenCalledWith(TEST_WALLET, 5000);
  });
});

// ── Test 6: Attest Attempt Limit ───────────────────────────────────

describe('Attest Attempt Limit', () => {
  it('allows insufficient-lock retry before the attempt limit is exhausted', async () => {
    const session = await createSession(testBusinessId);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock
      .mockResolvedValueOnce({ eligible: false, lockedAmount: '0' })
      .mockResolvedValueOnce({ eligible: true, lockedAmount: '5000.0' });

    const first = await attest(session.sessionId, TEST_SIGNATURE);
    expect(first.status).toBe('REJECTED');
    expect(first.attemptsRemaining).toBe(2);

    const savedAfterFirst = await prisma.session.findUniqueOrThrow({
      where: { id: session.sessionId },
    });
    expect(savedAfterFirst.status).toBe('PENDING');
    expect(savedAfterFirst.reason).toContain('retry this QR session');

    const second = await attest(session.sessionId, TEST_SIGNATURE);
    expect(second.status).toBe('APPROVED');
  });

  it('marks the session rejected after 3 failed attest attempts', async () => {
    // Create business with high TTL to avoid expiry
    const biz = await prisma.business.create({
      data: {
        name: 'Rate Limit Test',
        discountPercent: 10,
        requiredLockIFR: 1000,
        ttlSeconds: 300,
      },
    });
    const session = await createSession(biz.id);

    // Simulate invalid signatures that don't change status
    mockRecoverSigner.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const r1 = await attest(session.sessionId, TEST_SIGNATURE);
    expect(r1.status).toBe('REJECTED');
    expect(r1.attemptsRemaining).toBe(2);
    const afterFirst = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(afterFirst.status).toBe('PENDING');

    const r2 = await attest(session.sessionId, TEST_SIGNATURE);
    expect(r2.status).toBe('REJECTED');
    expect(r2.attemptsRemaining).toBe(1);
    const afterSecond = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(afterSecond.status).toBe('PENDING');

    const r3 = await attest(session.sessionId, TEST_SIGNATURE);
    expect(r3.status).toBe('REJECTED');
    expect(r3.attemptsRemaining).toBe(0);
    const afterThird = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(afterThird.status).toBe('REJECTED');
    expect(afterThird.reason).toContain('attempts exhausted');

    await expect(attest(session.sessionId, TEST_SIGNATURE)).rejects.toThrow(
      'Session is REJECTED, cannot attest'
    );
  });
});
