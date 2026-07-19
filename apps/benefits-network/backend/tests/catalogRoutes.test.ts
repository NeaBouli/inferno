import { ethers } from 'ethers';

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

async function sellerHeaders(
  wallet: ethers.Wallet,
  action: string,
  businessId: string,
  scope?: string
): Promise<Record<string, string>> {
  const mutations = new Set([
    'business:create', 'business:update', 'business:delete', 'operators:create', 'operators:delete',
    'products:create', 'products:update', 'products:delete', 'rewards:apply',
    'rules:create', 'rules:update', 'rules:delete', 'sessions:create', 'sessions:redeem',
  ]);
  if (mutations.has(action)) {
    const query = new URLSearchParams({
      action,
      businessId,
      walletAddress: wallet.address,
      scope: scope || (action === 'sessions:create' ? 'default' : businessId),
    });
    const challengeResponse = await fetch(`${baseUrl()}/api/seller/auth-message?${query}`);
    expect(challengeResponse.status).toBe(200);
    const challenge = await challengeResponse.json() as {
      message: string;
      timestamp: string;
      nonce: string;
    };
    return {
      'content-type': 'application/json',
      'x-ifr-wallet': wallet.address,
      'x-ifr-signature': await wallet.signMessage(challenge.message),
      'x-ifr-timestamp': challenge.timestamp,
      'x-ifr-nonce': challenge.nonce,
    };
  }
  const challengeResponse = await fetch(
    `${baseUrl()}/api/seller/auth-message?${new URLSearchParams({ action, businessId })}`
  );
  expect(challengeResponse.status).toBe(200);
  const challenge = await challengeResponse.json() as { message: string; timestamp: string };
  return {
    'content-type': 'application/json',
    'x-ifr-wallet': wallet.address,
    'x-ifr-signature': await wallet.signMessage(challenge.message),
    'x-ifr-timestamp': challenge.timestamp,
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
    await prisma.sellerAuthorizationChallenge.deleteMany();
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

  it('requires a resource-bound one-time challenge for seller profile creation', async () => {
    const auth = await sellerHeaders(owner, 'business:create', 'new', 'new');
    const body = {
      name: 'Nonce protected seller',
      serviceArea: '  Athens   /   Attica  ',
      discountPercent: 8,
      requiredLockIFR: 800,
      ownerAddress: owner.address,
      signature: auth['x-ifr-signature'],
      timestamp: auth['x-ifr-timestamp'],
      nonce: auth['x-ifr-nonce'],
    };
    const create = () => fetch(`${baseUrl()}/api/seller/businesses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(401);
    expect(await prisma.business.count({ where: { ownerAddress: owner.address } })).toBe(2);
    expect(await prisma.business.findFirstOrThrow({ where: { name: body.name } })).toMatchObject({
      serviceArea: 'Athens / Attica',
      serviceAreaKey: 'athens / attica',
    });

    const wrongScope = await sellerHeaders(owner, 'business:create', 'new', 'not-new');
    const wrongScopeResponse = await fetch(`${baseUrl()}/api/seller/businesses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...body,
        name: 'Wrong scope seller',
        signature: wrongScope['x-ifr-signature'],
        timestamp: wrongScope['x-ifr-timestamp'],
        nonce: wrongScope['x-ifr-nonce'],
      }),
    });
    expect(wrongScopeResponse.status).toBe(401);
    expect(await prisma.business.count({ where: { ownerAddress: owner.address } })).toBe(2);

    const unknown = await fetch(
      `${baseUrl()}/api/seller/auth-message?${new URLSearchParams({
        action: 'business:transfer',
        businessId: businessId,
      })}`
    );
    expect(unknown.status).toBe(400);

    const unsafeScope = await fetch(
      `${baseUrl()}/api/seller/auth-message?${new URLSearchParams({
        action: 'business:create',
        businessId: 'new',
        walletAddress: owner.address,
        scope: 'new\nNonce: misleading',
      })}`
    );
    expect(unsafeScope.status).toBe(400);
  });

  it('keeps read-only authorizations stateless', async () => {
    expect(await prisma.sellerAuthorizationChallenge.count()).toBe(0);
    const headers = await sellerHeaders(owner, 'business:list', 'seller');
    expect(headers['x-ifr-nonce']).toBeUndefined();
    expect(await prisma.sellerAuthorizationChallenge.count()).toBe(0);
    expect((await fetch(`${baseUrl()}/api/seller/businesses`, { headers })).status).toBe(200);
    expect(await prisma.sellerAuthorizationChallenge.count()).toBe(0);
  });

  it('lets only the owner update a bounded public seller profile with a one-time challenge', async () => {
    const url = `${baseUrl()}/api/seller/businesses/${businessId}`;
    const validProfile = {
      name: 'Catalog Seller Athens',
      description: 'Independent coffee and member workshops in central Athens.',
      website: 'https://seller.example.com/members',
      serviceArea: 'Athens / Attica',
      categories: ['Food & drink', 'Events'],
    };

    expect((await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validProfile),
    })).status).toBe(401);

    const wrongOwnerHeaders = await sellerHeaders(otherOwner, 'business:update', businessId, businessId);
    expect((await fetch(url, {
      method: 'PATCH',
      headers: wrongOwnerHeaders,
      body: JSON.stringify(validProfile),
    })).status).toBe(403);

    for (const invalidProfile of [
      { website: 'http://seller.example.com' },
      { website: 'https://user:secret@seller.example.com' },
      { serviceArea: '' },
      { serviceArea: 'x'.repeat(81) },
      { categories: ['Coffee', 'coffee'] },
      { categories: Array.from({ length: 9 }, (_, index) => `Category ${index}`) },
      { unknownPublicField: 'must not be accepted' },
    ]) {
      const invalidHeaders = await sellerHeaders(owner, 'business:update', businessId, businessId);
      expect((await fetch(url, {
        method: 'PATCH',
        headers: invalidHeaders,
        body: JSON.stringify(invalidProfile),
      })).status).toBe(400);
    }

    const ownerHeaders = await sellerHeaders(owner, 'business:update', businessId, businessId);
    const updatedResponse = await fetch(url, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify(validProfile),
    });
    expect(updatedResponse.status).toBe(200);
    expect(await updatedResponse.json()).toEqual({
      id: businessId,
      name: validProfile.name,
      description: validProfile.description,
      website: 'https://seller.example.com/members',
      serviceArea: validProfile.serviceArea,
      categories: validProfile.categories,
    });
    expect((await fetch(url, {
      method: 'PATCH',
      headers: ownerHeaders,
      body: JSON.stringify({ description: 'Replay must fail.' }),
    })).status).toBe(401);

    expect(await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).toMatchObject({
      name: validProfile.name,
      description: validProfile.description,
      website: validProfile.website,
      serviceArea: validProfile.serviceArea,
      serviceAreaKey: 'athens / attica',
      categoriesJson: JSON.stringify(validProfile.categories),
    });

    const publicProfileResponse = await fetch(`${baseUrl()}/api/businesses/${businessId}`);
    expect(publicProfileResponse.status).toBe(200);
    const publicProfile = await publicProfileResponse.json() as Record<string, unknown>;
    expect(publicProfile).toMatchObject({
      id: businessId,
      name: validProfile.name,
      description: validProfile.description,
      website: validProfile.website,
      serviceArea: validProfile.serviceArea,
      categories: validProfile.categories,
    });
    expect(JSON.stringify(publicProfile)).not.toMatch(/ownerAddress|categoriesJson|serviceAreaKey|adminSecret/);

    const publicProductsResponse = await fetch(`${baseUrl()}/api/businesses/${businessId}/products`);
    expect(publicProductsResponse.status).toBe(200);
    const publicProducts = await publicProductsResponse.json() as {
      business: Record<string, unknown>;
      products: unknown[];
    };
    expect(publicProducts.business).toEqual({
      id: businessId,
      name: validProfile.name,
      description: validProfile.description,
      website: validProfile.website,
      serviceArea: validProfile.serviceArea,
      categories: validProfile.categories,
    });
    expect(JSON.stringify(publicProducts)).not.toMatch(/ownerAddress|categoriesJson|serviceAreaKey|adminSecret/);
  });

  it('keeps the operator admin fallback aligned with public profile validation', async () => {
    const url = `${baseUrl()}/api/admin/businesses/${businessId}`;
    const authorization = { authorization: 'Bearer test-secret-12345' };

    expect((await fetch(url)).status).toBe(401);

    expect((await fetch(url, {
      method: 'PATCH',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ website: 'http://seller.example.com' }),
    })).status).toBe(400);

    const updateResponse = await fetch(url, {
      method: 'PATCH',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Operator managed seller',
        description: 'Managed through the controlled operator fallback.',
        website: 'https://operator.example.com/ifr',
        serviceArea: '  Online   and   Athens  ',
        categories: ['Retail', 'Events'],
      }),
    });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({
      id: businessId,
      name: 'Operator managed seller',
      description: 'Managed through the controlled operator fallback.',
      website: 'https://operator.example.com/ifr',
      serviceArea: 'Online and Athens',
      categories: ['Retail', 'Events'],
    });
    expect(await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).toMatchObject({
      serviceArea: 'Online and Athens',
      serviceAreaKey: 'online and athens',
      categoriesJson: JSON.stringify(['Retail', 'Events']),
    });

    const reloadResponse = await fetch(url, { headers: authorization });
    expect(reloadResponse.status).toBe(200);
    const reloaded = await reloadResponse.json() as Record<string, unknown>;
    expect(reloaded).toMatchObject({
      id: businessId,
      name: 'Operator managed seller',
      description: 'Managed through the controlled operator fallback.',
      website: 'https://operator.example.com/ifr',
      serviceArea: 'Online and Athens',
      categories: ['Retail', 'Events'],
      ownerAddress: owner.address,
      verifyUrl: `/b/${businessId}`,
      qrUrl: `/b/${businessId}`,
      rulesCount: 0,
      productsCount: 0,
    });
    expect(JSON.stringify(reloaded)).not.toMatch(/categoriesJson|serviceAreaKey|adminSecret/);
  });

  it('sanitizes malformed legacy profile values before returning public data', async () => {
    await prisma.business.update({
      where: { id: businessId },
      data: {
        website: 'javascript:alert(1)',
        serviceArea: 'x'.repeat(81),
        serviceAreaKey: 'must-not-leak',
        categoriesJson: JSON.stringify([
          ' Retail ',
          'retail',
          '',
          7,
          'x'.repeat(81),
          'Events',
        ]),
      },
    });

    const profileResponse = await fetch(`${baseUrl()}/api/businesses/${businessId}`);
    expect(profileResponse.status).toBe(200);
    expect(await profileResponse.json()).toMatchObject({
      id: businessId,
      website: null,
      serviceArea: null,
      categories: ['Retail', 'Events'],
    });

    const productsResponse = await fetch(`${baseUrl()}/api/businesses/${businessId}/products`);
    expect(productsResponse.status).toBe(200);
    const products = await productsResponse.json() as { business: Record<string, unknown> };
    expect(products.business).toMatchObject({
      id: businessId,
      website: null,
      serviceArea: null,
      categories: ['Retail', 'Events'],
    });
    expect(JSON.stringify(products)).not.toMatch(/javascript:|categoriesJson|serviceAreaKey|ownerAddress|adminSecret/);
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
    expect((await fetch(url, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify(productPayload('Replay product')),
    })).status).toBe(401);
    expect(await prisma.product.count({ where: { businessId } })).toBe(1);
    const publicWithoutBenefit = await fetch(`${baseUrl()}/api/businesses/${businessId}/products`);
    expect((await publicWithoutBenefit.json() as { products: unknown[] }).products).toHaveLength(0);

    const listHeaders = await sellerHeaders(owner, 'products:list', businessId);
    const listResponse = await fetch(url, { headers: listHeaders });
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json() as { products: unknown[] }).products).toHaveLength(1);

    const outsiderUpdate = await sellerHeaders(otherOwner, 'products:update', businessId, created.id);
    expect((await fetch(`${baseUrl()}/api/seller/products/${created.id}`, {
      method: 'PATCH',
      headers: outsiderUpdate,
      body: JSON.stringify({ name: 'Hijacked name' }),
    })).status).toBe(403);

    const archiveHeaders = await sellerHeaders(owner, 'products:delete', businessId, created.id);
    expect((await fetch(`${baseUrl()}/api/seller/products/${created.id}`, {
      method: 'DELETE',
      headers: archiveHeaders,
    })).status).toBe(204);
    const reactivateHeaders = await sellerHeaders(owner, 'products:update', businessId, created.id);
    expect((await fetch(`${baseUrl()}/api/seller/products/${created.id}`, {
      method: 'PATCH',
      headers: reactivateHeaders,
      body: JSON.stringify({ active: true }),
    })).status).toBe(400);
  });

  it('keeps a product archived when archive races an active update', async () => {
    const product = await prisma.product.create({ data: { businessId, ...productPayload() } });
    const updateHeaders = await sellerHeaders(owner, 'products:update', businessId, product.id);
    const archiveHeaders = await sellerHeaders(owner, 'products:delete', businessId, product.id);
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

  it('discovers only active public offers with search, category and bounded pagination', async () => {
    await prisma.business.update({
      where: { id: businessId },
      data: {
        description: 'Neighborhood roaster and quiet member workspace.',
        website: 'https://catalog.example.com',
        serviceArea: 'Athens / Attica',
        serviceAreaKey: 'athens / attica',
        categoriesJson: JSON.stringify(['Hospitality', 'Coworking']),
      },
    });
    const [coffee, pausedProduct] = await Promise.all([
      prisma.product.create({ data: { businessId, ...productPayload() } }),
      prisma.product.create({
        data: { businessId, name: 'Paused pastry', category: 'Coffee', active: false },
      }),
    ]);
    const [coffeeRule, serviceRule] = await Promise.all([
      prisma.benefitRule.create({
        data: {
          businessId,
          productId: coffee.id,
          label: 'Morning coffee',
          category: coffee.category,
          productName: coffee.name,
          discountPercent: 20,
          requiredLockIFR: 1000,
        },
      }),
      prisma.benefitRule.create({
        data: {
          businessId,
          label: 'Member consultation',
          category: 'Services',
          productName: 'Private consultation',
          discountPercent: 15,
          requiredLockIFR: 2500,
        },
      }),
    ]);
    await Promise.all([
      prisma.benefitRule.create({
        data: {
          businessId,
          productId: pausedProduct.id,
          label: 'Hidden paused product',
          category: pausedProduct.category,
          productName: pausedProduct.name,
          discountPercent: 50,
          requiredLockIFR: 1,
        },
      }),
      prisma.benefitRule.create({
        data: {
          businessId,
          label: 'Hidden paused rule',
          category: 'Coffee',
          productName: 'Archived offer',
          discountPercent: 90,
          requiredLockIFR: 1,
          active: false,
        },
      }),
      prisma.benefitRule.create({
        data: {
          businessId: otherBusinessId,
          label: 'Hidden inactive seller',
          category: 'Retail',
          productName: 'Private listing',
          discountPercent: 90,
          requiredLockIFR: 1,
        },
      }),
      prisma.business.update({
        where: { id: otherBusinessId },
        data: { active: false, serviceArea: 'Online', serviceAreaKey: 'online' },
      }),
    ]);

    const response = await fetch(`${baseUrl()}/api/businesses?limit=1&page=1`);
    expect(response.status).toBe(200);
    const firstPage = await response.json() as {
      offers: Array<Record<string, unknown>>;
      categories: string[];
      serviceAreas: string[];
      pagination: { page: number; limit: number; total: number; totalPages: number; hasNext: boolean };
    };
    expect(firstPage.offers).toHaveLength(1);
    expect(firstPage.categories).toEqual(['Coffee', 'Services']);
    expect(firstPage.serviceAreas).toEqual(['Athens / Attica']);
    expect(firstPage.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2, hasNext: true });
    expect(Object.keys(firstPage.offers[0]).sort()).toEqual([
      'business', 'category', 'dailyRedemptionLimit', 'discountPercent', 'id', 'label',
      'monthlyRedemptionLimit', 'product', 'productName', 'requiredLockIFR',
    ]);
    expect(Object.keys(firstPage.offers[0].business as Record<string, unknown>).sort()).toEqual([
      'categories', 'description', 'id', 'name', 'serviceArea', 'website',
    ]);
    const firstProduct = firstPage.offers[0].product;
    if (firstProduct !== null) {
      expect(Object.keys(firstProduct as Record<string, unknown>).sort()).toEqual(['description', 'id', 'name']);
    }
    for (const offer of firstPage.offers) {
      expect(JSON.stringify(offer)).not.toMatch(
        /ownerAddress|serviceAreaKey|checkoutOperators|sellerAuthorizationChallenges|sessions|auditLogs|rewardEvents/
      );
    }

    const secondPage = await fetch(`${baseUrl()}/api/businesses?limit=1&page=2`);
    expect((await secondPage.json() as { pagination: { hasNext: boolean } }).pagination.hasNext).toBe(false);

    const search = await fetch(`${baseUrl()}/api/businesses?query=espresso`);
    const searchBody = await search.json() as {
      offers: Array<{ id: string; product: null | Record<string, unknown> }>;
    };
    expect(searchBody.offers.map((offer) => offer.id)).toEqual([coffeeRule.id]);
    expect(Object.keys(searchBody.offers[0].product || {}).sort()).toEqual(['description', 'id', 'name']);

    const profileDescriptionSearch = await fetch(`${baseUrl()}/api/businesses?query=workspace`);
    expect((await profileDescriptionSearch.json() as { offers: Array<{ id: string }> }).offers.map((offer) => offer.id))
      .toEqual(expect.arrayContaining([coffeeRule.id, serviceRule.id]));
    const profileCategorySearch = await fetch(`${baseUrl()}/api/businesses?query=Coworking`);
    expect((await profileCategorySearch.json() as { offers: Array<{ id: string }> }).offers.map((offer) => offer.id))
      .toEqual(expect.arrayContaining([coffeeRule.id, serviceRule.id]));

    const category = await fetch(`${baseUrl()}/api/businesses?category=Services`);
    const categoryBody = await category.json() as { offers: Array<{ id: string }> };
    expect(categoryBody.offers.map((offer) => offer.id)).toEqual([serviceRule.id]);

    const serviceArea = await fetch(`${baseUrl()}/api/businesses?serviceArea=ATHENS%20%2F%20ATTICA`);
    const serviceAreaBody = await serviceArea.json() as { offers: Array<{ id: string }> };
    expect(serviceAreaBody.offers.map((offer) => offer.id)).toEqual(expect.arrayContaining([
      coffeeRule.id,
      serviceRule.id,
    ]));
    const inactiveAreaResponse = await fetch(`${baseUrl()}/api/businesses?serviceArea=Online`);
    expect(inactiveAreaResponse.status).toBe(200);
    expect((await inactiveAreaResponse.json() as { offers: unknown[] }).offers).toHaveLength(0);

    expect((await fetch(`${baseUrl()}/api/businesses?page=0`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/businesses?limit=25`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/businesses?query=${'x'.repeat(81)}`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/businesses?serviceArea=${'x'.repeat(81)}`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/businesses?serviceArea=one&serviceArea=two`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/businesses?query=one&query=two`)).status).toBe(400);
  });

  it('rate limits public offer discovery by client IP', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.81' };
    for (let request = 0; request < 60; request += 1) {
      expect((await fetch(`${baseUrl()}/api/businesses?limit=1`, { headers })).status).toBe(200);
    }

    const limited = await fetch(`${baseUrl()}/api/businesses?limit=1`, { headers });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({ error: 'Too many offer searches. Try again shortly.' });
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
    expect((await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/rules`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'x-ifr-signature': `0x${'00'.repeat(65)}` },
      body: JSON.stringify(rulePayload(product.id)),
    })).status).toBe(401);

    const wrongOwnerHeaders = await sellerHeaders(otherOwner, 'rules:create', businessId);
    expect((await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/rules`, {
      method: 'POST',
      headers: wrongOwnerHeaders,
      body: JSON.stringify(rulePayload(product.id)),
    })).status).toBe(403);

    const wrongScopeHeaders = await sellerHeaders(owner, 'rules:create', businessId, 'wrong-scope');
    expect((await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/rules`, {
      method: 'POST',
      headers: wrongScopeHeaders,
      body: JSON.stringify(rulePayload(product.id)),
    })).status).toBe(401);

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
    expect((await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/rules`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify(rulePayload(product.id)),
    })).status).toBe(401);

    const session = await createSession(businessId, rule.id);
    expect(await buildChallengeMessage(session.sessionId)).toContain('Product: Premium espresso');

    const productUpdateHeaders = await sellerHeaders(owner, 'products:update', businessId, product.id);
    const updateResponse = await fetch(`${baseUrl()}/api/seller/products/${product.id}`, {
      method: 'PATCH',
      headers: productUpdateHeaders,
      body: JSON.stringify({ name: 'Reserve espresso', category: 'Drinks' }),
    });
    expect(updateResponse.status).toBe(200);

    const storedSnapshot = await prisma.benefitRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(storedSnapshot.productName).toBe('Premium espresso');
    expect(await buildChallengeMessage(session.sessionId)).toContain('Product: Premium espresso');

    const refreshHeaders = await sellerHeaders(owner, 'rules:update', businessId, rule.id);
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

  it('keeps customer identity and exact rejection details out of public proof links', async () => {
    const approvedSession = await createSession(businessId);
    mockRecoverSigner.mockReturnValue(owner.address);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '2500.0' });

    const challengeResponse = await fetch(
      `${baseUrl()}/api/sessions/${approvedSession.sessionId}/challenge`
    );
    expect(challengeResponse.status).toBe(200);
    expect(challengeResponse.headers.get('cache-control')).toContain('no-store');

    const attestResponse = await fetch(`${baseUrl()}/api/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: approvedSession.sessionId, signature: '0x1234' }),
    });
    expect(attestResponse.status).toBe(200);
    expect(attestResponse.headers.get('cache-control')).toContain('no-store');
    expect(await attestResponse.json()).toMatchObject({
      status: 'APPROVED',
      wallet: owner.address,
    });

    const approvedStatusResponse = await fetch(
      `${baseUrl()}/api/sessions/${approvedSession.sessionId}`
    );
    expect(approvedStatusResponse.headers.get('cache-control')).toContain('private');
    expect(approvedStatusResponse.headers.get('cache-control')).toContain('no-store');
    const approvedStatus = await approvedStatusResponse.json() as Record<string, unknown>;
    expect(approvedStatus).not.toHaveProperty('recoveredAddress');
    expect(approvedStatus).toMatchObject({ status: 'APPROVED', reason: null });

    const rejectedSession = await createSession(businessId);
    const detailedReason = 'Only 250.0 IFR locked; 1000 IFR required.';
    await prisma.session.update({
      where: { id: rejectedSession.sessionId },
      data: {
        status: 'REJECTED',
        recoveredAddress: owner.address,
        lockAmountRaw: '250.0',
        reason: detailedReason,
        attestAttempts: 3,
      },
    });

    const rejectedStatusResponse = await fetch(
      `${baseUrl()}/api/sessions/${rejectedSession.sessionId}`
    );
    const rejectedStatus = await rejectedStatusResponse.json() as Record<string, unknown>;
    expect(rejectedStatus).not.toHaveProperty('recoveredAddress');
    expect(JSON.stringify(rejectedStatus)).not.toContain(owner.address);
    expect(JSON.stringify(rejectedStatus)).not.toContain('250.0');
    expect(rejectedStatus).toMatchObject({
      status: 'REJECTED',
      reason: 'Verification was not approved. The customer can review details on their device.',
    });

    const historyHeaders = await sellerHeaders(owner, 'sessions:list', businessId);
    const historyResponse = await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/sessions`, {
      headers: historyHeaders,
    });
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json() as { sessions: Array<Record<string, unknown>> };
    expect(history.sessions.find((item) => item.id === rejectedSession.sessionId)).toMatchObject({
      recoveredAddress: owner.address,
      lockAmountRaw: '250.0',
      reason: detailedReason,
    });
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

    const deleteHeaders = await sellerHeaders(owner, 'products:delete', businessId, product.id);
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

    const reactivateHeaders = await sellerHeaders(owner, 'rules:update', businessId, rule.id);
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
    const deleteHeaders = await sellerHeaders(owner, 'rules:delete', businessId, rule.id);

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
    const archiveHeaders = await sellerHeaders(owner, 'products:delete', businessId, product.id);
    const createHeaders = await sellerHeaders(owner, 'sessions:create', businessId, rule.id);
    const [createResponse, archiveResponse] = await Promise.all([
      fetch(`${baseUrl()}/api/sessions`, {
        method: 'POST',
        headers: createHeaders,
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
