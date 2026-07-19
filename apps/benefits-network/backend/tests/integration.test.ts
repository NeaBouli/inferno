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
    MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: 5,
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
import { assertSellerBusinessLimit } from '../src/services/sellerLimits';

// ── Test Setup ──────────────────────────────────────────────────────

const TEST_WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TEST_OWNER = ethers.Wallet.createRandom().address;
const REDEEM_ACTOR = { walletAddress: TEST_OWNER, role: 'OWNER' as const };
let testBusinessId: string;

beforeAll(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.benefitRule.deleteMany();
  await prisma.product.deleteMany();
  await prisma.checkoutOperator.deleteMany();
  await prisma.business.deleteMany();

  const biz = await prisma.business.create({
    data: {
      name: 'Integration Test Business',
      ownerAddress: TEST_OWNER,
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
  await prisma.benefitRule.deleteMany();
  await prisma.product.deleteMany();
  await prisma.checkoutOperator.deleteMany();
  await prisma.business.deleteMany();
  await prisma.$disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── E2E: Lock → Verify → Redeem Flow ─────────────────────────────

describe('E2E: IFR Lock → Benefits Network Verification', () => {
  it('caps active seller profiles per owner wallet and ignores inactive profiles', async () => {
    const ownerAddress = '0x4f632748460E5277bF8435259cADce440AbAC254';

    await prisma.business.create({
      data: {
        name: 'Inactive Seller Profile',
        ownerAddress,
        active: false,
        discountPercent: 10,
        requiredLockIFR: 1000,
      },
    });

    await expect(assertSellerBusinessLimit(ownerAddress)).resolves.toBeUndefined();

    for (let index = 0; index < 5; index += 1) {
      await prisma.business.create({
        data: {
          name: `Active Seller Profile ${index + 1}`,
          ownerAddress,
          discountPercent: 10,
          requiredLockIFR: 1000,
        },
      });
    }

    await expect(assertSellerBusinessLimit(ownerAddress)).rejects.toThrow(
      'profile limit reached: 5/5'
    );
  });

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
    expect(challenge).toContain('Domain: shop.ifrunit.tech');
    expect(challenge).toContain(session.sessionId);

    // Step 3: Customer signs challenge and submits → on-chain lock check
    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '10000.0' });

    const attestResult = await attest(session.sessionId, '0xmocksignature');
    expect(attestResult.status).toBe('APPROVED');
    expect(attestResult.wallet).toBe(TEST_WALLET);
    expect(attestResult.eligible).toBe(true);

    // Step 4: Business redeems the discount
    const redeemResult = await redeem(session.sessionId, REDEEM_ACTOR);
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
    expect(result.attemptsRemaining).toBe(2);

    const saved = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(saved.status).toBe('PENDING');
    expect(saved.recoveredAddress).toBe(TEST_WALLET);
    expect(saved.lockAmountRaw).toBe('2000.0');
    expect(saved.reason).toContain('retry this QR session');
  });

  it('binds a QR session to a selected benefit rule', async () => {
    const rule = await prisma.benefitRule.create({
      data: {
        businessId: testBusinessId,
        label: 'Cafe Partner',
        category: 'Coffee',
        productName: 'Flat white discount',
        discountPercent: 25,
        requiredLockIFR: 7500,
        ttlSeconds: 120,
      },
    });

    const session = await createSession(testBusinessId, rule.id);
    expect(session.benefitRuleId).toBe(rule.id);
    expect(session.label).toBe('Cafe Partner');
    expect(session.productName).toBe('Flat white discount');
    expect(session.discountPercent).toBe(25);
    expect(session.requiredLockIFR).toBe(7500);
    expect(session.tierLabel).toBe('Cafe Partner');

    const challenge = await buildChallengeMessage(session.sessionId);
    expect(challenge).toContain(`Benefit Rule: ${rule.id}`);
    expect(challenge).toContain('Benefit: Cafe Partner');
    expect(challenge).toContain('Product: Flat white discount');
    expect(challenge).toContain('Required Lock IFR: 7500');
    expect(challenge).toContain('Discount Percent: 25');

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '8000.0' });

    const attestResult = await attest(session.sessionId, '0xmocksignature');
    expect(attestResult.status).toBe('APPROVED');
    expect(attestResult.benefit?.benefitRuleId).toBe(rule.id);
    expect(mockCheckLock).toHaveBeenCalledWith(TEST_WALLET, 7500);
  });

  it('rejects inactive or unrelated benefit rules when creating a QR session', async () => {
    const inactiveRule = await prisma.benefitRule.create({
      data: {
        businessId: testBusinessId,
        label: 'Paused',
        category: 'Food',
        productName: 'Paused benefit',
        discountPercent: 50,
        requiredLockIFR: 100,
        active: false,
      },
    });

    const otherBusiness = await prisma.business.create({
      data: {
        name: 'Other Business',
        discountPercent: 5,
        requiredLockIFR: 100,
        ttlSeconds: 60,
      },
    });
    const otherRule = await prisma.benefitRule.create({
      data: {
        businessId: otherBusiness.id,
        label: 'Other',
        category: 'Other',
        productName: 'Other benefit',
        discountPercent: 10,
        requiredLockIFR: 100,
      },
    });

    await expect(createSession(testBusinessId, inactiveRule.id)).rejects.toThrow(
      'Benefit rule not found or inactive'
    );
    await expect(createSession(testBusinessId, otherRule.id)).rejects.toThrow(
      'Benefit rule not found or inactive'
    );
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
    await redeem(session.sessionId, REDEEM_ACTOR);

    await expect(redeem(session.sessionId, REDEEM_ACTOR)).rejects.toThrow('already redeemed');
  });

  it('allows exactly one winner when approved redemption requests race', async () => {
    const session = await createSession(testBusinessId);

    mockRecoverSigner.mockReturnValue(TEST_WALLET);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });
    await attest(session.sessionId, '0xmocksignature');

    const results = await Promise.allSettled([
      redeem(session.sessionId, REDEEM_ACTOR),
      redeem(session.sessionId, REDEEM_ACTOR),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.auditLog.count({
      where: { sessionId: session.sessionId, type: 'REDEEMED' },
    })).toBe(1);
  });

  it('freezes redemption limits in the QR session snapshot', async () => {
    const rule = await prisma.benefitRule.create({
      data: {
        businessId: testBusinessId,
        label: 'Snapshot limits',
        category: 'Retail',
        productName: 'Snapshot benefit',
        discountPercent: 15,
        requiredLockIFR: 5000,
        dailyRedemptionLimit: 1,
        monthlyRedemptionLimit: 7,
      },
    });
    const session = await createSession(testBusinessId, rule.id);
    await prisma.benefitRule.update({
      where: { id: rule.id },
      data: { dailyRedemptionLimit: 3, monthlyRedemptionLimit: 30 },
    });

    expect(session).toMatchObject({ dailyRedemptionLimit: 1, monthlyRedemptionLimit: 7 });
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } })).toMatchObject({
      benefitSnapshotVersion: 2,
      benefitDailyRedemptionLimit: 1,
      benefitMonthlyRedemptionLimit: 7,
    });
  });

  it('enforces daily limits per wallet while allowing a different wallet', async () => {
    const rule = await prisma.benefitRule.create({
      data: {
        businessId: testBusinessId,
        label: 'Daily cap',
        category: 'Retail',
        productName: 'Daily capped benefit',
        discountPercent: 15,
        requiredLockIFR: 5000,
        dailyRedemptionLimit: 1,
      },
    });
    const createApproved = (wallet: string) => prisma.session.create({
      data: {
        businessId: testBusinessId,
        benefitRuleId: rule.id,
        benefitSnapshotVersion: 2,
        benefitDailyRedemptionLimit: 1,
        benefitMonthlyRedemptionLimit: 0,
        nonce: ethers.hexlify(ethers.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 60_000),
        status: 'APPROVED',
        recoveredAddress: wallet,
      },
    });
    const first = await createApproved(TEST_WALLET);
    const second = await createApproved(TEST_WALLET.toLowerCase());
    const other = await createApproved(ethers.Wallet.createRandom().address);

    await expect(redeem(first.id, REDEEM_ACTOR)).resolves.toEqual({ status: 'REDEEMED' });
    await expect(redeem(second.id, REDEEM_ACTOR)).rejects.toThrow('Daily redemption limit reached');
    await expect(redeem(other.id, REDEEM_ACTOR)).resolves.toEqual({ status: 'REDEEMED' });
    expect(await prisma.session.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      status: 'REJECTED',
      reason: expect.stringContaining('Daily redemption limit reached'),
    });
  });

  it('enforces monthly limits and keeps legacy null snapshots unlimited', async () => {
    const rule = await prisma.benefitRule.create({
      data: {
        businessId: testBusinessId,
        label: 'Monthly cap',
        category: 'Retail',
        productName: 'Monthly capped benefit',
        discountPercent: 15,
        requiredLockIFR: 5000,
        monthlyRedemptionLimit: 1,
      },
    });
    const createApproved = (snapshot: boolean) => prisma.session.create({
      data: {
        businessId: testBusinessId,
        benefitRuleId: rule.id,
        benefitSnapshotVersion: snapshot ? 2 : null,
        benefitDailyRedemptionLimit: snapshot ? 0 : null,
        benefitMonthlyRedemptionLimit: snapshot ? 1 : null,
        nonce: ethers.hexlify(ethers.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 60_000),
        status: 'APPROVED',
        recoveredAddress: TEST_WALLET,
      },
    });
    const first = await createApproved(true);
    const second = await createApproved(true);
    await redeem(first.id, REDEEM_ACTOR);
    await expect(redeem(second.id, REDEEM_ACTOR)).rejects.toThrow('Monthly redemption limit reached');

    const legacyA = await createApproved(false);
    const legacyB = await createApproved(false);
    await expect(redeem(legacyA.id, REDEEM_ACTOR)).resolves.toEqual({ status: 'REDEEMED' });
    await expect(redeem(legacyB.id, REDEEM_ACTOR)).resolves.toEqual({ status: 'REDEEMED' });
  });

  it('never exceeds a daily cap when two approved sessions redeem concurrently', async () => {
    const rule = await prisma.benefitRule.create({
      data: {
        businessId: testBusinessId,
        label: 'Race cap',
        category: 'Retail',
        productName: 'Race capped benefit',
        discountPercent: 15,
        requiredLockIFR: 5000,
        dailyRedemptionLimit: 1,
      },
    });
    const sessions = await Promise.all([0, 1].map(() => prisma.session.create({
      data: {
        businessId: testBusinessId,
        benefitRuleId: rule.id,
        benefitSnapshotVersion: 2,
        benefitDailyRedemptionLimit: 1,
        benefitMonthlyRedemptionLimit: 0,
        nonce: ethers.hexlify(ethers.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 60_000),
        status: 'APPROVED',
        recoveredAddress: TEST_WALLET,
      },
    })));

    const results = await Promise.allSettled(sessions.map((session) => redeem(session.id, REDEEM_ACTOR)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.session.count({
      where: { id: { in: sessions.map((session) => session.id) }, status: 'REDEEMED' },
    })).toBe(1);
    expect(await prisma.session.count({
      where: { id: { in: sessions.map((session) => session.id) }, status: 'REJECTED' },
    })).toBe(1);
  });

  it('rechecks a checkout operator inside the redemption transaction', async () => {
    const operatorWallet = ethers.Wallet.createRandom().address;
    const business = await prisma.business.create({
      data: {
        name: 'Revocation race seller',
        ownerAddress: ethers.Wallet.createRandom().address,
        discountPercent: 10,
        requiredLockIFR: 1000,
      },
    });
    const operator = await prisma.checkoutOperator.create({
      data: { businessId: business.id, walletAddress: operatorWallet, label: 'Counter' },
    });
    const session = await prisma.session.create({
      data: {
        businessId: business.id,
        nonce: ethers.hexlify(ethers.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 60_000),
        status: 'APPROVED',
      },
    });

    await prisma.checkoutOperator.update({ where: { id: operator.id }, data: { active: false } });
    await expect(redeem(session.id, {
      walletAddress: operatorWallet,
      role: 'OPERATOR',
      operatorId: operator.id,
    })).rejects.toThrow('no longer authorized for checkout');
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('APPROVED');
  }, 15_000);

  it('handles invalid signature gracefully', async () => {
    const session = await createSession(testBusinessId);

    mockRecoverSigner.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const result = await attest(session.sessionId, '0xinvalid');
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('Invalid signature. You can retry this QR session.');
    expect(result.attemptsRemaining).toBe(2);

    const saved = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(saved.status).toBe('PENDING');
  });
});

// ── Signature Verification (EIP-191) ─────────────────────────────

describe('EIP-191 Signature Verification', () => {
  it('verifies ethers.js personal sign round-trip', async () => {
    const wallet = ethers.Wallet.createRandom();
    const message = 'IFR Benefits: verify-nonce-abc123';
    const signature = await wallet.signMessage(message);
    const recovered = ethers.verifyMessage(message, signature);
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
