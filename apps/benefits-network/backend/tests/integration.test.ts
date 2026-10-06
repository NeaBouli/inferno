import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';

// ── Mock ifrLockService ────────────────────────────────────────────

const mockCheckLock = jest.fn();
const mockRecoverSigner = jest.fn();

jest.mock('../src/services/ifrLockService', () => ({
  checkLock: (...args: unknown[]) => mockCheckLock(...args),
  checkBenefitEligibility: async (...args: unknown[]) => {
    const result = await mockCheckLock(...args);
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
    MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: 5,
    MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET: 25,
    PORT: 3001,
  },
}));

import {
  createSession,
  buildChallengeMessage,
  attest,
  CustomerLimitNotHostedError,
  prisma,
} from '../src/services/sessionService';
import { assertSellerBusinessCreationLimit, assertSellerBusinessLimit } from '../src/services/sellerLimits';
import {
  buildSellerBusinessTotalLimitError,
  getSellerBusinessLimitConfigIssue,
} from '../src/services/sellerLimitPolicy';

// ── Test Setup ──────────────────────────────────────────────────────

type Wallet = ReturnType<typeof ethers.Wallet.createRandom>;

const customer = ethers.Wallet.createRandom();
const TEST_OWNER = ethers.Wallet.createRandom().address;
let testBusinessId: string;

// Service-level sessions are opened without seller authentication; record the owner as the
// confirming seller the way the authenticated sessions:create route does.
async function confirmByOwner(sessionId: string, ownerAddress = TEST_OWNER) {
  await prisma.session.update({
    where: { id: sessionId },
    data: { confirmedByWallet: ownerAddress, confirmedByRole: 'OWNER' },
  });
}

async function prove(sessionId: string, wallet: Wallet = customer) {
  const message = await buildChallengeMessage(sessionId, wallet.address);
  return attest(sessionId, wallet.address, await wallet.signMessage(message));
}

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
  mockRecoverSigner.mockReset();
  mockRecoverSigner.mockImplementation((message: string, signature: string) =>
    ethers.verifyMessage(message, signature));
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

  it('builds a distinct total-cap error and validates the cap config relationship', () => {
    expect(buildSellerBusinessTotalLimitError(24, 25)).toBeNull();
    expect(buildSellerBusinessTotalLimitError(25, 25)?.message).toBe(
      'Seller profile limit reached: 25/25 total profiles (including deactivated)'
    );
    expect(getSellerBusinessLimitConfigIssue(5, 25)).toBeNull();
    expect(getSellerBusinessLimitConfigIssue(5, 5)).toBeNull();
    expect(getSellerBusinessLimitConfigIssue(26, 25)).toContain(
      'must be greater than or equal to MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET'
    );
  });

  it('caps persisted seller profiles per owner wallet including deactivated profiles', async () => {
    const ownerAddress = '0x8Ba1f109551bD432803012645Ac136ddd64DBA72';

    await prisma.business.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        name: `Lifetime Seller Profile ${index + 1}`,
        ownerAddress,
        discountPercent: 10,
        requiredLockIFR: 1000,
        active: false,
      })),
    });

    await prisma.$transaction(async (tx) => {
      await expect(assertSellerBusinessCreationLimit(ownerAddress, tx)).rejects.toThrow(
        'Seller profile limit reached: 25/25 total profiles (including deactivated)'
      );
    });

    // The active-only reactivation check ignores the lifetime backlog.
    await expect(assertSellerBusinessLimit(ownerAddress)).resolves.toBeUndefined();
  });

  it('reports the active cap before the total cap when both are near', async () => {
    const ownerAddress = '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF';

    await prisma.business.createMany({
      data: [
        ...Array.from({ length: 5 }, (_, index) => ({
          name: `Active Cap Seller ${index + 1}`,
          ownerAddress,
          discountPercent: 10,
          requiredLockIFR: 1000,
          active: true,
        })),
        ...Array.from({ length: 19 }, (_, index) => ({
          name: `Paused Cap Seller ${index + 1}`,
          ownerAddress,
          discountPercent: 10,
          requiredLockIFR: 1000,
          active: false,
        })),
      ],
    });

    await prisma.$transaction(async (tx) => {
      await expect(assertSellerBusinessCreationLimit(ownerAddress, tx)).rejects.toThrow(
        'profile limit reached: 5/5 active profiles'
      );
    });
  });

  it('keeps legacy over-total owners on the active-only check and blocks creation', async () => {
    const ownerAddress = '0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69';

    await prisma.business.createMany({
      data: [
        {
          name: 'Legacy Active Seller',
          ownerAddress,
          discountPercent: 10,
          requiredLockIFR: 1000,
          active: true,
        },
        ...Array.from({ length: 25 }, (_, index) => ({
          name: `Legacy Paused Seller ${index + 1}`,
          ownerAddress,
          discountPercent: 10,
          requiredLockIFR: 1000,
          active: false,
        })),
      ],
    });

    await expect(assertSellerBusinessLimit(ownerAddress)).resolves.toBeUndefined();
    await prisma.$transaction(async (tx) => {
      await expect(assertSellerBusinessCreationLimit(ownerAddress, tx)).rejects.toThrow(
        'Seller profile limit reached: 26/25 total profiles (including deactivated)'
      );
    });
  });

  it('complete flow: seller-confirmed checkout → challenge → customer proof redeems in one step', async () => {
    // Step 1: Business creates a session (QR code generation), confirmed by the owner
    const session = await createSession(testBusinessId);
    expect(session.sessionId).toBeDefined();
    expect(session.discountPercent).toBe(15);
    expect(session.requiredLockIFR).toBe(5000);
    expect(session.tierLabel).toBe('Silver');
    await confirmByOwner(session.sessionId);

    // Step 2: Customer gets the proof text bound to the claimed wallet (nonce is internal)
    const challenge = await buildChallengeMessage(session.sessionId, customer.address);
    expect(challenge).toContain('IFR Benefits Network');
    expect(challenge).toContain('Audience: shop.example.test');
    expect(challenge).toContain(`Wallet: ${customer.address}`);
    expect(challenge).toContain(session.sessionId);

    // Step 3: Customer signs the proof → on-chain lock check → final redemption
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '10000.0' });

    const attestResult = await attest(
      session.sessionId,
      customer.address,
      await customer.signMessage(challenge)
    );
    expect(attestResult.status).toBe('REDEEMED');
    expect(attestResult.wallet).toBe(customer.address);
    expect(attestResult.eligible).toBe(true);

    const saved = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(saved).toMatchObject({
      status: 'REDEEMED',
      attestAttempts: 1,
      proofVersion: 2,
      selfRedemption: false,
    });
    expect(saved.redeemedAt).toBeInstanceOf(Date);
    const redeemedAudit = await prisma.auditLog.findFirstOrThrow({
      where: { sessionId: session.sessionId, type: 'REDEEMED' },
    });
    expect(JSON.parse(redeemedAudit.payload ?? '{}')).toMatchObject({
      actorWallet: TEST_OWNER,
      actorRole: 'OWNER',
    });
  });

  it('refuses a proof for a checkout without seller confirmation', async () => {
    const session = await createSession(testBusinessId);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '10000.0' });

    await expect(prove(session.sessionId)).rejects.toThrow(
      'no seller checkout confirmation, cannot attest'
    );
    expect(mockCheckLock).not.toHaveBeenCalled();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } })).status)
      .toBe('PENDING');
  });

  it('rejects user with insufficient lock amount', async () => {
    const session = await createSession(testBusinessId);
    await confirmByOwner(session.sessionId);

    // User has 2000 IFR locked, business requires 5000
    mockCheckLock.mockResolvedValue({ eligible: false, lockedAmount: '2000.0' });

    const result = await prove(session.sessionId);
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toContain('Insufficient lock');
    expect(result.reason).toContain('2000.0');
    expect(result.reason).toContain('retry this QR session');
    expect(result.attemptsRemaining).toBe(3);

    // CWA-37: an ineligible wallet leaves the session untouched.
    const saved = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(saved).toMatchObject({
      status: 'PENDING',
      attestAttempts: 0,
      redeemedAt: null,
      selfRedemption: null,
      proofVersion: null,
      reason: null,
    });
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
    await confirmByOwner(session.sessionId);

    const challenge = await buildChallengeMessage(session.sessionId, customer.address);
    expect(challenge).toContain(`Benefit Rule: ${rule.id}`);
    expect(challenge).toContain('Benefit: Cafe Partner');
    expect(challenge).toContain('Product: Flat white discount');
    expect(challenge).toContain('Required Lock IFR: 7500');
    expect(challenge).toContain('Discount Percent: 25');

    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '8000.0' });

    const attestResult = await attest(
      session.sessionId,
      customer.address,
      await customer.signMessage(challenge)
    );
    expect(attestResult.status).toBe('REDEEMED');
    expect(attestResult.benefit?.benefitRuleId).toBe(rule.id);
    expect(mockCheckLock).toHaveBeenCalledWith(customer.address, 7500, 0, 'ifrlock');
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

  it('prevents replay of a redeemed checkout', async () => {
    const session = await createSession(testBusinessId);
    await confirmByOwner(session.sessionId);

    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });

    const challenge = await buildChallengeMessage(session.sessionId, customer.address);
    const signature = await customer.signMessage(challenge);
    await expect(attest(session.sessionId, customer.address, signature))
      .resolves.toMatchObject({ status: 'REDEEMED' });

    // Replay attempt with the identical proof
    await expect(attest(session.sessionId, customer.address, signature))
      .rejects.toThrow('Session is REDEEMED, cannot attest');
  });

  it('prevents double redemption by a second eligible wallet', async () => {
    const session = await createSession(testBusinessId);
    await confirmByOwner(session.sessionId);

    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });

    await prove(session.sessionId);
    await expect(prove(session.sessionId, ethers.Wallet.createRandom()))
      .rejects.toThrow('Session is REDEEMED, cannot attest');
    expect(await prisma.auditLog.count({
      where: { sessionId: session.sessionId, type: 'REDEEMED' },
    })).toBe(1);
  });

  it('allows exactly one winner when customer proofs race', async () => {
    const session = await createSession(testBusinessId);
    await confirmByOwner(session.sessionId);

    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });
    const challenge = await buildChallengeMessage(session.sessionId, customer.address);
    const signature = await customer.signMessage(challenge);

    const results = await Promise.allSettled([
      attest(session.sessionId, customer.address, signature),
      attest(session.sessionId, customer.address, signature),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.auditLog.count({
      where: { sessionId: session.sessionId, type: 'REDEEMED' },
    })).toBe(1);
  });

  it('snapshots limit-free rules and refuses checkouts for legacy rules with per-customer limits', async () => {
    const rule = await prisma.benefitRule.create({
      data: {
        businessId: testBusinessId,
        label: 'Snapshot terms',
        category: 'Retail',
        productName: 'Snapshot benefit',
        discountPercent: 15,
        requiredLockIFR: 5000,
      },
    });
    const session = await createSession(testBusinessId, rule.id);
    await prisma.benefitRule.update({
      where: { id: rule.id },
      data: { discountPercent: 40 },
    });

    expect(session).toMatchObject({ dailyRedemptionLimit: 0, monthlyRedemptionLimit: 0 });
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } })).toMatchObject({
      benefitSnapshotVersion: 5,
      benefitDiscountPercent: 15,
      benefitDailyRedemptionLimit: 0,
      benefitMonthlyRedemptionLimit: 0,
    });

    // Per-customer limits are not IFR-hosted any more (owner decision B): a legacy rule that still
    // carries a daily or monthly limit fails closed instead of silently dropping the limit.
    for (const limits of [
      { dailyRedemptionLimit: 1, monthlyRedemptionLimit: 0 },
      { dailyRedemptionLimit: 0, monthlyRedemptionLimit: 7 },
    ]) {
      const limitedRule = await prisma.benefitRule.create({
        data: {
          businessId: testBusinessId,
          label: 'Legacy limited',
          category: 'Retail',
          productName: 'Legacy limited benefit',
          discountPercent: 15,
          requiredLockIFR: 5000,
          ...limits,
        },
      });
      await expect(createSession(testBusinessId, limitedRule.id)).rejects.toBeInstanceOf(
        CustomerLimitNotHostedError
      );
      expect(await prisma.session.count({ where: { benefitRuleId: limitedRule.id } })).toBe(0);
    }
  });

  // Removed: per-wallet daily/monthly limit enforcement and the concurrent daily-cap race. Limit
  // counting no longer exists; limited rules are refused at checkout open (test above) and the
  // single-use race is covered by 'allows exactly one winner when customer proofs race'.

  it('keeps legacy null benefit snapshots redeemable from the live rule', async () => {
    const rule = await prisma.benefitRule.create({
      data: {
        businessId: testBusinessId,
        label: 'Legacy snapshot',
        category: 'Retail',
        productName: 'Legacy benefit',
        discountPercent: 15,
        requiredLockIFR: 5000,
      },
    });
    const createLegacy = () => prisma.session.create({
      data: {
        businessId: testBusinessId,
        benefitRuleId: rule.id,
        benefitSnapshotVersion: null,
        nonce: ethers.hexlify(ethers.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 60_000),
        status: 'PENDING',
        confirmedByWallet: TEST_OWNER,
        confirmedByRole: 'OWNER',
      },
    });
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });

    const legacyA = await createLegacy();
    const legacyB = await createLegacy();
    await expect(prove(legacyA.id)).resolves.toMatchObject({ status: 'REDEEMED' });
    await expect(prove(legacyB.id)).resolves.toMatchObject({ status: 'REDEEMED' });
    expect(mockCheckLock).toHaveBeenCalledWith(customer.address, 5000, 0, 'ifrlock');
  });

  it('rechecks the confirming checkout operator inside the redemption transaction', async () => {
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
        status: 'PENDING',
        confirmedByWallet: operatorWallet,
        confirmedByRole: 'OPERATOR',
        confirmedByOperatorId: operator.id,
      },
    });
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });

    await prisma.checkoutOperator.update({ where: { id: operator.id }, data: { active: false } });
    await expect(prove(session.id)).rejects.toThrow('no longer authorized for checkout');
    const saved = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(saved.status).toBe('PENDING');
    expect(saved.attestAttempts).toBe(0);
  }, 15_000);

  it('handles invalid signature gracefully', async () => {
    const session = await createSession(testBusinessId);
    await confirmByOwner(session.sessionId);

    mockRecoverSigner.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const result = await attest(session.sessionId, customer.address, '0xinvalid');
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('Invalid signature. You can retry this QR session.');
    // An unrecoverable signature proves no wallet authority and burns no attempt.
    expect(result.attemptsRemaining).toBe(3);

    const saved = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(saved.status).toBe('PENDING');
    expect(saved.attestAttempts).toBe(0);
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
        ownerAddress: TEST_OWNER,
        discountPercent: 10,
        requiredLockIFR: 5000,
        ttlSeconds: 60,
      },
    });
    const session = await createSession(biz.id);
    await confirmByOwner(session.sessionId);

    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '5000.0' });

    await prove(session.sessionId);

    // Service should pass 5000 (human units), not 5000000000000 (base units)
    expect(mockCheckLock).toHaveBeenCalledWith(customer.address, 5000, 0, 'ifrlock');
  });
});
