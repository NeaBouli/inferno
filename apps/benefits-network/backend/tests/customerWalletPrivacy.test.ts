import { ethers } from 'ethers';

type TestWallet = ReturnType<typeof ethers.Wallet.createRandom>;

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

jest.setTimeout(30_000);

const TEST_KEY = 'test-customer-wallet-hmac-key-0123456789abcdef';

jest.mock('../src/config', () => ({
  config: {
    CHAIN_ID: 1,
    SELLER_AUTH_DOMAIN: 'shop.example.test',
    RPC_URL: 'https://mock-rpc.example.com',
    IFRLOCK_ADDRESS: '0x0000000000000000000000000000000000000001',
    ADMIN_SECRET: 'test-secret-12345',
    CUSTOMER_WALLET_HMAC_KEY: 'test-customer-wallet-hmac-key-0123456789abcdef',
    DATABASE_URL: 'file:./test.db',
    MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: 5,
    MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET: 25,
    PORT: 0,
  },
}));

import * as authenticatedRateLimiter from '../src/services/authenticatedRateLimiter';
import { config } from '../src/config';
import {
  computeWalletFingerprint,
  fingerprintWallet,
  getCustomerWalletKeyPolicyIssue,
  isWalletFingerprint,
} from '../src/services/walletFingerprint';
import {
  WALLET_MIGRATION_CONFIRMATION,
  migrateCustomerWallets,
} from '../src/services/walletFingerprintMigration';
import { parseWalletMigrationArgs } from '../src/walletFingerprintMigrationCli';
import { prisma } from '../src/services/sessionService';
import { server } from '../src/index';

const ADDRESS_PATTERN = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const partnerId = `0x${'ab'.repeat(32)}`;
const mutableConfig = config as { CUSTOMER_WALLET_HMAC_KEY?: string };

function baseUrl() {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function sellerHeaders(wallet: TestWallet, action: string, businessId: string, scope = businessId) {
  const query = new URLSearchParams({ action, businessId, walletAddress: wallet.address, scope });
  const response = await fetch(`${baseUrl()}/api/seller/auth-message?${query}`);
  expect(response.status).toBe(200);
  const challenge = await response.json() as { message: string; timestamp: string; nonce?: string };
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-ifr-wallet': wallet.address,
    'x-ifr-signature': await wallet.signMessage(challenge.message),
    'x-ifr-timestamp': challenge.timestamp,
  };
  if (challenge.nonce) headers['x-ifr-nonce'] = challenge.nonce;
  return headers;
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Every persisted row of every table, as one string. */
async function dumpDatabase(): Promise<string> {
  const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'"
  );
  const parts: string[] = [];
  for (const { name } of tables) {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${name}"`);
    parts.push(JSON.stringify(rows, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
  }
  return parts.join('\n');
}

async function cleanDatabase() {
  await prisma.rewardEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.customerPass.deleteMany();
  await prisma.customerPassChallenge.deleteMany();
  await prisma.customerHistoryChallenge.deleteMany();
  await prisma.customerHistoryAccess.deleteMany();
  await prisma.sellerAuthorizationChallenge.deleteMany();
  await prisma.adminAuditLog.deleteMany();
  await prisma.sellerRewardLink.deleteMany();
  await prisma.benefitRule.deleteMany();
  await prisma.product.deleteMany();
  await prisma.checkoutOperator.deleteMany();
  await prisma.business.deleteMany();
}

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe('customer wallet fingerprints (T-231a)', () => {
  it('is stable, case-insensitive, keyed and never contains the address', () => {
    const wallet = ethers.Wallet.createRandom().address;
    const fingerprint = computeWalletFingerprint(TEST_KEY, wallet);
    expect(fingerprint).toMatch(/^wfp1:[0-9a-f]{64}$/);
    expect(isWalletFingerprint(fingerprint)).toBe(true);
    expect(computeWalletFingerprint(TEST_KEY, wallet.toLowerCase())).toBe(fingerprint);
    expect(computeWalletFingerprint(TEST_KEY, `0x${wallet.slice(2).toUpperCase()}`)).toBe(fingerprint);
    expect(fingerprintWallet(wallet)).toBe(fingerprint);
    expect(fingerprint).not.toContain(wallet.slice(2).toLowerCase());
    expect(computeWalletFingerprint(`${TEST_KEY}-other`, wallet)).not.toBe(fingerprint);
    expect(computeWalletFingerprint(TEST_KEY, ethers.Wallet.createRandom().address)).not.toBe(fingerprint);
    // Pinned vector: a change of key derivation, domain or encoding breaks every stored fingerprint.
    expect(computeWalletFingerprint(TEST_KEY, '0x00000000000000000000000000000000000000aa'))
      .toBe(computeWalletFingerprint(TEST_KEY, '0x00000000000000000000000000000000000000AA'));
    expect(computeWalletFingerprint(TEST_KEY, '0x00000000000000000000000000000000000000aa')).toBe(
      `wfp1:${require('node:crypto').createHmac('sha256', TEST_KEY)
        .update('ifr-benefits/customer-wallet/v1:0x00000000000000000000000000000000000000aa').digest('hex')}`
    );
  });

  it('rejects malformed addresses and short keys', () => {
    expect(() => computeWalletFingerprint(TEST_KEY, 'not-an-address')).toThrow('Invalid wallet address');
    expect(() => computeWalletFingerprint('short', ethers.Wallet.createRandom().address))
      .toThrow('not configured');
    expect(getCustomerWalletKeyPolicyIssue(undefined, 'admin')).toBeNull();
    expect(getCustomerWalletKeyPolicyIssue('x'.repeat(31), 'admin')).toMatch(/at least 32/);
    expect(getCustomerWalletKeyPolicyIssue('replace-with-a-long-random-customer-wallet-hmac-key', 'admin'))
      .toMatch(/placeholder/);
    expect(getCustomerWalletKeyPolicyIssue('k'.repeat(40), 'k'.repeat(40))).toMatch(/differ from ADMIN_SECRET/);
    expect(getCustomerWalletKeyPolicyIssue('k'.repeat(40), 'admin')).toBeNull();
  });
});

describe('no raw customer wallet is persisted (T-231a)', () => {
  const seller = ethers.Wallet.createRandom();
  const operator = ethers.Wallet.createRandom();
  const customer = ethers.Wallet.createRandom();
  let businessId: string;
  let ruleId: string;
  let limiterSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    mutableConfig.CUSTOMER_WALLET_HMAC_KEY = TEST_KEY;
    limiterSpy = jest.spyOn(authenticatedRateLimiter, 'assertSellerWalletActionAllowed').mockResolvedValue(undefined);
    await cleanDatabase();
    businessId = (await prisma.business.create({
      data: { name: 'Privacy Shop', ownerAddress: seller.address, discountPercent: 10, requiredLockIFR: 1000 },
    })).id;
    ruleId = (await prisma.benefitRule.create({
      data: {
        businessId, label: 'Coffee', category: 'Coffee', productName: 'Espresso',
        discountPercent: 10, requiredLockIFR: 1000, ttlSeconds: 120, monthlyRedemptionLimit: 5,
      },
    })).id;
    await prisma.checkoutOperator.create({ data: { businessId, walletAddress: operator.address, label: 'Till' } });
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: seller.address, verifiedAt: new Date() },
    });
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '2500.0' });
  });

  afterEach(() => {
    limiterSpy.mockRestore();
    mutableConfig.CUSTOMER_WALLET_HMAC_KEY = TEST_KEY;
  });

  async function passCheckout(wallet: TestWallet) {
    const challengeResponse = await post('/api/passes/challenge', { walletAddress: wallet.address });
    expect(challengeResponse.status).toBe(200);
    const challenge = await challengeResponse.json() as { message: string; nonce: string };
    const created = await post('/api/passes', {
      walletAddress: wallet.address, nonce: challenge.nonce, signature: await wallet.signMessage(challenge.message),
    });
    expect(created.status).toBe(201);
    const pass = await created.json() as { passId: string; controlToken: string };
    const bound = await post(`/api/passes/${pass.passId}/bind`, { businessId, benefitRuleId: ruleId },
      await sellerHeaders(seller, 'passes:bind', businessId, `${pass.passId}:${ruleId}`));
    expect(bound.status).toBe(201);
    const { sessionId } = await bound.json() as { sessionId: string };
    mockRecoverSigner.mockReturnValue(wallet.address);
    const confirmed = await post(`/api/passes/${pass.passId}/confirm`, { signature: '0xdeadbeef' },
      { authorization: `Bearer ${pass.controlToken}` });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ status: 'APPROVED', wallet: wallet.address });
    return sessionId;
  }

  async function redeem(sessionId: string) {
    return fetch(`${baseUrl()}/api/sessions/${sessionId}/redeem`, {
      method: 'POST',
      headers: await sellerHeaders(seller, 'sessions:redeem', sessionId),
    });
  }

  it('keeps only fingerprints after a full pass, redeem, reward and history flow', async () => {
    const sessionId = await passCheckout(customer);
    expect((await redeem(sessionId)).status).toBe(200);

    // A second redemption by the same wallet: the limit counts it, one reward per wallet and partner.
    const second = await passCheckout(customer);
    expect((await redeem(second)).status).toBe(200);
    expect(await prisma.rewardEvent.count()).toBe(1);

    // Customer history still works on the fingerprint.
    const historyChallenge = await post('/api/customer/history/challenge', { walletAddress: customer.address });
    const issued = await historyChallenge.json() as { message: string; nonce: string };
    const authorized = await post('/api/customer/history/authorize', {
      walletAddress: customer.address, nonce: issued.nonce, signature: await customer.signMessage(issued.message),
    });
    expect(authorized.status).toBe(200);
    const { accessToken } = await authorized.json() as { accessToken: string };
    const history = await fetch(`${baseUrl()}/api/customer/history`, { headers: { authorization: `Bearer ${accessToken}` } });
    expect((await history.json() as { sessions: unknown[] }).sessions).toHaveLength(2);

    const fingerprint = fingerprintWallet(customer.address);
    expect(await prisma.session.count({ where: { customerFingerprint: fingerprint, status: 'REDEEMED' } })).toBe(2);
    expect(await prisma.rewardEvent.findFirstOrThrow()).toMatchObject({ customerFingerprint: fingerprint });

    const dump = await dumpDatabase();
    expect(dump.toLowerCase()).not.toContain(customer.address.slice(2).toLowerCase());
    // The only addresses left anywhere are the seller's business identities.
    const allowed = new Set([seller.address, operator.address].map((value) => value.toLowerCase()));
    for (const match of dump.match(ADDRESS_PATTERN) ?? []) {
      expect(allowed.has(match.toLowerCase())).toBe(true);
    }
    const audits = await prisma.auditLog.findMany();
    expect(audits.length).toBeGreaterThan(0);
    for (const audit of audits) {
      expect(audit.payload).not.toContain(fingerprint);
      expect(Object.keys(JSON.parse(audit.payload))).not.toContain('wallet');
    }
  }, 30_000);

  it('excludes the seller owner and an active operator from rewards by fingerprint', async () => {
    for (const wallet of [seller, operator]) {
      const sessionId = await passCheckout(wallet);
      expect((await redeem(sessionId)).status).toBe(200);
      expect(await prisma.auditLog.findFirst({ where: { sessionId, type: 'REWARD_SKIPPED_POLICY' } })).not.toBeNull();
    }
    expect(await prisma.rewardEvent.count()).toBe(0);
  }, 30_000);

  it('enforces the per-wallet redemption limit on fingerprints', async () => {
    await prisma.benefitRule.update({ where: { id: ruleId }, data: { monthlyRedemptionLimit: 1 } });
    const first = await passCheckout(customer);
    expect((await redeem(first)).status).toBe(200);
    const second = await passCheckout(customer);
    const denied = await redeem(second);
    expect(denied.status).toBe(429);
    const other = await passCheckout(ethers.Wallet.createRandom());
    expect((await redeem(other)).status).toBe(200);
  }, 30_000);

  it('never rebinds a session that already holds another (or a legacy raw) identity', async () => {
    for (const bound of [fingerprintWallet(ethers.Wallet.createRandom().address), ethers.Wallet.createRandom().address]) {
      const session = await prisma.session.create({
        data: {
          businessId, nonce: ethers.hexlify(ethers.randomBytes(32)).slice(2),
          expiresAt: new Date(Date.now() + 60_000), status: 'PENDING', customerFingerprint: bound,
        },
      });
      mockRecoverSigner.mockReturnValue(customer.address);
      const response = await post('/api/attest', { sessionId: session.id, signature: '0xdeadbeef' });
      expect(response.status).toBe(500);
      expect(await prisma.session.findUniqueOrThrow({ where: { id: session.id } }))
        .toMatchObject({ status: 'PENDING', customerFingerprint: bound, attestAttempts: 0 });
    }
  });

  it('fails closed without the server key and stores no customer identity', async () => {
    const sessionId = await passCheckout(customer);
    const counts = async () => ({
      passChallenges: await prisma.customerPassChallenge.count(),
      passes: await prisma.customerPass.count(),
      historyChallenges: await prisma.customerHistoryChallenge.count(),
      fingerprintedSessions: await prisma.session.count({ where: { customerFingerprint: { not: null } } }),
      rewardEvents: await prisma.rewardEvent.count(),
    });
    const before = await counts();
    mutableConfig.CUSTOMER_WALLET_HMAC_KEY = undefined;

    expect((await post('/api/passes/challenge', { walletAddress: customer.address })).status).toBe(503);
    expect((await post('/api/customer/history/challenge', { walletAddress: customer.address })).status).toBe(503);
    expect((await redeem(sessionId)).status).toBe(503);

    const qr = await prisma.session.create({
      data: { businessId, nonce: 'ab'.repeat(32), expiresAt: new Date(Date.now() + 60_000), status: 'PENDING' },
    });
    mockRecoverSigner.mockReturnValue(customer.address);
    expect((await post('/api/attest', { sessionId: qr.id, signature: '0xdeadbeef' })).status).toBe(503);
    expect(mockCheckLock).toHaveBeenCalledTimes(1); // only the earlier, keyed checkout
    expect(await prisma.session.findUniqueOrThrow({ where: { id: qr.id } }))
      .toMatchObject({ status: 'PENDING', customerFingerprint: null, attestAttempts: 0 });

    expect(await counts()).toEqual(before);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe('APPROVED');
  }, 30_000);
});

describe('customer wallet data migration (T-231a)', () => {
  const raw = ethers.Wallet.createRandom().address;
  const sellerAddress = ethers.Wallet.createRandom().address;
  let businessId: string;

  async function seedLegacyRows() {
    await cleanDatabase();
    businessId = (await prisma.business.create({
      data: { name: 'Legacy Shop', ownerAddress: sellerAddress, discountPercent: 10, requiredLockIFR: 1000 },
    })).id;
    const pass = await prisma.customerPass.create({
      data: { id: 'legacy-pass', walletFingerprint: raw, controlHash: 'legacy-control', status: 'BOUND', expiresAt: new Date() },
    });
    await prisma.session.create({
      data: {
        id: 'legacy-session', businessId, nonce: 'cd'.repeat(32), expiresAt: new Date(), status: 'REDEEMED',
        redeemedAt: new Date(), customerFingerprint: raw, lockAmountRaw: '1000', customerPassId: pass.id,
      },
    });
    await prisma.auditLog.createMany({
      data: [
        { sessionId: 'legacy-session', type: 'ATTEST_OK', payload: JSON.stringify({ wallet: raw, locked: '1000' }) },
        { sessionId: 'legacy-session', type: 'REDEEMED', payload: JSON.stringify({ actorWallet: sellerAddress, actorRole: 'OWNER' }) },
      ],
    });
    await prisma.rewardEvent.create({
      data: {
        businessId, sessionId: 'legacy-session', partnerId, customerFingerprint: raw,
        lockAmountRaw: '1000000000000', chainId: 1, status: 'SETTLEMENT_PENDING',
      },
    });
    const expiresAt = new Date(Date.now() + 60_000);
    await prisma.customerPassChallenge.create({ data: { nonce: 'legacy-pc', walletFingerprint: raw, issuedAt: new Date(), expiresAt } });
    await prisma.customerHistoryChallenge.create({ data: { nonce: 'legacy-hc', walletFingerprint: raw, issuedAt: new Date(), expiresAt } });
    await prisma.customerHistoryAccess.create({ data: { tokenHash: 'legacy-token', walletFingerprint: raw, expiresAt } });
  }

  beforeEach(seedLegacyRows);

  it('refuses to run without the key and without the exact confirmation', async () => {
    await expect(migrateCustomerWallets(prisma, { key: undefined, mode: 'report' })).rejects.toThrow(/refusing/);
    await expect(migrateCustomerWallets(prisma, { key: 'short', mode: 'apply', confirmation: WALLET_MIGRATION_CONFIRMATION }))
      .rejects.toThrow(/refusing/);
    await expect(migrateCustomerWallets(prisma, { key: TEST_KEY, mode: 'apply', confirmation: 'yes' }))
      .rejects.toThrow(WALLET_MIGRATION_CONFIRMATION);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: 'legacy-session' } })).customerFingerprint).toBe(raw);
  });

  it('reports, then hashes every fixture row in place and is idempotent', async () => {
    const report = await migrateCustomerWallets(prisma, { key: TEST_KEY, mode: 'report' });
    expect(report).toEqual({
      mode: 'report',
      rawRows: {
        sessions: 1, customerPasses: 1, customerPassChallenges: 1, customerHistoryChallenges: 1,
        customerHistoryAccess: 1, rewardEvents: 1, auditLogPayloads: 1,
      },
      rewardEventConflicts: 0,
    });
    expect(JSON.stringify(report)).not.toMatch(ADDRESS_PATTERN);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: 'legacy-session' } })).customerFingerprint).toBe(raw);

    const applied = await migrateCustomerWallets(prisma, {
      key: TEST_KEY, mode: 'apply', confirmation: WALLET_MIGRATION_CONFIRMATION,
    });
    expect(applied.remainingRawRows).toEqual({
      sessions: 0, customerPasses: 0, customerPassChallenges: 0, customerHistoryChallenges: 0,
      customerHistoryAccess: 0, rewardEvents: 0, auditLogPayloads: 0,
    });
    const fingerprint = computeWalletFingerprint(TEST_KEY, raw);
    expect(fingerprint).toBe(fingerprintWallet(raw));
    expect((await prisma.session.findUniqueOrThrow({ where: { id: 'legacy-session' } })).customerFingerprint).toBe(fingerprint);
    expect((await prisma.customerPass.findUniqueOrThrow({ where: { id: 'legacy-pass' } })).walletFingerprint).toBe(fingerprint);
    expect((await prisma.rewardEvent.findFirstOrThrow()).customerFingerprint).toBe(fingerprint);
    expect((await prisma.customerPassChallenge.findUniqueOrThrow({ where: { nonce: 'legacy-pc' } })).walletFingerprint).toBe(fingerprint);
    expect((await prisma.customerHistoryChallenge.findUniqueOrThrow({ where: { nonce: 'legacy-hc' } })).walletFingerprint).toBe(fingerprint);
    expect((await prisma.customerHistoryAccess.findUniqueOrThrow({ where: { tokenHash: 'legacy-token' } })).walletFingerprint).toBe(fingerprint);
    const attestAudit = await prisma.auditLog.findFirstOrThrow({ where: { type: 'ATTEST_OK' } });
    expect(JSON.parse(attestAudit.payload)).toEqual({ locked: '1000' });
    // Seller business identities are untouched.
    const redeemedAudit = await prisma.auditLog.findFirstOrThrow({ where: { type: 'REDEEMED' } });
    expect(JSON.parse(redeemedAudit.payload)).toMatchObject({ actorWallet: sellerAddress });

    const dump = await dumpDatabase();
    expect(dump.toLowerCase()).not.toContain(raw.slice(2).toLowerCase());

    const again = await migrateCustomerWallets(prisma, {
      key: TEST_KEY, mode: 'apply', confirmation: WALLET_MIGRATION_CONFIRMATION,
    });
    expect(Object.values(again.rawRows).every((count) => count === 0)).toBe(true);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: 'legacy-session' } })).customerFingerprint).toBe(fingerprint);
  });

  it('refuses to merge reward events that would collide on fingerprint and partner', async () => {
    await prisma.session.create({
      data: { id: 'legacy-session-2', businessId, nonce: 'ef'.repeat(32), expiresAt: new Date(), status: 'REDEEMED' },
    });
    await prisma.rewardEvent.create({
      data: {
        businessId, sessionId: 'legacy-session-2', partnerId, customerFingerprint: raw.toLowerCase(),
        lockAmountRaw: '1000000000000', chainId: 1, status: 'SETTLEMENT_PENDING',
      },
    });
    const report = await migrateCustomerWallets(prisma, { key: TEST_KEY, mode: 'report' });
    expect(report.rewardEventConflicts).toBe(1);
    await expect(migrateCustomerWallets(prisma, {
      key: TEST_KEY, mode: 'apply', confirmation: WALLET_MIGRATION_CONFIRMATION,
    })).rejects.toThrow(/collide/);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: 'legacy-session' } })).customerFingerprint).toBe(raw);
  });

  it('parses only report and confirmed apply CLI modes', () => {
    const argv = (...args: string[]) => ['node', 'cli.js', ...args];
    expect(parseWalletMigrationArgs(argv('report'))).toEqual({ mode: 'report', confirmation: undefined });
    expect(parseWalletMigrationArgs(argv('apply', `--confirm=${WALLET_MIGRATION_CONFIRMATION}`)))
      .toEqual({ mode: 'apply', confirmation: WALLET_MIGRATION_CONFIRMATION });
    expect(() => parseWalletMigrationArgs(argv('apply'))).toThrow(/--confirm/);
    expect(() => parseWalletMigrationArgs(argv('report', '--confirm=x'))).toThrow(/Unknown/);
    expect(() => parseWalletMigrationArgs(argv('delete'))).toThrow(/Mode/);
  });
});
