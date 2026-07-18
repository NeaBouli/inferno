import { ethers } from 'ethers';
import { buildSellerAuthMessage } from '../src/services/sellerAuth';

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
    PORT: 0,
  },
}));

import { attest, buildChallengeMessage, createSession, prisma } from '../src/services/sessionService';
import { server } from '../src/index';

function baseUrl() {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function sellerHeaders(wallet: ethers.Wallet, action: string, businessId: string) {
  const timestamp = Date.now().toString();
  const signature = await wallet.signMessage(buildSellerAuthMessage(action, businessId, timestamp));
  return {
    'content-type': 'application/json',
    'x-ifr-wallet': wallet.address,
    'x-ifr-signature': signature,
    'x-ifr-timestamp': timestamp,
  };
}

function productPayload(name = 'Premium espresso') {
  return { name, category: 'Coffee', description: 'Double origin espresso for IFR members.' };
}

function rulePayload(productId: string) {
  return {
    productId,
    label: 'Coffee access',
    category: 'Untrusted category',
    productName: 'Untrusted product name',
    discountPercent: 20,
    requiredLockIFR: 1000,
    ttlSeconds: 90,
    dailyRedemptionLimit: 1,
    monthlyRedemptionLimit: 10,
  };
}

describe('Seller catalog routes', () => {
  const owner = ethers.Wallet.createRandom();
  const otherOwner = ethers.Wallet.createRandom();
  let businessId: string;
  let otherBusinessId: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    await prisma.auditLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.benefitRule.deleteMany();
    await prisma.product.deleteMany();
    await prisma.checkoutOperator.deleteMany();
    await prisma.business.deleteMany();
    const [business, otherBusiness] = await Promise.all([
      prisma.business.create({
        data: {
          name: 'Catalog Seller',
          ownerAddress: owner.address,
          discountPercent: 10,
          requiredLockIFR: 1000,
        },
      }),
      prisma.business.create({
        data: {
          name: 'Other Seller',
          ownerAddress: otherOwner.address,
          discountPercent: 5,
          requiredLockIFR: 500,
        },
      }),
    ]);
    businessId = business.id;
    otherBusinessId = otherBusiness.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.benefitRule.deleteMany();
    await prisma.product.deleteMany();
    await prisma.checkoutOperator.deleteMany();
    await prisma.business.deleteMany();
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it('keeps catalog management owner-only', async () => {
    const url = `${baseUrl()}/api/seller/businesses/${businessId}/products`;
    expect((await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(productPayload()),
    })).status).toBe(401);

    const wrongHeaders = await sellerHeaders(otherOwner, 'products:create', businessId);
    expect((await fetch(url, {
      method: 'POST',
      headers: wrongHeaders,
      body: JSON.stringify(productPayload()),
    })).status).toBe(403);

    const ownerHeaders = await sellerHeaders(owner, 'products:create', businessId);
    const createdResponse = await fetch(url, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify(productPayload()),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { id: string; active: boolean; name: string };
    expect(created).toMatchObject({ active: true, name: 'Premium espresso' });
    const publicWithoutBenefit = await fetch(`${baseUrl()}/api/businesses/${businessId}/products`);
    expect((await publicWithoutBenefit.json() as { products: unknown[] }).products).toHaveLength(0);

    const listHeaders = await sellerHeaders(owner, 'products:list', businessId);
    const listResponse = await fetch(url, { headers: listHeaders });
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json() as { products: unknown[] }).products).toHaveLength(1);

    const outsiderUpdate = await sellerHeaders(otherOwner, 'products:update', businessId);
    expect((await fetch(`${baseUrl()}/api/seller/products/${created.id}`, {
      method: 'PATCH',
      headers: outsiderUpdate,
      body: JSON.stringify({ name: 'Hijacked name' }),
    })).status).toBe(403);

    const archiveHeaders = await sellerHeaders(owner, 'products:delete', businessId);
    expect((await fetch(`${baseUrl()}/api/seller/products/${created.id}`, {
      method: 'DELETE',
      headers: archiveHeaders,
    })).status).toBe(204);
    const reactivateHeaders = await sellerHeaders(owner, 'products:update', businessId);
    expect((await fetch(`${baseUrl()}/api/seller/products/${created.id}`, {
      method: 'PATCH',
      headers: reactivateHeaders,
      body: JSON.stringify({ active: true }),
    })).status).toBe(400);
  });

  it('keeps a product archived when archive races an active update', async () => {
    const product = await prisma.product.create({ data: { businessId, ...productPayload() } });
    const updateHeaders = await sellerHeaders(owner, 'products:update', businessId);
    const archiveHeaders = await sellerHeaders(owner, 'products:delete', businessId);
    const [updateResponse, archiveResponse] = await Promise.all([
      fetch(`${baseUrl()}/api/seller/products/${product.id}`, {
        method: 'PATCH',
        headers: updateHeaders,
        body: JSON.stringify({ active: true, name: 'Concurrent update' }),
      }),
      fetch(`${baseUrl()}/api/seller/products/${product.id}`, {
        method: 'DELETE',
        headers: archiveHeaders,
      }),
    ]);

    expect([200, 400]).toContain(updateResponse.status);
    expect(archiveResponse.status).toBe(204);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({
      active: false,
    });
  });

  it('binds rules only to active products from the same business and preserves snapshots', async () => {
    const product = await prisma.product.create({
      data: { businessId, ...productPayload() },
    });

    const crossBusinessHeaders = await sellerHeaders(otherOwner, 'rules:create', otherBusinessId);
    const crossBusinessResponse = await fetch(`${baseUrl()}/api/seller/businesses/${otherBusinessId}/rules`, {
      method: 'POST',
      headers: crossBusinessHeaders,
      body: JSON.stringify(rulePayload(product.id)),
    });
    expect(crossBusinessResponse.status).toBe(404);

    const ownerHeaders = await sellerHeaders(owner, 'rules:create', businessId);
    const createdResponse = await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/rules`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify(rulePayload(product.id)),
    });
    expect(createdResponse.status).toBe(201);
    const rule = await createdResponse.json() as {
      id: string;
      productId: string;
      productName: string;
      category: string;
    };
    expect(rule).toMatchObject({
      productId: product.id,
      productName: 'Premium espresso',
      category: 'Coffee',
    });

    const session = await createSession(businessId, rule.id);
    expect(await buildChallengeMessage(session.sessionId)).toContain('Product: Premium espresso');

    const productUpdateHeaders = await sellerHeaders(owner, 'products:update', businessId);
    const updateResponse = await fetch(`${baseUrl()}/api/seller/products/${product.id}`, {
      method: 'PATCH',
      headers: productUpdateHeaders,
      body: JSON.stringify({ name: 'Reserve espresso', category: 'Drinks' }),
    });
    expect(updateResponse.status).toBe(200);

    const storedSnapshot = await prisma.benefitRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(storedSnapshot.productName).toBe('Premium espresso');
    expect(await buildChallengeMessage(session.sessionId)).toContain('Product: Premium espresso');

    const refreshHeaders = await sellerHeaders(owner, 'rules:update', businessId);
    const refreshResponse = await fetch(`${baseUrl()}/api/seller/rules/${rule.id}`, {
      method: 'PATCH',
      headers: refreshHeaders,
      body: JSON.stringify({ productId: product.id, discountPercent: 30, requiredLockIFR: 5000 }),
    });
    expect(refreshResponse.status).toBe(200);
    expect(await refreshResponse.json()).toMatchObject({
      productName: 'Reserve espresso',
      category: 'Drinks',
      discountPercent: 30,
      requiredLockIFR: 5000,
    });
    expect(await buildChallengeMessage(session.sessionId)).toContain('Product: Premium espresso');
    expect(await buildChallengeMessage(session.sessionId)).toContain('Required Lock IFR: 1000');
    const oldSessionStatus = await fetch(`${baseUrl()}/api/sessions/${session.sessionId}`);
    expect(await oldSessionStatus.json()).toMatchObject({
      benefit: {
        productName: 'Premium espresso',
        discountPercent: 20,
        requiredLockIFR: 1000,
        dailyRedemptionLimit: 1,
        monthlyRedemptionLimit: 10,
      },
    });
    const historyHeaders = await sellerHeaders(owner, 'sessions:list', businessId);
    const historyResponse = await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/sessions`, {
      headers: historyHeaders,
    });
    const history = await historyResponse.json() as { sessions: Array<Record<string, unknown>> };
    expect(history.sessions.find((item) => item.id === session.sessionId)).toMatchObject({
      productName: 'Premium espresso',
      category: 'Coffee',
      discountPercent: 20,
      requiredLockIFR: 1000,
      dailyRedemptionLimit: 1,
      monthlyRedemptionLimit: 10,
    });
    mockRecoverSigner.mockReturnValue(owner.address);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '1000.0' });
    await expect(attest(session.sessionId, '0xsnapshot-signature')).resolves.toMatchObject({
      status: 'APPROVED',
    });
    expect(mockCheckLock).toHaveBeenCalledWith(owner.address, 1000);

    const refreshedSession = await createSession(businessId, rule.id);
    expect(await buildChallengeMessage(refreshedSession.sessionId)).toContain('Product: Reserve espresso');
    expect(await buildChallengeMessage(refreshedSession.sessionId)).toContain('Required Lock IFR: 5000');
  });

  it('archives products and linked rules without deleting session history', async () => {
    const product = await prisma.product.create({ data: { businessId, ...productPayload() } });
    const rule = await prisma.benefitRule.create({
      data: {
        businessId,
        productId: product.id,
        label: 'Archive test',
        category: product.category,
        productName: product.name,
        discountPercent: 15,
        requiredLockIFR: 1000,
      },
    });
    const session = await createSession(businessId, rule.id);

    const deleteHeaders = await sellerHeaders(owner, 'products:delete', businessId);
    expect((await fetch(`${baseUrl()}/api/seller/products/${product.id}`, {
      method: 'DELETE',
      headers: deleteHeaders,
    })).status).toBe(204);

    const [savedProduct, savedRule, savedSession] = await Promise.all([
      prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
      prisma.benefitRule.findUniqueOrThrow({ where: { id: rule.id } }),
      prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } }),
    ]);
    expect(savedProduct.active).toBe(false);
    expect(savedRule.active).toBe(false);
    expect(savedSession.benefitRuleId).toBe(rule.id);
    expect(await buildChallengeMessage(session.sessionId)).toContain('Product: Premium espresso');

    const publicProducts = await fetch(`${baseUrl()}/api/businesses/${businessId}/products`);
    expect(publicProducts.status).toBe(200);
    expect((await publicProducts.json() as { products: unknown[] }).products).toHaveLength(0);
    const publicRules = await fetch(`${baseUrl()}/api/businesses/${businessId}/rules`);
    expect((await publicRules.json() as { rules: unknown[] }).rules).toHaveLength(0);

    const reactivateHeaders = await sellerHeaders(owner, 'rules:update', businessId);
    expect((await fetch(`${baseUrl()}/api/seller/rules/${rule.id}`, {
      method: 'PATCH',
      headers: reactivateHeaders,
      body: JSON.stringify({ active: true }),
    })).status).toBe(404);
    expect(await prisma.benefitRule.findUniqueOrThrow({ where: { id: rule.id } })).toMatchObject({
      active: false,
    });

    expect((await fetch(`${baseUrl()}/api/admin/rules/${rule.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-secret-12345',
      },
      body: JSON.stringify({ active: true }),
    })).status).toBe(409);
    expect(await prisma.benefitRule.findUniqueOrThrow({ where: { id: rule.id } })).toMatchObject({
      active: false,
    });
  });

  it('archives a rule without deleting its existing session history', async () => {
    const rule = await prisma.benefitRule.create({
      data: {
        businessId,
        label: 'Direct archive test',
        category: 'Services',
        productName: 'Consultation',
        discountPercent: 12,
        requiredLockIFR: 1200,
      },
    });
    const session = await createSession(businessId, rule.id);
    const deleteHeaders = await sellerHeaders(owner, 'rules:delete', businessId);

    expect((await fetch(`${baseUrl()}/api/seller/rules/${rule.id}`, {
      method: 'DELETE',
      headers: deleteHeaders,
    })).status).toBe(204);

    expect(await prisma.benefitRule.findUniqueOrThrow({ where: { id: rule.id } })).toMatchObject({
      active: false,
    });
    expect(await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } })).toMatchObject({
      benefitRuleId: rule.id,
      benefitSnapshotVersion: 2,
      benefitProductName: 'Consultation',
    });
    expect(await buildChallengeMessage(session.sessionId)).toContain('Product: Consultation');
    await expect(createSession(businessId, rule.id)).rejects.toThrow('not found or inactive');
  });

  it('keeps legacy sessions readable through challenge, status and seller history', async () => {
    const rule = await prisma.benefitRule.create({
      data: {
        businessId,
        label: 'Legacy benefit',
        category: 'Legacy category',
        productName: 'Legacy service',
        discountPercent: 9,
        requiredLockIFR: 900,
      },
    });
    const legacy = await prisma.session.create({
      data: {
        businessId,
        benefitRuleId: rule.id,
        nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(await buildChallengeMessage(legacy.id)).toContain('Product: Legacy service');
    const statusResponse = await fetch(`${baseUrl()}/api/sessions/${legacy.id}`);
    expect(await statusResponse.json()).toMatchObject({
      benefit: { label: 'Legacy benefit', discountPercent: 9, requiredLockIFR: 900 },
    });
    const historyHeaders = await sellerHeaders(owner, 'sessions:list', businessId);
    const historyResponse = await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/sessions`, {
      headers: historyHeaders,
    });
    const history = await historyResponse.json() as { sessions: Array<Record<string, unknown>> };
    expect(history.sessions.find((item) => item.id === legacy.id)).toMatchObject({
      label: 'Legacy benefit',
      category: 'Legacy category',
      productName: 'Legacy service',
      discountPercent: 9,
      requiredLockIFR: 900,
    });
  });

  it('serializes product archive against new checkout session creation', async () => {
    const product = await prisma.product.create({ data: { businessId, ...productPayload() } });
    const rule = await prisma.benefitRule.create({
      data: {
        businessId,
        productId: product.id,
        label: 'Race benefit',
        category: product.category,
        productName: product.name,
        discountPercent: 10,
        requiredLockIFR: 1000,
      },
    });
    const archiveHeaders = await sellerHeaders(owner, 'products:delete', businessId);
    const [createResponse, archiveResponse] = await Promise.all([
      fetch(`${baseUrl()}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessId, benefitRuleId: rule.id }),
      }),
      fetch(`${baseUrl()}/api/seller/products/${product.id}`, {
        method: 'DELETE',
        headers: archiveHeaders,
      }),
    ]);

    expect(archiveResponse.status).toBe(204);
    expect([201, 404]).toContain(createResponse.status);
    if (createResponse.status === 201) {
      const created = await createResponse.json() as { sessionId: string };
      const [savedSession, archivedProduct, archivedRule] = await Promise.all([
        prisma.session.findUniqueOrThrow({ where: { id: created.sessionId } }),
        prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
        prisma.benefitRule.findUniqueOrThrow({ where: { id: rule.id } }),
      ]);
      expect(savedSession).toMatchObject({
        benefitRuleId: rule.id,
        benefitSnapshotVersion: 2,
        benefitProductName: 'Premium espresso',
      });
      expect(archivedProduct.active).toBe(false);
      expect(archivedRule.active).toBe(false);
    }
    await expect(createSession(businessId, rule.id)).rejects.toThrow('not found or inactive');
  });
});
