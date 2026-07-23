import { ethers } from 'ethers';

type TestWallet = ReturnType<typeof ethers.Wallet.createRandom>;

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
  wallet: TestWallet,
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
    minIFRHeld: 250,
    ttlSeconds: 90,
    dailyRedemptionLimit: 1,
    monthlyRedemptionLimit: 10,
  };
}

describe('Seller catalog routes', () => {
  const owner = ethers.Wallet.createRandom();
  const otherOwner = ethers.Wallet.createRandom();
  let businessId: string;

  it('sets the API response security baseline without framework disclosure', async () => {
    const response = await fetch(`${baseUrl()}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-powered-by')).toBeNull();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('permissions-policy')).toContain('camera=(self)');
  });
  let otherBusinessId: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCheckBenefitEligibility.mockImplementation((...args: unknown[]) => mockCheckLock(...args));
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
      logoUrl: 'https://assets.example.com/nonce-seller.png',
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
      logoUrl: body.logoUrl,
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
      logoUrl: 'https://assets.example.com/catalog-seller.png',
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
      { logoUrl: 'http://assets.example.com/logo.png' },
      { logoUrl: 'https://user:secret@assets.example.com/logo.png' },
      { logoUrl: `https://assets.example.com/${'x'.repeat(500)}` },
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
      logoUrl: validProfile.logoUrl,
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
      logoUrl: validProfile.logoUrl,
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
      logoUrl: validProfile.logoUrl,
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
      logoUrl: validProfile.logoUrl,
      serviceArea: validProfile.serviceArea,
      categories: validProfile.categories,
    });
    expect(JSON.stringify(publicProducts)).not.toMatch(/ownerAddress|categoriesJson|serviceAreaKey|adminSecret/);

    const clearLogoHeaders = await sellerHeaders(owner, 'business:update', businessId, businessId);
    const clearLogoResponse = await fetch(url, {
      method: 'PATCH',
      headers: clearLogoHeaders,
      body: JSON.stringify({ logoUrl: null }),
    });
    expect(clearLogoResponse.status).toBe(200);
    expect(await clearLogoResponse.json()).toMatchObject({ id: businessId, logoUrl: null });
    expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).logoUrl).toBeNull();
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
        logoUrl: 'https://operator.example.com/ifr-logo.svg',
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
      logoUrl: 'https://operator.example.com/ifr-logo.svg',
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
      logoUrl: 'https://operator.example.com/ifr-logo.svg',
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
        logoUrl: 'javascript:alert(2)',
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
      logoUrl: null,
      serviceArea: null,
      categories: ['Retail', 'Events'],
    });

    const productsResponse = await fetch(`${baseUrl()}/api/businesses/${businessId}/products`);
    expect(productsResponse.status).toBe(200);
    const products = await productsResponse.json() as { business: Record<string, unknown> };
    expect(products.business).toMatchObject({
      id: businessId,
      website: null,
      logoUrl: null,
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

  it('validates exact optional product prices as an atomic amount and currency pair', async () => {
    const url = `${baseUrl()}/api/seller/businesses/${businessId}/products`;
    const create = async (payload: Record<string, unknown>) => fetch(url, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'products:create', businessId),
      body: JSON.stringify({ ...productPayload('Priced item'), ...payload }),
    });

    const priced = await create({ basePriceMinor: '2500', currency: 'JPY' });
    expect(priced.status).toBe(201);
    expect(await priced.json()).toMatchObject({
      basePriceMinor: '2500',
      currency: 'JPY',
    });

    for (const invalid of [
      { basePriceMinor: '1999' },
      { currency: 'EUR' },
      { basePriceMinor: 1999, currency: 'EUR' },
      { basePriceMinor: '19.99', currency: 'EUR' },
      { basePriceMinor: '01999', currency: 'EUR' },
      { basePriceMinor: '1999', currency: 'eur' },
      { basePriceMinor: '1999', currency: 'BTC' },
      { basePriceMinor: '1999', currency: 'EUR', unexpected: true },
    ]) {
      expect((await create(invalid)).status).toBe(400);
    }

    const clearHeaders = await sellerHeaders(owner, 'products:update', businessId, (await prisma.product.findFirstOrThrow({
      where: { businessId, name: 'Priced item' },
      select: { id: true },
    })).id);
    const product = await prisma.product.findFirstOrThrow({ where: { businessId, name: 'Priced item' } });
    const cleared = await fetch(`${baseUrl()}/api/seller/products/${product.id}`, {
      method: 'PATCH',
      headers: clearHeaders,
      body: JSON.stringify({ basePriceMinor: null, currency: null }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ basePriceMinor: null, currency: null });

    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceMinor: '19.99', currency: 'BTC' },
    });
    const listResponse = await fetch(url, {
      headers: await sellerHeaders(owner, 'products:list', businessId),
    });
    expect((await listResponse.json() as { products: Array<Record<string, unknown>> }).products[0])
      .toMatchObject({ basePriceMinor: null, currency: null });
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
    const ownerlessBusiness = await prisma.business.create({
      data: {
        name: 'Operator-only draft',
        discountPercent: 10,
        requiredLockIFR: 1000,
        serviceArea: 'Online',
        serviceAreaKey: 'online',
      },
    });
    await prisma.benefitRule.create({
      data: {
        businessId: ownerlessBusiness.id,
        label: 'Unusable checkout offer',
        category: 'Services',
        productName: 'Must remain private',
        discountPercent: 10,
        requiredLockIFR: 1000,
      },
    });
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
      'lockSource', 'minIFRHeld', 'monthlyRedemptionLimit', 'product', 'productName', 'requiredLockIFR',
    ]);
    expect(Object.keys(firstPage.offers[0].business as Record<string, unknown>).sort()).toEqual([
      'categories', 'description', 'id', 'logoUrl', 'name', 'serviceArea', 'website',
    ]);
    const firstProduct = firstPage.offers[0].product;
    if (firstProduct !== null) {
      expect(Object.keys(firstProduct as Record<string, unknown>).sort()).toEqual([
        'basePriceMinor',
        'currency',
        'description',
        'id',
        'name',
      ]);
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
    expect(Object.keys(searchBody.offers[0].product || {}).sort()).toEqual([
      'basePriceMinor',
      'currency',
      'description',
      'id',
      'name',
    ]);
    expect(searchBody.offers[0].product).toMatchObject({
      basePriceMinor: null,
      currency: null,
    });

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

    await prisma.business.update({
      where: { id: otherBusinessId },
      data: { active: true },
    });
    const exactSellerResponse = await fetch(
      `${baseUrl()}/api/businesses?businessId=${encodeURIComponent(businessId)}`
    );
    expect(exactSellerResponse.status).toBe(200);
    const exactSellerBody = await exactSellerResponse.json() as {
      offers: Array<{ id: string; business: { id: string } }>;
      pagination: { total: number };
    };
    expect(exactSellerBody.offers.map((offer) => offer.id)).toEqual(expect.arrayContaining([
      coffeeRule.id,
      serviceRule.id,
    ]));
    expect(exactSellerBody.offers.every((offer) => offer.business.id === businessId)).toBe(true);
    expect(exactSellerBody.pagination.total).toBe(2);

    const exactOtherSeller = await fetch(
      `${baseUrl()}/api/businesses?businessId=${encodeURIComponent(otherBusinessId)}`
    );
    const exactOtherSellerBody = await exactOtherSeller.json() as {
      offers: Array<{ productName: string; business: { id: string } }>;
    };
    expect(exactOtherSellerBody.offers).toHaveLength(1);
    expect(exactOtherSellerBody.offers[0]).toMatchObject({
      productName: 'Private listing',
      business: { id: otherBusinessId },
    });
    const ownerlessDiscovery = await fetch(
      `${baseUrl()}/api/businesses?businessId=${encodeURIComponent(ownerlessBusiness.id)}`
    );
    expect((await ownerlessDiscovery.json() as { offers: unknown[] }).offers).toHaveLength(0);
    expect((await fetch(`${baseUrl()}/api/businesses/${ownerlessBusiness.id}`)).status).toBe(404);
    expect((await fetch(`${baseUrl()}/api/businesses/${ownerlessBusiness.id}/rules`)).status).toBe(404);
    expect((await fetch(`${baseUrl()}/api/businesses/${ownerlessBusiness.id}/products`)).status).toBe(404);

    const catalogIndexResponse = await fetch(`${baseUrl()}/api/businesses/catalog-index`);
    expect(catalogIndexResponse.status).toBe(200);
    expect(catalogIndexResponse.headers.get('cache-control')).toContain('public, max-age=300');
    const catalogIndex = await catalogIndexResponse.json() as {
      catalogs: Array<{ businessId: string; lastModified: string }>;
      truncated: boolean;
      urlLimit: number;
    };
    expect(catalogIndex.catalogs.map((catalog) => catalog.businessId)).toEqual([businessId, otherBusinessId].sort());
    expect(catalogIndex.catalogs.every((catalog) => Number.isFinite(Date.parse(catalog.lastModified)))).toBe(true);
    expect(catalogIndex.truncated).toBe(false);
    expect(catalogIndex.urlLimit).toBe(50_000);
    expect(JSON.stringify(catalogIndex)).not.toMatch(/ownerAddress|wallet|description|website|discount/i);

    expect((await fetch(`${baseUrl()}/api/businesses?page=0`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/businesses?limit=25`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/businesses?query=${'x'.repeat(81)}`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/businesses?serviceArea=${'x'.repeat(81)}`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/businesses?serviceArea=one&serviceArea=two`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/businesses?query=one&query=two`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/businesses?businessId=bad%20id`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/businesses?businessId=${'x'.repeat(81)}`)).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/businesses?businessId=one&businessId=two`)).status).toBe(400);
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
      data: {
        businessId,
        ...productPayload(),
        basePriceMinor: '1999',
        currency: 'USD',
      },
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
      body: JSON.stringify({
        ...rulePayload(product.id),
        lockSource: 'commitment_time_only',
      }),
    });
    expect(createdResponse.status).toBe(201);
    const rule = await createdResponse.json() as {
      id: string;
      productId: string;
      productName: string;
      category: string;
      lockSource: string;
    };
    expect(rule).toMatchObject({
      productId: product.id,
      productName: 'Premium espresso',
      category: 'Coffee',
      minIFRHeld: 250,
      lockSource: 'commitment_time_only',
    });
    const invalidSourceHeaders = await sellerHeaders(owner, 'rules:create', businessId);
    expect((await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/rules`, {
      method: 'POST',
      headers: invalidSourceHeaders,
      body: JSON.stringify({ ...rulePayload(product.id), lockSource: 'price_only' }),
    })).status).toBe(400);
    expect((await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/rules`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify(rulePayload(product.id)),
    })).status).toBe(401);

    const session = await createSession(businessId, rule.id);
    expect(await buildChallengeMessage(session.sessionId)).toContain('Product: Premium espresso');
    expect(await buildChallengeMessage(session.sessionId)).toContain('Reference Price: USD 1999 minor units');
    expect(await buildChallengeMessage(session.sessionId)).toContain('Lock Source: commitment_time_only');
    expect(await buildChallengeMessage(session.sessionId)).toContain('Action: Verify IFR Benefit Eligibility');

    const productUpdateHeaders = await sellerHeaders(owner, 'products:update', businessId, product.id);
    const updateResponse = await fetch(`${baseUrl()}/api/seller/products/${product.id}`, {
      method: 'PATCH',
      headers: productUpdateHeaders,
      body: JSON.stringify({
        name: 'Reserve espresso',
        category: 'Drinks',
        basePriceMinor: '2499',
        currency: 'USD',
      }),
    });
    expect(updateResponse.status).toBe(200);

    const storedSnapshot = await prisma.benefitRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(storedSnapshot.productName).toBe('Premium espresso');
    expect(await buildChallengeMessage(session.sessionId)).toContain('Product: Premium espresso');

    const refreshHeaders = await sellerHeaders(owner, 'rules:update', businessId, rule.id);
    const refreshResponse = await fetch(`${baseUrl()}/api/seller/rules/${rule.id}`, {
      method: 'PATCH',
      headers: refreshHeaders,
      body: JSON.stringify({
        productId: product.id,
        discountPercent: 30,
        requiredLockIFR: 5000,
        minIFRHeld: 500,
        lockSource: 'either',
      }),
    });
    expect(refreshResponse.status).toBe(200);
    expect(await refreshResponse.json()).toMatchObject({
      productName: 'Reserve espresso',
      category: 'Drinks',
      discountPercent: 30,
      requiredLockIFR: 5000,
      minIFRHeld: 500,
      lockSource: 'either',
    });
    expect(await buildChallengeMessage(session.sessionId)).toContain('Product: Premium espresso');
    expect(await buildChallengeMessage(session.sessionId)).toContain('Required Lock IFR: 1000');
    expect(await buildChallengeMessage(session.sessionId)).toContain('Minimum Held IFR: 250');
    expect(await buildChallengeMessage(session.sessionId)).toContain('Lock Source: commitment_time_only');
    const oldSessionStatus = await fetch(`${baseUrl()}/api/sessions/${session.sessionId}`);
    expect(await oldSessionStatus.json()).toMatchObject({
      benefit: {
        productName: 'Premium espresso',
        basePriceMinor: '1999',
        currency: 'USD',
        discountPercent: 20,
        requiredLockIFR: 1000,
        minIFRHeld: 250,
        lockSource: 'commitment_time_only',
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
      basePriceMinor: '1999',
      currency: 'USD',
      discountPercent: 20,
      requiredLockIFR: 1000,
      minIFRHeld: 250,
      lockSource: 'commitment_time_only',
      dailyRedemptionLimit: 1,
      monthlyRedemptionLimit: 10,
    });
    mockRecoverSigner.mockReturnValue(owner.address);
    mockCheckBenefitEligibility.mockResolvedValue({
      eligible: true,
      lockEligible: true,
      heldEligible: true,
      lockedAmount: '1000.0',
      walletAmount: '250.0',
      walletBalanceRaw: '250000000000',
      ifrLockAmount: null,
      commitmentAmount: '1000.0',
      verifiedLockSource: 'commitment_time_only',
      verificationBlock: 123,
    });
    await expect(attest(session.sessionId, '0xsnapshot-signature')).resolves.toMatchObject({
      status: 'APPROVED',
    });
    expect(mockCheckBenefitEligibility).toHaveBeenCalledWith(
      owner.address,
      1000,
      250,
      'commitment_time_only'
    );

    const refreshedSession = await createSession(businessId, rule.id);
    expect(await buildChallengeMessage(refreshedSession.sessionId)).toContain('Product: Reserve espresso');
    expect(await buildChallengeMessage(refreshedSession.sessionId)).toContain('Reference Price: USD 2499 minor units');
    expect(await buildChallengeMessage(refreshedSession.sessionId)).toContain('Required Lock IFR: 5000');
    expect(await buildChallengeMessage(refreshedSession.sessionId)).toContain('Minimum Held IFR: 500');
    expect(await buildChallengeMessage(refreshedSession.sessionId)).toContain('Lock Source: either');
    await prisma.session.update({
      where: { id: refreshedSession.sessionId },
      data: { benefitBasePriceMinor: '0', benefitCurrency: 'EUR' },
    });
    expect(await buildChallengeMessage(refreshedSession.sessionId))
      .toContain('Reference Price: EUR 0 minor units');
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
      benefitSnapshotVersion: 5,
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
        nonce: ethers.hexlify(ethers.randomBytes(32)).slice(2),
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
      minIFRHeld: 0,
    });
  });

  it('never applies a new held-IFR rule to legacy v0-v3 sessions', async () => {
    const rule = await prisma.benefitRule.create({
      data: {
        businessId,
        label: 'Legacy lock-only benefit',
        category: 'Legacy category',
        productName: 'Legacy member service',
        discountPercent: 9,
        requiredLockIFR: 900,
      },
    });
    const legacySessions = await Promise.all([0, 1, 2, 3].map((version) => prisma.session.create({
      data: {
        businessId,
        benefitRuleId: rule.id,
        benefitSnapshotVersion: version === 0 ? null : version,
        ...(version > 0
          ? {
              benefitLabel: 'Legacy lock-only benefit',
              benefitCategory: 'Legacy category',
              benefitProductName: 'Legacy member service',
              benefitDiscountPercent: 9,
              benefitRequiredLockIFR: 900,
              benefitTtlSeconds: 90,
            }
          : {}),
        nonce: ethers.hexlify(ethers.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 60_000),
      },
    })));
    await prisma.benefitRule.update({
      where: { id: rule.id },
      data: { minIFRHeld: 500 },
    });

    mockRecoverSigner.mockReturnValue(owner.address);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '900.0' });
    for (const session of legacySessions) {
      const challenge = await buildChallengeMessage(session.id);
      expect(challenge).toContain('Minimum Held IFR: 0');
      expect(challenge).not.toContain('Lock Source:');
      expect(challenge).toContain('Action: Verify IFR Lock Eligibility');
      expect(challenge).not.toContain('Action: Verify IFR Benefit Eligibility');
      const statusResponse = await fetch(`${baseUrl()}/api/sessions/${session.id}`);
      expect(await statusResponse.json()).toMatchObject({
        benefit: { minIFRHeld: 0, lockSource: 'ifrlock' },
      });
      await expect(attest(session.id, '0xlegacy-signature')).resolves.toMatchObject({
        status: 'APPROVED',
        benefit: { minIFRHeld: 0 },
      });
    }

    expect(mockCheckBenefitEligibility).toHaveBeenCalledTimes(legacySessions.length);
    expect(mockCheckBenefitEligibility).toHaveBeenCalledWith(owner.address, 900, 0, 'ifrlock');
    const historyHeaders = await sellerHeaders(owner, 'sessions:list', businessId);
    const historyResponse = await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/sessions`, {
      headers: historyHeaders,
    });
    const history = await historyResponse.json() as { sessions: Array<Record<string, unknown>> };
    for (const session of legacySessions) {
      expect(history.sessions.find((item) => item.id === session.id)).toMatchObject({
        minIFRHeld: 0,
        lockSource: 'ifrlock',
      });
    }
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
        benefitSnapshotVersion: 5,
        benefitProductName: 'Premium espresso',
      });
      expect(archivedProduct.active).toBe(false);
      expect(archivedRule.active).toBe(false);
    }
    await expect(createSession(businessId, rule.id)).rejects.toThrow('not found or inactive');
  });
});
