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
  CHECKOUT_PROOF_VERSION_LABEL,
  CustomerProofMismatchError,
  attest,
  prisma,
} from '../src/services/sessionService';
import * as sessionService from '../src/services/sessionService';

// ── Test Setup ─────────────────────────────────────────────────────

const TEST_WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TEST_OWNER = ethers.Wallet.createRandom().address;
const TEST_SIGNATURE = '0xdeadbeef';

let testBusinessId: string;

async function cleanDb() {
  await prisma.rewardEvent.deleteMany();
  await prisma.sellerRewardLink.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.customerPass.deleteMany();
  await prisma.benefitRule.deleteMany();
  await prisma.product.deleteMany();
  await prisma.checkoutOperator.deleteMany();
  await prisma.business.deleteMany();
}

/**
 * Owner decision B (T-231b): attest refuses checkouts without a recorded seller confirmation.
 * The unauthenticated service `createSession` records none, so service-level tests record the
 * owner's confirmation exactly as the authenticated sessions:create route would.
 */
async function createConfirmedSession(businessId: string, benefitRuleId?: string) {
  const session = await createSession(businessId, benefitRuleId);
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  await prisma.session.update({
    where: { id: session.sessionId },
    data: { confirmedByWallet: business.ownerAddress, confirmedByRole: 'OWNER', confirmedByOperatorId: null },
  });
  return session;
}

/** Recovered signer chosen per signature, so concurrent calls do not depend on call order. */
function recoverBySignature(map: Record<string, string>) {
  mockRecoverSigner.mockImplementation((_message: string, signature: string) => {
    const wallet = map[signature];
    if (!wallet) throw new Error('invalid signature');
    return wallet;
  });
}

beforeAll(async () => {
  await cleanDb();

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
  await cleanDb();
  await prisma.$disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRecoverSigner.mockReset();
  mockCheckBenefitEligibility.mockReset();
  mockCheckLock.mockReset();
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

  it('no longer exports the v1 customer challenge domain or a separate redeem step', () => {
    expect((sessionService as Record<string, unknown>).CUSTOMER_CHALLENGE_DOMAIN).toBeUndefined();
    expect((sessionService as Record<string, unknown>).redeem).toBeUndefined();
  });

  it('binds customer signatures to the configured seller audience and the v2 proof version', async () => {
    const wallet = ethers.Wallet.createRandom();
    const session = await createConfirmedSession(testBusinessId);
    const challenge = await buildChallengeMessage(session.sessionId, wallet.address);
    const lines = challenge.split('\n');

    expect(lines.filter((line) => line.startsWith('Audience: '))).toEqual(['Audience: shop.example.test']);
    expect(lines.filter((line) => line.startsWith('Version: '))).toEqual([`Version: ${CHECKOUT_PROOF_VERSION_LABEL}`]);
    expect(CHECKOUT_PROOF_VERSION_LABEL).toBe('ifr-benefits/checkout-proof/2');
    expect(lines.filter((line) => line.startsWith('Wallet: '))).toEqual([`Wallet: ${wallet.address}`]);
    expect(lines.some((line) => line.startsWith('Domain: '))).toBe(false);

    const currentSignature = await wallet.signMessage(challenge);
    expect(ethers.verifyMessage(challenge, currentSignature)).toBe(wallet.address);

    const formerAudiencelessChallenge = lines.filter((line) => !line.startsWith('Audience: ')).join('\n');
    const formerSignature = await wallet.signMessage(formerAudiencelessChallenge);
    expect(ethers.verifyMessage(challenge, formerSignature)).not.toBe(wallet.address);

    // End to end with real EIP-191 recovery: audience-less, foreign-audience and v1 texts are
    // explicit mismatches and never reach the eligibility check.
    mockRecoverSigner.mockImplementation((message: string, signature: string) => ethers.verifyMessage(message, signature));
    const foreignAudience = challenge.replace(/^Audience: .*$/m, 'Audience: evil.example');
    const versionOne = challenge.replace(/^Version: .*$/m, 'Version: ifr-benefits/checkout-proof/1');
    for (const text of [formerAudiencelessChallenge, foreignAudience, versionOne]) {
      const signature = await wallet.signMessage(text);
      await expect(attest(session.sessionId, wallet.address, signature)).rejects.toBeInstanceOf(CustomerProofMismatchError);
    }
    expect(mockCheckBenefitEligibility).not.toHaveBeenCalled();
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } }))
      .toMatchObject({ status: 'PENDING', attestAttempts: 0 });

    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '10000.0' });
    await expect(attest(session.sessionId, wallet.address, currentSignature)).resolves.toMatchObject({
      status: 'REDEEMED',
      wallet: wallet.address,
      proof: { version: CHECKOUT_PROOF_VERSION_LABEL, message: challenge },
    });
  });

  it('rejects a malformed claimed wallet before reading the session', async () => {
    const session = await createConfirmedSession(testBusinessId);
    await expect(buildChallengeMessage(session.sessionId, 'not-a-wallet')).rejects.toThrow('A valid wallet address is required');
    await expect(attest(session.sessionId, '0x1234', TEST_SIGNATURE)).rejects.toThrow('A valid wallet address is required');
    expect(mockRecoverSigner).not.toHaveBeenCalled();
  });
});

// ── Test 2: Session Expiry ─────────────────────────────────────────

describe('Session Expiry', () => {
  it('rejects attest on expired session', async () => {
    // Create a business with 1-second TTL
    const biz = await prisma.business.create({
      data: {
        name: 'Expiry Test',
        ownerAddress: TEST_OWNER,
        discountPercent: 10,
        requiredLockIFR: 1000,
        ttlSeconds: 1,
      },
    });

    const session = await createConfirmedSession(biz.id);

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 1100));

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '10000.0' });

    await expect(attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE)).rejects.toThrow(
      'Session expired'
    );
    expect(mockCheckBenefitEligibility).not.toHaveBeenCalled();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } })).status).not.toBe('REDEEMED');
  });
});

// ── Test 3: Replay Prevention ──────────────────────────────────────

describe('Replay Prevention', () => {
  it('rejects attest on a session that was already redeemed', async () => {
    const session = await createConfirmedSession(testBusinessId);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '10000.0' });

    // First proof redeems
    const result = await attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE);
    expect(result.status).toBe('REDEEMED');

    // Second proof on same session fails
    await expect(attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE)).rejects.toThrow(
      'Session is REDEEMED, cannot attest'
    );
  });

  it('atomically redeems concurrent proofs from two wallets only once', async () => {
    const session = await createConfirmedSession(testBusinessId);
    const otherWallet = ethers.Wallet.createRandom().address;
    recoverBySignature({ '0xf1': TEST_WALLET, '0xf2': otherWallet });
    mockCheckLock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { eligible: true, lockedAmount: '10000.0' };
    });

    const outcomes = await Promise.allSettled([
      attest(session.sessionId, TEST_WALLET, '0xf1'),
      attest(session.sessionId, otherWallet, '0xf2'),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const stored = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(stored.status).toBe('REDEEMED');
    expect(stored.attestAttempts).toBe(1);
    expect(stored).not.toHaveProperty('recoveredAddress');
    const winner = outcomes.find((outcome) => outcome.status === 'fulfilled') as PromiseFulfilledResult<{ wallet?: string; status: string }>;
    expect(winner.value.status).toBe('REDEEMED');
    expect([TEST_WALLET, otherWallet]).toContain(winner.value.wallet);
    const audits = await prisma.auditLog.findMany({ where: { sessionId: session.sessionId } });
    expect(audits.filter((entry) => entry.type === 'ATTEST_FAIL')).toHaveLength(0);
    expect(audits.filter((entry) => entry.type === 'ATTEST_OK')).toHaveLength(1);
    expect(audits.filter((entry) => entry.type === 'REDEEMED')).toHaveLength(1);
    const serializedAudits = JSON.stringify(audits).toLowerCase();
    expect(serializedAudits).not.toContain(TEST_WALLET.slice(2).toLowerCase());
    expect(serializedAudits).not.toContain(otherWallet.slice(2).toLowerCase());
  });

  it('keeps the redemption unique when many eligible wallets race', async () => {
    const session = await createConfirmedSession(testBusinessId);
    const wallets = Array.from({ length: 3 }, () => ethers.Wallet.createRandom().address);
    recoverBySignature(Object.fromEntries(wallets.map((wallet, index) => [`0x${index}`, wallet])));
    mockCheckLock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { eligible: true, lockedAmount: '10000.0' };
    });

    const outcomes = await Promise.allSettled(wallets.map((wallet, index) => attest(session.sessionId, wallet, `0x${index}`)));
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        // Losers fail closed: state check, conditional update or SQLite lock contention.
        expect(String(outcome.reason)).toMatch(/cannot attest|already redeemed|Transaction/);
      }
    }
    const stored = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(stored).toMatchObject({ status: 'REDEEMED', attestAttempts: 1 });
    expect(await prisma.auditLog.count({ where: { sessionId: session.sessionId, type: 'ATTEST_OK' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { sessionId: session.sessionId, type: 'REDEEMED' } })).toBe(1);
  }, 30_000);
});

// ── Test 4: Redeem-Once ────────────────────────────────────────────

describe('Redeem-Once', () => {
  it('redeems in the proof request exactly once and records the confirming seller', async () => {
    const session = await createConfirmedSession(testBusinessId);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '10000.0' });

    const result = await attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE);
    expect(result).toMatchObject({ status: 'REDEEMED', eligible: true });
    const first = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(first).toMatchObject({ status: 'REDEEMED', proofVersion: 2, selfRedemption: false, verifiedLockSource: 'ifrlock' });
    expect(first.redeemedAt).toBeInstanceOf(Date);
    const redeemedAudit = await prisma.auditLog.findFirstOrThrow({ where: { sessionId: session.sessionId, type: 'REDEEMED' } });
    expect(JSON.parse(redeemedAudit.payload)).toMatchObject({ actorWallet: TEST_OWNER, actorRole: 'OWNER', confirmation: 'sessions:create' });

    // A second proof, even from another eligible wallet, cannot redeem again.
    const second = ethers.Wallet.createRandom().address;
    mockRecoverSigner.mockReturnValue(second);
    await expect(attest(session.sessionId, second, TEST_SIGNATURE)).rejects.toThrow('Session is REDEEMED, cannot attest');
    const after = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(after.redeemedAt).toEqual(first.redeemedAt);
    expect(after.attestAttempts).toBe(1);
    expect(await prisma.auditLog.count({ where: { sessionId: session.sessionId, type: 'REDEEMED' } })).toBe(1);
  });

  it('refuses a checkout without a seller confirmation before any eligibility read', async () => {
    const session = await createSession(testBusinessId);
    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '10000.0' });

    await expect(attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE)).rejects.toThrow(
      'Session has no seller checkout confirmation, cannot attest'
    );
    expect(mockCheckBenefitEligibility).not.toHaveBeenCalled();
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } }))
      .toMatchObject({ status: 'PENDING', attestAttempts: 0 });
  });
});

// ── Test 5: Lock Threshold + 9 Decimal Conversion ──────────────────

describe('Lock Threshold', () => {
  it('rejects when locked amount is below required threshold', async () => {
    const session = await createConfirmedSession(testBusinessId);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    // Business requires 5000 IFR, user only has 2500
    mockCheckLock.mockResolvedValue({ eligible: false, lockedAmount: '2500.0' });

    const result = await attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE);
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toContain('Insufficient lock');
    expect(result.reason).toContain('2500.0');
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } }))
      .toMatchObject({ status: 'PENDING', attestAttempts: 0, reason: null });
  });

  it('calls checkLock with human IFR units (service handles 9-decimal conversion)', async () => {
    const session = await createConfirmedSession(testBusinessId);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });

    await attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE);

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
    const insufficient = await createConfirmedSession(testBusinessId, rule.id);
    expect(await buildChallengeMessage(insufficient.sessionId, TEST_WALLET)).toContain('Minimum Held IFR: 1250');

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckBenefitEligibility.mockResolvedValue({
      eligible: false,
      lockEligible: true,
      heldEligible: false,
      lockedAmount: '5000.0',
      walletAmount: '1249.999999999',
      walletBalanceRaw: '1249999999999',
    });

    const rejected = await attest(insufficient.sessionId, TEST_WALLET, TEST_SIGNATURE);
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
      reason: null,
      selfRedemption: null,
      proofVersion: null,
    });

    jest.clearAllMocks();
    const sufficient = await createConfirmedSession(testBusinessId, rule.id);
    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckBenefitEligibility.mockResolvedValue({
      eligible: true,
      lockEligible: true,
      heldEligible: true,
      lockedAmount: '5000.0',
      walletAmount: '1250.0',
      walletBalanceRaw: '1250000000000',
    });
    await expect(attest(sufficient.sessionId, TEST_WALLET, TEST_SIGNATURE)).resolves.toMatchObject({
      status: 'REDEEMED',
      eligible: true,
      benefit: { minIFRHeld: 1250 },
    });
    const redeemedSession = await prisma.session.findUniqueOrThrow({ where: { id: sufficient.sessionId } });
    expect(redeemedSession).toMatchObject({ status: 'REDEEMED', benefitMinIFRHeld: 1250 });
    // Balances are checked in the request only and never persisted (owner decision B).
    expect(redeemedSession).not.toHaveProperty('walletBalanceRaw');
    expect(JSON.stringify(redeemedSession)).not.toContain('1250000000000');
  });
});

// ── Test 6: Attest Attempt Limit ───────────────────────────────────

describe('Attest Attempt Limit', () => {
  it('allows insufficient-lock retry before the attempt limit is exhausted', async () => {
    const session = await createConfirmedSession(testBusinessId);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock
      .mockResolvedValueOnce({ eligible: false, lockedAmount: '0' })
      .mockResolvedValueOnce({ eligible: true, lockedAmount: '5000.0' });

    const first = await attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE);
    expect(first.status).toBe('REJECTED');
    expect(first.reason).toContain('retry this QR session');
    expect(first.attemptsRemaining).toBe(3);

    const savedAfterFirst = await prisma.session.findUniqueOrThrow({
      where: { id: session.sessionId },
    });
    expect(savedAfterFirst).toMatchObject({
      status: 'PENDING', attestAttempts: 0, reason: null,
    });

    const second = await attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE);
    expect(second.status).toBe('REDEEMED');
    const savedAfterSecond = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(savedAfterSecond).toMatchObject({ status: 'REDEEMED', attestAttempts: 1 });
  });

  it('lets neither invalid, mismatched nor valid-but-ineligible signatures burn attempts or change the session', async () => {
    const biz = await prisma.business.create({
      data: { name: 'Griefing Test', ownerAddress: TEST_OWNER, discountPercent: 10, requiredLockIFR: 1000, ttlSeconds: 300 },
    });
    const session = await createConfirmedSession(biz.id);
    const auditsBefore = await prisma.auditLog.count({ where: { sessionId: session.sessionId } });
    const pristine = { status: 'PENDING', attestAttempts: 0, reason: null, redeemedAt: null, selfRedemption: null };

    // Session-ID holders without wallet authority (CWA-37).
    mockRecoverSigner.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    for (let index = 0; index < 5; index += 1) {
      const griefing = await attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE);
      expect(griefing.status).toBe('REJECTED');
      expect(griefing.attemptsRemaining).toBe(3);
    }
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } })).toMatchObject(pristine);

    // A valid signature from a foreign wallet presented as the customer's wallet is a mismatch.
    const foreignWallet = ethers.Wallet.createRandom().address;
    mockRecoverSigner.mockReset();
    mockRecoverSigner.mockReturnValue(foreignWallet);
    for (let index = 0; index < 5; index += 1) {
      await expect(attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE)).rejects.toBeInstanceOf(CustomerProofMismatchError);
    }
    expect(mockCheckBenefitEligibility).not.toHaveBeenCalled();
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } })).toMatchObject(pristine);

    // A valid signature from a foreign, ineligible wallet claiming itself is equally read-only.
    mockCheckBenefitEligibility.mockResolvedValue({ eligible: false, lockedAmount: '0' });
    for (let index = 0; index < 5; index += 1) {
      const foreign = await attest(session.sessionId, foreignWallet, TEST_SIGNATURE);
      expect(foreign).toMatchObject({ status: 'REJECTED', eligible: false, wallet: foreignWallet, attemptsRemaining: 3 });
    }
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } })).toMatchObject(pristine);
    expect(await prisma.auditLog.count({ where: { sessionId: session.sessionId } })).toBe(auditsBefore);

    // The legitimate eligible customer can still redeem afterwards.
    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckBenefitEligibility.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });
    await expect(attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE)).resolves.toMatchObject({ status: 'REDEEMED', wallet: TEST_WALLET });
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } }))
      .toMatchObject({ status: 'REDEEMED', attestAttempts: 1 });
  });

  it('leaves attempts, status and audit untouched and hides RPC detail when the eligibility RPC fails', async () => {
    const biz = await prisma.business.create({
      data: { name: 'RPC Failure', ownerAddress: TEST_OWNER, discountPercent: 10, requiredLockIFR: 1000, ttlSeconds: 300 },
    });
    const session = await createConfirmedSession(biz.id);
    const auditsBefore = await prisma.auditLog.count({ where: { sessionId: session.sessionId } });
    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckBenefitEligibility.mockRejectedValue(new Error(`rpc down for ${TEST_WALLET}`));

    for (let index = 0; index < 4; index += 1) {
      const failure = attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE);
      await expect(failure).rejects.toThrow('On-chain verification failed. Retry this checkout in a moment.');
      await expect(failure).rejects.not.toThrow(/rpc down|0x/i);
    }
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } }))
      .toMatchObject({ status: 'PENDING', attestAttempts: 0, reason: null });
    expect(await prisma.auditLog.count({ where: { sessionId: session.sessionId } })).toBe(auditsBefore);

    mockCheckBenefitEligibility.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });
    await expect(attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE)).resolves.toMatchObject({ status: 'REDEEMED' });
  });

  it('rejects a second wallet once a session is redeemed', async () => {
    const session = await createConfirmedSession(testBusinessId);
    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckBenefitEligibility.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });
    await attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE);

    const second = ethers.Wallet.createRandom().address;
    mockRecoverSigner.mockReturnValue(second);
    await expect(attest(session.sessionId, second, TEST_SIGNATURE)).rejects.toThrow('Session is REDEEMED, cannot attest');
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } }))
      .toMatchObject({ status: 'REDEEMED', attestAttempts: 1 });
  });

  it('still enforces the stored attempt ceiling', async () => {
    const session = await createConfirmedSession(testBusinessId);
    await prisma.session.update({ where: { id: session.sessionId }, data: { attestAttempts: 3 } });
    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckBenefitEligibility.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });
    await expect(attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE)).rejects.toThrow('Maximum attest attempts exceeded');
    expect(mockCheckBenefitEligibility).not.toHaveBeenCalled();
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } }))
      .toMatchObject({ status: 'PENDING', attestAttempts: 3, redeemedAt: null });
  });

  it('does not expire a session on invalid-signature input', async () => {
    const biz = await prisma.business.create({
      data: { name: 'Expired Attest', ownerAddress: TEST_OWNER, discountPercent: 10, requiredLockIFR: 1000, ttlSeconds: 300 },
    });
    const session = await createConfirmedSession(biz.id);
    await prisma.session.update({
      where: { id: session.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    mockRecoverSigner.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    await expect(attest(session.sessionId, TEST_WALLET, TEST_SIGNATURE)).rejects.toThrow('Session expired');
    const saved = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(saved.status).toBe('PENDING');
  });
});
