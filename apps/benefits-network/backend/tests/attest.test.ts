import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';

// ── Mock ifrLockService BEFORE importing sessionService ────────────

const mockCheckLock = jest.fn();
const mockCheckBenefitEligibility = jest.fn();
const mockRecoverSigner = jest.fn();

jest.mock('../src/services/ifrLockService', () => ({
  checkLock: (...args: unknown[]) => mockCheckLock(...args),
  checkBenefitEligibility: async (...args: unknown[]) => {
    const result = await mockCheckBenefitEligibility(...args);
    return {
      lockEligible: result.eligible,
      heldEligible: true,
      walletAmount: null,
      walletBalanceRaw: null,
      ifrLockAmount: result.lockedAmount,
      commitmentAmount: null,
      verifiedLockSource: result.eligible ? 'ifrlock' : null,
      verificationBlock: 1,
      ...result,
    };
  },
  recoverSigner: (...args: unknown[]) => mockRecoverSigner(...args),
  initProvider: jest.fn(),
}));

jest.mock('../src/config', () => ({
  config: {
    CHAIN_ID: 11155111,
    SELLER_AUTH_DOMAIN: 'shop.example.test',
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
  CUSTOMER_CHALLENGE_DOMAIN,
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
  await prisma.product.deleteMany();
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
  await prisma.product.deleteMany();
  await prisma.checkoutOperator.deleteMany();
  await prisma.business.deleteMany();
  await prisma.$disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckBenefitEligibility.mockImplementation((...args: unknown[]) => mockCheckLock(...args));
});

// ── Test 1: Signature Verification ─────────────────────────────────

describe('Signature Verification', () => {
  it('recovers the correct wallet address from a valid signature', async () => {
    // Use real ethers to create and verify a signature
    const wallet = ethers.Wallet.createRandom();
    const message = 'test message';
    const signature = await wallet.signMessage(message);
    const recovered = ethers.verifyMessage(message, signature);

    expect(recovered).toBe(wallet.address);
  });

  it('binds customer signatures to the canonical Shop domain', async () => {
    const session = await createSession(testBusinessId);
    const challenge = await buildChallengeMessage(session.sessionId);
    const domainLines = challenge.split('\n').filter((line) => line.startsWith('Domain: '));

    expect(domainLines).toEqual([`Domain: ${CUSTOMER_CHALLENGE_DOMAIN}`]);

    const wallet = ethers.Wallet.createRandom();
    const currentSignature = await wallet.signMessage(challenge);
    expect(ethers.verifyMessage(challenge, currentSignature)).toBe(wallet.address);

    const formerDomainlessChallenge = challenge
      .split('\n')
      .filter((line) => !line.startsWith('Domain: '))
      .join('\n');
    const formerSignature = await wallet.signMessage(formerDomainlessChallenge);
    expect(ethers.verifyMessage(challenge, formerSignature)).not.toBe(wallet.address);
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

  it('atomically binds concurrent attest attempts to only one customer wallet', async () => {
    const session = await createSession(testBusinessId);
    const otherWallet = ethers.Wallet.createRandom().address;
    mockRecoverSigner
      .mockReturnValueOnce(TEST_WALLET)
      .mockReturnValueOnce(otherWallet);
    mockCheckLock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { eligible: true, lockedAmount: '10000.0' };
    });

    const outcomes = await Promise.allSettled([
      attest(session.sessionId, '0xfirst'),
      attest(session.sessionId, '0xsecond'),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const stored = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(stored.status).toBe('APPROVED');
    expect(stored.attestAttempts).toBe(1);
    expect([TEST_WALLET, otherWallet]).toContain(stored.recoveredAddress);
    const winner = outcomes.find((outcome) => outcome.status === 'fulfilled') as PromiseFulfilledResult<{ wallet?: string }>;
    expect(winner.value.wallet).toBe(stored.recoveredAddress);
    const audits = await prisma.auditLog.findMany({ where: { sessionId: session.sessionId } });
    expect(audits.filter((entry) => entry.type === 'ATTEST_FAIL')).toHaveLength(0);
    expect(audits.filter((entry) => entry.type === 'ATTEST_OK')).toHaveLength(1);
  });

  it('keeps the approval unique when many eligible wallets race', async () => {
    const session = await createSession(testBusinessId);
    const wallets = Array.from({ length: 3 }, () => ethers.Wallet.createRandom().address);
    wallets.forEach((wallet) => mockRecoverSigner.mockReturnValueOnce(wallet));
    mockCheckLock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { eligible: true, lockedAmount: '10000.0' };
    });

    const outcomes = await Promise.allSettled(wallets.map((_, index) => attest(session.sessionId, `0x${index}`)));
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        // Losers fail closed: state check, binding check or SQLite lock contention.
        expect(String(outcome.reason)).toMatch(/cannot attest|already bound|Transaction/);
      }
    }
    const stored = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(stored).toMatchObject({ status: 'APPROVED', attestAttempts: 1 });
    expect(wallets).toContain(stored.recoveredAddress);
    expect(await prisma.auditLog.count({ where: { sessionId: session.sessionId, type: 'ATTEST_OK' } })).toBe(1);
  }, 30_000);
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
    expect(mockCheckBenefitEligibility).toHaveBeenCalledWith(TEST_WALLET, 5000, 0, 'ifrlock');
    expect(mockCheckLock).toHaveBeenCalledWith(TEST_WALLET, 5000, 0, 'ifrlock');
  });

  it('requires both locked and freely held IFR for an opted-in rule', async () => {
    const rule = await prisma.benefitRule.create({
      data: {
        businessId: testBusinessId,
        label: 'Lock and hold',
        category: 'Retail',
        productName: 'Member bundle',
        discountPercent: 15,
        requiredLockIFR: 5000,
        minIFRHeld: 1250,
        ttlSeconds: 120,
      },
    });
    const insufficient = await createSession(testBusinessId, rule.id);
    expect(await buildChallengeMessage(insufficient.sessionId)).toContain('Minimum Held IFR: 1250');

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckBenefitEligibility.mockResolvedValue({
      eligible: false,
      lockEligible: true,
      heldEligible: false,
      lockedAmount: '5000.0',
      walletAmount: '1249.999999999',
      walletBalanceRaw: '1249999999999',
    });

    const rejected = await attest(insufficient.sessionId, TEST_SIGNATURE);
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      eligible: false,
      attemptsRemaining: 3,
    });
    expect(rejected.reason).toContain('Insufficient wallet balance');
    expect(mockCheckBenefitEligibility).toHaveBeenCalledWith(TEST_WALLET, 5000, 1250, 'ifrlock');
    expect(mockCheckLock).not.toHaveBeenCalled();
    const rejectedSession = await prisma.session.findUniqueOrThrow({ where: { id: insufficient.sessionId } });
    expect(rejectedSession).toMatchObject({
      status: 'PENDING',
      benefitSnapshotVersion: 5,
      benefitMinIFRHeld: 1250,
      attestAttempts: 0,
      recoveredAddress: null,
      walletBalanceRaw: null,
      reason: null,
    });

    jest.clearAllMocks();
    const sufficient = await createSession(testBusinessId, rule.id);
    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckBenefitEligibility.mockResolvedValue({
      eligible: true,
      lockEligible: true,
      heldEligible: true,
      lockedAmount: '5000.0',
      walletAmount: '1250.0',
      walletBalanceRaw: '1250000000000',
    });
    await expect(attest(sufficient.sessionId, TEST_SIGNATURE)).resolves.toMatchObject({
      status: 'APPROVED',
      eligible: true,
      benefit: { minIFRHeld: 1250 },
    });
    const approvedSession = await prisma.session.findUniqueOrThrow({ where: { id: sufficient.sessionId } });
    expect(approvedSession).toMatchObject({
      status: 'APPROVED',
      walletBalanceRaw: '1250000000000',
    });
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
    expect(first.reason).toContain('retry this QR session');
    expect(first.attemptsRemaining).toBe(3);

    const savedAfterFirst = await prisma.session.findUniqueOrThrow({
      where: { id: session.sessionId },
    });
    expect(savedAfterFirst).toMatchObject({
      status: 'PENDING', attestAttempts: 0, recoveredAddress: null, reason: null,
    });

    const second = await attest(session.sessionId, TEST_SIGNATURE);
    expect(second.status).toBe('APPROVED');
    const savedAfterSecond = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(savedAfterSecond).toMatchObject({ status: 'APPROVED', attestAttempts: 1, recoveredAddress: TEST_WALLET });
  });

  it('lets neither invalid nor valid-but-ineligible signatures burn attempts or bind the session', async () => {
    const biz = await prisma.business.create({
      data: { name: 'Griefing Test', discountPercent: 10, requiredLockIFR: 1000, ttlSeconds: 300 },
    });
    const session = await createSession(biz.id);
    const auditsBefore = await prisma.auditLog.count({ where: { sessionId: session.sessionId } });
    const pristine = { status: 'PENDING', attestAttempts: 0, recoveredAddress: null, reason: null };

    // Session-ID holders without wallet authority (CWA-37).
    mockRecoverSigner.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    for (let index = 0; index < 5; index += 1) {
      const griefing = await attest(session.sessionId, TEST_SIGNATURE);
      expect(griefing.status).toBe('REJECTED');
      expect(griefing.attemptsRemaining).toBe(3);
    }
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } })).toMatchObject(pristine);

    // A valid signature from a foreign, ineligible wallet is equally read-only.
    const foreignWallet = ethers.Wallet.createRandom().address;
    mockRecoverSigner.mockReset();
    mockRecoverSigner.mockReturnValue(foreignWallet);
    mockCheckBenefitEligibility.mockResolvedValue({ eligible: false, lockedAmount: '0' });
    for (let index = 0; index < 5; index += 1) {
      const foreign = await attest(session.sessionId, TEST_SIGNATURE);
      expect(foreign).toMatchObject({ status: 'REJECTED', eligible: false, wallet: foreignWallet, attemptsRemaining: 3 });
    }
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } })).toMatchObject(pristine);
    expect(await prisma.auditLog.count({ where: { sessionId: session.sessionId } })).toBe(auditsBefore);

    // The legitimate eligible customer can still bind and approve afterwards.
    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckBenefitEligibility.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });
    await expect(attest(session.sessionId, TEST_SIGNATURE)).resolves.toMatchObject({ status: 'APPROVED', wallet: TEST_WALLET });
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } }))
      .toMatchObject({ status: 'APPROVED', attestAttempts: 1, recoveredAddress: TEST_WALLET });
  });

  it('leaves attempts, binding, status and audit untouched when the eligibility RPC fails', async () => {
    const biz = await prisma.business.create({
      data: { name: 'RPC Failure', discountPercent: 10, requiredLockIFR: 1000, ttlSeconds: 300 },
    });
    const session = await createSession(biz.id);
    const auditsBefore = await prisma.auditLog.count({ where: { sessionId: session.sessionId } });
    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckBenefitEligibility.mockRejectedValue(new Error('rpc down'));

    for (let index = 0; index < 4; index += 1) {
      await expect(attest(session.sessionId, TEST_SIGNATURE)).rejects.toThrow('On-chain verification failed: rpc down');
    }
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } }))
      .toMatchObject({ status: 'PENDING', attestAttempts: 0, recoveredAddress: null, reason: null });
    expect(await prisma.auditLog.count({ where: { sessionId: session.sessionId } })).toBe(auditsBefore);

    mockCheckBenefitEligibility.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });
    await expect(attest(session.sessionId, TEST_SIGNATURE)).resolves.toMatchObject({ status: 'APPROVED' });
  });

  it('rejects a second wallet once a session is bound and approved', async () => {
    const session = await createSession(testBusinessId);
    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckBenefitEligibility.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });
    await attest(session.sessionId, TEST_SIGNATURE);

    mockRecoverSigner.mockReturnValue(ethers.Wallet.createRandom().address);
    await expect(attest(session.sessionId, TEST_SIGNATURE)).rejects.toThrow('Session is APPROVED, cannot attest');
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } }))
      .toMatchObject({ status: 'APPROVED', attestAttempts: 1, recoveredAddress: TEST_WALLET });
  });

  it('still enforces the stored attempt ceiling', async () => {
    const session = await createSession(testBusinessId);
    await prisma.session.update({ where: { id: session.sessionId }, data: { attestAttempts: 3 } });
    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckBenefitEligibility.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });
    await expect(attest(session.sessionId, TEST_SIGNATURE)).rejects.toThrow('Maximum attest attempts exceeded');
    expect(mockCheckBenefitEligibility).not.toHaveBeenCalled();
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } }))
      .toMatchObject({ status: 'PENDING', attestAttempts: 3, recoveredAddress: null });
  });

  it('does not expire a session on invalid-signature input', async () => {
    const biz = await prisma.business.create({
      data: { name: 'Expired Attest', discountPercent: 10, requiredLockIFR: 1000, ttlSeconds: 300 },
    });
    const session = await createSession(biz.id);
    await prisma.session.update({
      where: { id: session.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    mockRecoverSigner.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    await expect(attest(session.sessionId, TEST_SIGNATURE)).rejects.toThrow('Session expired');
    const saved = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(saved.status).toBe('PENDING');
  });
});
