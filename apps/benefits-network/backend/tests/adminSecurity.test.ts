import { createHash } from 'node:crypto';

jest.setTimeout(15_000);

jest.mock('../src/services/ifrLockService', () => ({
  checkLock: jest.fn(),
  checkBenefitEligibility: jest.fn(),
  recoverSigner: jest.fn(),
  initProvider: jest.fn(),
}));

const mockGetRewardOnChainStatus = jest.fn();

jest.mock('../src/services/rewardService', () => ({
  ...jest.requireActual('../src/services/rewardService'),
  getRewardOnChainStatus: (...args: unknown[]) => mockGetRewardOnChainStatus(...args),
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
import { ADMIN_SECRET_MIN_LENGTH, getAdminSecretPolicyIssue } from '../src/services/adminSecretPolicy';

function baseUrl() {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

const adminHeaders = {
  authorization: `Bearer ${TEST_ADMIN_SECRET}`,
  'content-type': 'application/json',
};

async function cleanDatabase() {
  const adminAuditLog = (prisma as unknown as {
    adminAuditLog?: { deleteMany(): Promise<unknown> };
  }).adminAuditLog;
  if (adminAuditLog) await adminAuditLog.deleteMany();
  await prisma.rewardEvent.deleteMany();
  await prisma.sellerRewardLink.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.benefitRule.deleteMany();
  await prisma.product.deleteMany();
  await prisma.checkoutOperator.deleteMany();
  await prisma.business.deleteMany();
}

describe('Admin API security baseline', () => {
  beforeEach(cleanDatabase);

  afterAll(async () => {
    await cleanDatabase();
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it('uses one generic Bearer challenge for missing, malformed and wrong credentials', async () => {
    const url = `${baseUrl()}/api/admin/businesses`;
    const cases: Record<string, string>[] = [
      {},
      { authorization: 'Basic dGVzdA==' },
      { authorization: 'Bearer' },
      { authorization: 'Bearer definitely-wrong' },
    ];
    const bodies: unknown[] = [];

    for (const authorization of cases) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authorization },
        body: '{}',
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      bodies.push(await response.json());
    }

    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]).toEqual({ error: 'Unauthorized' });
  });

  it('returns safe 400 and 413 responses for malformed and oversized JSON', async () => {
    const url = `${baseUrl()}/api/admin/businesses`;
    const malformed = await fetch(url, {
      method: 'POST',
      headers: adminHeaders,
      body: '{"name":',
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Malformed JSON body' });

    const oversized = await fetch(url, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'x'.repeat(11 * 1024),
        discountPercent: 10,
        requiredLockIFR: 1000,
      }),
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: 'Request body too large' });
  });

  it('persists a digest-only audit record for a successful admin mutation', async () => {
    const response = await fetch(`${baseUrl()}/api/admin/businesses`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Audit Test Shop',
        discountPercent: 10,
        requiredLockIFR: 1000,
      }),
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string };
    const adminAuditLog = (prisma as unknown as {
      adminAuditLog: { findMany(): Promise<Array<Record<string, unknown>>> };
    }).adminAuditLog;
    const audit = await adminAuditLog.findMany();

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'business:create',
      method: 'POST',
      routeTemplate: '/api/admin/businesses',
      targetType: 'Business',
      targetId: created.id,
      statusCode: 201,
    });
    expect(audit[0].actorDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(audit[0].actorDigest).toBe(
      createHash('sha256').update('admin-actor:primary').digest('hex')
    );
    expect(audit[0].clientDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(audit[0])).not.toContain(TEST_ADMIN_SECRET);
    expect(JSON.stringify(audit[0])).not.toContain('127.0.0.1');
  });

  it('audits a reward verification conflict when that branch mutates state', async () => {
    const business = await prisma.business.create({
      data: {
        name: 'Conflict Audit Shop',
        ownerAddress: '0x00000000000000000000000000000000000000aa',
        discountPercent: 10,
        requiredLockIFR: 1000,
      },
    });
    mockGetRewardOnChainStatus.mockResolvedValue({
      verified: false,
      partnerId: null,
      reason: 'PartnerVault partner is not active',
      checkedAt: 1_700_000_000_000,
      blockNumber: 123,
      submissionReady: false,
    });

    const response = await fetch(
      `${baseUrl()}/api/admin/businesses/${business.id}/rewards/verify`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ partnerId: `0x${'ab'.repeat(32)}` }),
      }
    );
    expect(response.status).toBe(409);
    expect(await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId: business.id } }))
      .toMatchObject({ status: 'APPLIED', partnerId: null });
    expect(await prisma.adminAuditLog.findFirstOrThrow()).toMatchObject({
      action: 'rewards:verify',
      routeTemplate: '/api/admin/businesses/:id/rewards/verify',
      targetType: 'Business',
      targetId: business.id,
      statusCode: 409,
    });
  });

  it('pauses catalog dependents atomically on deactivation and restores only the business', async () => {
    const business = await prisma.business.create({
      data: {
        name: 'Lifecycle Admin Shop',
        ownerAddress: '0x00000000000000000000000000000000000000bb',
        discountPercent: 10,
        requiredLockIFR: 1000,
      },
    });
    const product = await prisma.product.create({
      data: { businessId: business.id, name: 'Admin lifecycle item', category: 'Retail' },
    });
    const rule = await prisma.benefitRule.create({
      data: {
        businessId: business.id,
        label: 'Admin lifecycle rule',
        category: 'Retail',
        productName: 'Admin lifecycle item',
        discountPercent: 10,
        requiredLockIFR: 1000,
      },
    });
    const operator = await prisma.checkoutOperator.create({
      data: {
        businessId: business.id,
        walletAddress: '0x00000000000000000000000000000000000000cc',
      },
    });

    const deactivate = await fetch(`${baseUrl()}/api/admin/businesses/${business.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ active: false }),
    });
    expect(deactivate.status).toBe(200);
    expect(await prisma.business.findUniqueOrThrow({ where: { id: business.id } }))
      .toMatchObject({ active: false });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } }))
      .toMatchObject({ active: false });
    expect(await prisma.benefitRule.findUniqueOrThrow({ where: { id: rule.id } }))
      .toMatchObject({ active: false });
    expect(await prisma.checkoutOperator.findUniqueOrThrow({ where: { id: operator.id } }))
      .toMatchObject({ active: false });

    const reactivate = await fetch(`${baseUrl()}/api/admin/businesses/${business.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ active: true }),
    });
    expect(reactivate.status).toBe(200);
    expect(await prisma.business.findUniqueOrThrow({ where: { id: business.id } }))
      .toMatchObject({ active: true });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } }))
      .toMatchObject({ active: false });
    expect(await prisma.benefitRule.findUniqueOrThrow({ where: { id: rule.id } }))
      .toMatchObject({ active: false });
    expect(await prisma.checkoutOperator.findUniqueOrThrow({ where: { id: operator.id } }))
      .toMatchObject({ active: false });

    expect(await prisma.adminAuditLog.count({
      where: { action: 'business:update', targetId: business.id, statusCode: 200 },
    })).toBe(2);
  });
});

describe('Admin secret startup policy', () => {
  it('rejects short and documented placeholders while accepting a long test value', () => {
    expect(ADMIN_SECRET_MIN_LENGTH).toBe(32);
    expect(getAdminSecretPolicyIssue('x'.repeat(31))).toMatch(/32/);
    expect(getAdminSecretPolicyIssue('change-me-to-a-random-secret')).toBeTruthy();
    expect(getAdminSecretPolicyIssue('replace-with-a-long-random-admin-secret')).toMatch(/placeholder/);
    expect(getAdminSecretPolicyIssue(TEST_ADMIN_SECRET)).toBeNull();
  });
});
