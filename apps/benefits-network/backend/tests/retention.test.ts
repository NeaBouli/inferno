jest.mock('../src/services/ifrLockService', () => ({
  checkLock: jest.fn(),
  checkBenefitEligibility: jest.fn(),
  recoverSigner: jest.fn(),
  initProvider: jest.fn(),
}));

const TEST_ADMIN_SECRET = 'test-admin-secret-0123456789abcdef0123456789';

jest.mock('../src/config', () => ({
  config: {
    CHAIN_ID: 11155111,
    RPC_URL: 'https://mock-rpc.example.com',
    IFR_TOKEN_ADDRESS: '0x0000000000000000000000000000000000000002',
    IFRLOCK_ADDRESS: '0x0000000000000000000000000000000000000001',
    COMMITMENT_VAULT_ADDRESS: '0x0000000000000000000000000000000000000003',
    ADMIN_SECRET: 'test-admin-secret-0123456789abcdef0123456789',
    DATABASE_URL: 'file:./test.db',
    RATE_LIMIT_STORE: 'memory',
    MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: 5,
    MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET: 25,
    PORT: 0,
  },
}));

import { prisma } from '../src/services/sessionService';
import { server } from '../src/index';
import {
  RETENTION_APPLY_CONFIRMATION,
  applyRetention,
  getRetentionReport,
} from '../src/services/retention';
import { parseRetentionCliArgs } from '../src/retentionCli';

const NOW = new Date('2026-07-27T00:00:00.000Z');
const CUTOFF = new Date('2026-06-27T00:00:00.000Z');
const OLD = new Date('2026-06-01T00:00:00.000Z');
const RECENT = new Date('2026-07-01T00:00:00.000Z');
const WALLET = '0x00000000000000000000000000000000000000AA';

function baseUrl() {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function cleanDatabase() {
  await prisma.adminAuditLog.deleteMany();
  await prisma.customerHistoryAccess.deleteMany();
  await prisma.customerHistoryChallenge.deleteMany();
  await prisma.sellerAuthorizationChallenge.deleteMany();
  await prisma.customerPassChallenge.deleteMany();
  await prisma.rewardEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.customerPass.deleteMany();
  await prisma.sellerRewardLink.deleteMany();
  await prisma.benefitRule.deleteMany();
  await prisma.product.deleteMany();
  await prisma.checkoutOperator.deleteMany();
  await prisma.business.deleteMany();
}

async function seedRetentionRows() {
  await prisma.adminAuditLog.createMany({
    data: [
      {
        id: 'admin-old',
        action: 'business:create',
        method: 'POST',
        routeTemplate: '/api/admin/businesses',
        actorDigest: 'a'.repeat(64),
        clientDigest: 'b'.repeat(64),
        statusCode: 201,
        createdAt: OLD,
      },
      {
        id: 'admin-recent',
        action: 'business:update',
        method: 'PATCH',
        routeTemplate: '/api/admin/businesses/:id',
        actorDigest: 'c'.repeat(64),
        clientDigest: 'd'.repeat(64),
        statusCode: 200,
        createdAt: RECENT,
      },
    ],
  });
  await prisma.customerPassChallenge.createMany({
    data: [
      { nonce: 'pass-old', walletAddress: WALLET, issuedAt: OLD, expiresAt: OLD, createdAt: OLD },
      { nonce: 'pass-recent', walletAddress: WALLET, issuedAt: RECENT, expiresAt: RECENT, createdAt: RECENT },
    ],
  });
  await prisma.sellerAuthorizationChallenge.createMany({
    data: [
      {
        nonce: 'seller-old',
        walletAddress: WALLET,
        action: 'business:update',
        businessId: 'business-old',
        scope: 'business-old',
        expiresAt: OLD,
        createdAt: OLD,
      },
      {
        nonce: 'seller-recent',
        walletAddress: WALLET,
        action: 'business:update',
        businessId: 'business-recent',
        scope: 'business-recent',
        expiresAt: RECENT,
        createdAt: RECENT,
      },
    ],
  });
  await prisma.customerHistoryChallenge.createMany({
    data: [
      { nonce: 'history-old', walletAddress: WALLET, issuedAt: OLD, expiresAt: OLD, createdAt: OLD },
      { nonce: 'history-recent', walletAddress: WALLET, issuedAt: RECENT, expiresAt: RECENT, createdAt: RECENT },
    ],
  });
  await prisma.customerHistoryAccess.createMany({
    data: [
      { tokenHash: 'token-old', walletAddress: WALLET, expiresAt: OLD, createdAt: OLD },
      { tokenHash: 'token-recent', walletAddress: WALLET, expiresAt: RECENT, createdAt: RECENT },
    ],
  });
  await prisma.customerPass.createMany({
    data: [
      {
        id: 'orphan-open-old',
        walletAddress: WALLET,
        controlHash: 'control-open-old',
        status: 'OPEN',
        expiresAt: OLD,
        createdAt: OLD,
        updatedAt: OLD,
      },
      {
        id: 'orphan-cancelled-old',
        walletAddress: WALLET,
        controlHash: 'control-cancelled-old',
        status: 'CANCELLED',
        expiresAt: OLD,
        cancelledAt: OLD,
        createdAt: OLD,
        updatedAt: OLD,
      },
      {
        id: 'orphan-recent',
        walletAddress: WALLET,
        controlHash: 'control-recent',
        status: 'OPEN',
        expiresAt: RECENT,
        createdAt: RECENT,
        updatedAt: RECENT,
      },
    ],
  });

  const linkedPass = await prisma.customerPass.create({
    data: {
      id: 'linked-old',
      walletAddress: WALLET,
      controlHash: 'control-linked-old',
      status: 'EXPIRED',
      expiresAt: OLD,
      createdAt: OLD,
      updatedAt: OLD,
    },
  });
  const business = await prisma.business.create({
    data: {
      id: 'retention-business',
      name: 'Retention Test Shop',
      discountPercent: 10,
      requiredLockIFR: 1000,
    },
  });
  const session = await prisma.session.create({
    data: {
      id: 'protected-session',
      businessId: business.id,
      customerPassId: linkedPass.id,
      nonce: 'protected-session-nonce',
      expiresAt: OLD,
      status: 'EXPIRED',
      createdAt: OLD,
      updatedAt: OLD,
    },
  });
  await prisma.auditLog.create({
    data: {
      id: 'protected-audit',
      sessionId: session.id,
      type: 'EXPIRED',
      payload: JSON.stringify({ wallet: WALLET }),
      ts: OLD,
    },
  });
  await prisma.sellerRewardLink.create({
    data: {
      id: 'protected-reward-link',
      businessId: business.id,
      status: 'VERIFIED',
      partnerId: `0x${'12'.repeat(32)}`,
      builderWallet: WALLET,
      createdAt: OLD,
      updatedAt: OLD,
    },
  });
  await prisma.rewardEvent.create({
    data: {
      id: 'protected-reward-event',
      businessId: business.id,
      sessionId: session.id,
      partnerId: `0x${'12'.repeat(32)}`,
      customerWallet: WALLET,
      lockAmountRaw: '1000000000000',
      chainId: 1,
      status: 'PENDING',
      createdAt: OLD,
      updatedAt: OLD,
    },
  });
}

describe('Benefits retention operations', () => {
  beforeEach(async () => {
    await cleanDatabase();
    await seedRetentionRows();
  });

  afterAll(async () => {
    await cleanDatabase();
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it('reports only eligible phase-one rows and never mutates during preview', async () => {
    const report = await getRetentionReport(prisma, CUTOFF, NOW);

    expect(report).toMatchObject({
      cutoff: CUTOFF.toISOString(),
      generatedAt: NOW.toISOString(),
      eligible: {
        adminAuditLogs: 1,
        customerPassChallenges: 1,
        sellerAuthorizationChallenges: 1,
        customerHistoryChallenges: 1,
        customerHistoryAccess: 1,
        orphanCustomerPasses: 2,
      },
      protected: {
        sessions: 1,
        auditLogs: 1,
        rewardEvents: 1,
        linkedCustomerPasses: 1,
      },
    });
    expect(await prisma.adminAuditLog.count()).toBe(2);
    expect(await prisma.customerPass.count()).toBe(4);
  });

  it('requires the exact confirmation before applying retention', async () => {
    await expect(applyRetention(prisma, {
      cutoff: CUTOFF,
      now: NOW,
      confirmation: 'wrong',
    })).rejects.toThrow(RETENTION_APPLY_CONFIRMATION);
    expect(await prisma.adminAuditLog.count()).toBe(2);
  });

  it('rejects invalid service cutoffs and batch limits', async () => {
    await expect(getRetentionReport(prisma, NOW, NOW)).rejects.toThrow(/before/);
    await expect(getRetentionReport(prisma, CUTOFF, NOW, 0)).rejects.toThrow(/batch limit/);
    await expect(getRetentionReport(prisma, CUTOFF, NOW, 10_001)).rejects.toThrow(/batch limit/);
  });

  it('limits each apply batch and leaves remaining candidates visible', async () => {
    const result = await applyRetention(prisma, {
      cutoff: CUTOFF,
      now: NOW,
      batchLimit: 1,
      confirmation: RETENTION_APPLY_CONFIRMATION,
    });

    expect(result.deleted.orphanCustomerPasses).toBe(1);
    const report = await getRetentionReport(prisma, CUTOFF, NOW, 1);
    expect(report.eligible.orphanCustomerPasses).toBe(1);
    expect(await prisma.customerPass.count({ where: { session: { isNot: null } } })).toBe(1);
  });

  it('deletes only eligible rows and appends a non-sensitive operator audit', async () => {
    const result = await applyRetention(prisma, {
      cutoff: CUTOFF,
      now: NOW,
      confirmation: RETENTION_APPLY_CONFIRMATION,
    });

    expect(result.deleted).toEqual({
      adminAuditLogs: 1,
      customerPassChallenges: 1,
      sellerAuthorizationChallenges: 1,
      customerHistoryChallenges: 1,
      customerHistoryAccess: 1,
      orphanCustomerPasses: 2,
    });
    expect(await prisma.session.count()).toBe(1);
    expect(await prisma.auditLog.count()).toBe(1);
    expect(await prisma.rewardEvent.count()).toBe(1);
    expect(await prisma.customerPass.findUnique({ where: { id: 'linked-old' } })).not.toBeNull();
    expect(await prisma.customerPass.findUnique({ where: { id: 'orphan-recent' } })).not.toBeNull();
    expect(await prisma.adminAuditLog.findFirstOrThrow({
      where: { action: 'retention:prune' },
    })).toMatchObject({
      method: 'CLI',
      routeTemplate: 'cli:retention',
      targetType: 'RetentionCutoff',
      targetId: CUTOFF.toISOString(),
      statusCode: 200,
    });

    const second = await applyRetention(prisma, {
      cutoff: CUTOFF,
      now: new Date('2026-07-27T00:01:00.000Z'),
      confirmation: RETENTION_APPLY_CONFIRMATION,
    });
    expect(second.deleted).toEqual({
      adminAuditLogs: 0,
      customerPassChallenges: 0,
      sellerAuthorizationChallenges: 0,
      customerHistoryChallenges: 0,
      customerHistoryAccess: 0,
      orphanCustomerPasses: 0,
    });
    expect(await prisma.adminAuditLog.count({
      where: { action: 'retention:prune' },
    })).toBe(2);
  });

  it('exposes an authenticated read-only report without writing an audit row', async () => {
    const unauthorized = await fetch(
      `${baseUrl()}/api/admin/retention/report?olderThanDays=30`,
    );
    expect(unauthorized.status).toBe(401);

    const before = await prisma.adminAuditLog.count();
    const response = await fetch(
      `${baseUrl()}/api/admin/retention/report?olderThanDays=30`,
      { headers: { authorization: `Bearer ${TEST_ADMIN_SECRET}` } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      policy: 'phase-one-expired-auth-artifacts',
      eligible: expect.any(Object),
      protected: expect.any(Object),
    });
    expect(await prisma.adminAuditLog.count()).toBe(before);
  });

  it('rejects missing, zero, excessive, and repeated report query values', async () => {
    for (const query of [
      '',
      '?olderThanDays=0',
      '?olderThanDays=3651',
      '?olderThanDays=30&olderThanDays=60',
    ]) {
      const response = await fetch(
        `${baseUrl()}/api/admin/retention/report${query}`,
        { headers: { authorization: `Bearer ${TEST_ADMIN_SECRET}` } },
      );
      expect(response.status).toBe(400);
    }
  });
});

describe('Retention CLI parsing', () => {
  const argv = (...args: string[]) => ['node', 'retentionCli.js', ...args];

  it('parses report and apply modes without reading environment values', () => {
    expect(parseRetentionCliArgs(
      argv('report', '--older-than-days=30', '--batch-limit=25'),
      NOW.getTime(),
    )).toMatchObject({
      mode: 'report',
      cutoff: CUTOFF,
      olderThanDays: 30,
      batchLimit: 25,
      confirmation: null,
    });
    expect(parseRetentionCliArgs(
      argv('apply', '--older-than-days=30', `--confirm=${RETENTION_APPLY_CONFIRMATION}`),
      NOW.getTime(),
    )).toMatchObject({
      mode: 'apply',
      cutoff: CUTOFF,
      batchLimit: 1000,
      confirmation: RETENTION_APPLY_CONFIRMATION,
    });
  });

  it('rejects missing, duplicate, unknown, and mode-inappropriate arguments', () => {
    for (const args of [
      argv('report'),
      argv('report', '--older-than-days=30', '--older-than-days=60'),
      argv('report', '--older-than-days=30', '--confirm=unexpected'),
      argv('apply', '--older-than-days=30'),
      argv('apply', '--older-than-days=30', `--confirm=${RETENTION_APPLY_CONFIRMATION}`, '--other=x'),
    ]) {
      expect(() => parseRetentionCliArgs(args, NOW.getTime())).toThrow();
    }
  });
});
