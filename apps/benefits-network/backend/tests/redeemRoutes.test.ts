import { ethers } from 'ethers';
import { buildSellerAuthMessage } from '../src/services/sellerAuth';

jest.mock('../src/services/ifrLockService', () => ({
  checkLock: jest.fn(),
  recoverSigner: jest.fn(),
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

import { prisma } from '../src/services/sessionService';
import { server } from '../src/index';

function baseUrl() {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not bind to a TCP port');
  }
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

async function postRedeem(sessionId: string, headers?: Record<string, string>) {
  return fetch(`${baseUrl()}/api/sessions/${sessionId}/redeem`, {
    method: 'POST',
    headers: headers ?? { 'content-type': 'application/json' },
  });
}

async function getSellerSessions(businessId: string, headers?: Record<string, string>) {
  return fetch(`${baseUrl()}/api/seller/businesses/${businessId}/sessions`, {
    headers: headers ?? { 'content-type': 'application/json' },
  });
}

async function patchSellerRule(
  ruleId: string,
  payload: Record<string, unknown>,
  headers?: Record<string, string>
) {
  return fetch(`${baseUrl()}/api/seller/rules/${ruleId}`, {
    method: 'PATCH',
    headers: headers ?? { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function postCheckoutOperator(
  businessId: string,
  payload: Record<string, unknown>,
  headers?: Record<string, string>
) {
  return fetch(`${baseUrl()}/api/seller/businesses/${businessId}/operators`, {
    method: 'POST',
    headers: headers ?? { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function getCheckoutOperators(businessId: string, headers?: Record<string, string>) {
  return fetch(`${baseUrl()}/api/seller/businesses/${businessId}/operators`, {
    headers: headers ?? { 'content-type': 'application/json' },
  });
}

async function getCheckoutOperatorStatus(businessId: string, headers?: Record<string, string>) {
  return fetch(`${baseUrl()}/api/seller/businesses/${businessId}/operator-status`, {
    headers: headers ?? { 'content-type': 'application/json' },
  });
}

async function deleteCheckoutOperator(operatorId: string, headers?: Record<string, string>) {
  return fetch(`${baseUrl()}/api/seller/operators/${operatorId}`, {
    method: 'DELETE',
    headers: headers ?? { 'content-type': 'application/json' },
  });
}

describe('Redeem route authorization', () => {
  const seller = ethers.Wallet.createRandom();
  const otherSeller = ethers.Wallet.createRandom();
  const checkoutOperator = ethers.Wallet.createRandom();
  let businessId: string;
  let approvedSessionId: string;

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.benefitRule.deleteMany();
    await prisma.product.deleteMany();
    await prisma.checkoutOperator.deleteMany();
    await prisma.business.deleteMany();

    const business = await prisma.business.create({
      data: {
        name: 'HTTP Redeem Test Seller',
        ownerAddress: seller.address,
        discountPercent: 15,
        requiredLockIFR: 1000,
        ttlSeconds: 300,
        tierLabel: 'HTTP',
      },
    });
    businessId = business.id;

    const session = await prisma.session.create({
      data: {
        businessId: business.id,
        nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 300_000),
        status: 'APPROVED',
        recoveredAddress: ethers.Wallet.createRandom().address,
        lockAmountRaw: '2500.0',
      },
    });
    approvedSessionId = session.id;
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
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  it('rejects redeem without seller authorization headers', async () => {
    const response = await postRedeem(approvedSessionId);

    expect(response.status).toBe(401);
  });

  it('rejects redeem when the signer is not the seller business owner', async () => {
    const headers = await sellerHeaders(otherSeller, 'sessions:redeem', approvedSessionId);

    const response = await postRedeem(approvedSessionId, headers);

    expect(response.status).toBe(403);
  });

  it('allows the owning seller wallet to redeem an approved session exactly once', async () => {
    const headers = await sellerHeaders(seller, 'sessions:redeem', approvedSessionId);

    const response = await postRedeem(approvedSessionId, headers);
    const body = await response.json() as { status: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 'REDEEMED' });

    const secondResponse = await postRedeem(approvedSessionId, headers);
    expect(secondResponse.status).toBe(409);
  });

  it('allows an active checkout operator to redeem and records the actor without a signature', async () => {
    const operator = await prisma.checkoutOperator.create({
      data: {
        businessId,
        walletAddress: checkoutOperator.address,
        label: 'Front counter',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const headers = await sellerHeaders(checkoutOperator, 'sessions:redeem', approvedSessionId);

    const response = await postRedeem(approvedSessionId, headers);
    expect(response.status).toBe(200);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { sessionId: approvedSessionId, type: 'REDEEMED' },
    });
    const payload = JSON.parse(audit.payload) as Record<string, unknown>;
    expect(payload).toMatchObject({
      actorWallet: checkoutOperator.address,
      actorRole: 'OPERATOR',
      operatorId: operator.id,
    });
    expect(JSON.stringify(payload)).not.toContain(headers['x-ifr-signature']);
  });

  it('allows only one HTTP redemption when signed owner requests race', async () => {
    const headers = await sellerHeaders(seller, 'sessions:redeem', approvedSessionId);
    const responses = await Promise.all([
      postRedeem(approvedSessionId, headers),
      postRedeem(approvedSessionId, headers),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.auditLog.count({
      where: { sessionId: approvedSessionId, type: 'REDEEMED' },
    })).toBe(1);
  });

  it('rejects expired and revoked checkout operators immediately', async () => {
    const expired = await prisma.checkoutOperator.create({
      data: {
        businessId,
        walletAddress: checkoutOperator.address,
        expiresAt: new Date(Date.now() - 1),
      },
    });
    const headers = await sellerHeaders(checkoutOperator, 'sessions:redeem', approvedSessionId);
    expect((await postRedeem(approvedSessionId, headers)).status).toBe(403);

    await prisma.checkoutOperator.update({
      where: { id: expired.id },
      data: { active: true, expiresAt: null },
    });
    expect((await postRedeem(approvedSessionId, headers)).status).toBe(200);

    const nextSession = await prisma.session.create({
      data: {
        businessId,
        nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 300_000),
        status: 'APPROVED',
        recoveredAddress: ethers.Wallet.createRandom().address,
      },
    });
    await prisma.checkoutOperator.update({ where: { id: expired.id }, data: { active: false } });
    const revokedHeaders = await sellerHeaders(checkoutOperator, 'sessions:redeem', nextSession.id);
    expect((await postRedeem(nextSession.id, revokedHeaders)).status).toBe(403);
  });

  it('lets only the business owner manage checkout operators and keeps operator privileges narrow', async () => {
    const payload = {
      walletAddress: checkoutOperator.address,
      label: 'Evening shift',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    expect((await postCheckoutOperator(businessId, payload)).status).toBe(401);

    const outsiderCreateHeaders = await sellerHeaders(otherSeller, 'operators:create', businessId);
    expect((await postCheckoutOperator(businessId, payload, outsiderCreateHeaders)).status).toBe(403);

    const ownerCreateHeaders = await sellerHeaders(seller, 'operators:create', businessId);
    const createdResponse = await postCheckoutOperator(businessId, payload, ownerCreateHeaders);
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { id: string; active: boolean; walletAddress: string };
    expect(created).toMatchObject({ active: true, walletAddress: checkoutOperator.address });

    const ownerListHeaders = await sellerHeaders(seller, 'operators:list', businessId);
    const listResponse = await getCheckoutOperators(businessId, ownerListHeaders);
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json() as { operators: unknown[] }).operators).toHaveLength(1);

    const operatorListHeaders = await sellerHeaders(checkoutOperator, 'operators:list', businessId);
    expect((await getCheckoutOperators(businessId, operatorListHeaders)).status).toBe(403);
    const operatorHistoryHeaders = await sellerHeaders(checkoutOperator, 'sessions:list', businessId);
    expect((await getSellerSessions(businessId, operatorHistoryHeaders)).status).toBe(403);

    const operatorStatusHeaders = await sellerHeaders(checkoutOperator, 'operators:status', businessId);
    const statusResponse = await getCheckoutOperatorStatus(businessId, operatorStatusHeaders);
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({
      authorized: true,
      role: 'OPERATOR',
      walletAddress: checkoutOperator.address,
      label: 'Evening shift',
    });

    const operatorDeleteHeaders = await sellerHeaders(checkoutOperator, 'operators:delete', businessId);
    expect((await deleteCheckoutOperator(created.id, operatorDeleteHeaders)).status).toBe(403);

    const ownerDeleteHeaders = await sellerHeaders(seller, 'operators:delete', businessId);
    expect((await deleteCheckoutOperator(created.id, ownerDeleteHeaders)).status).toBe(204);
    const revokedStatusHeaders = await sellerHeaders(checkoutOperator, 'operators:status', businessId);
    expect((await getCheckoutOperatorStatus(businessId, revokedStatusHeaders)).status).toBe(403);

    expect((await postCheckoutOperator(businessId, payload, ownerCreateHeaders)).status).toBe(401);
    const freshCreateHeaders = await sellerHeaders(seller, 'operators:create', businessId);
    expect((await postCheckoutOperator(businessId, payload, freshCreateHeaders)).status).toBe(200);
    expect((await deleteCheckoutOperator(created.id, ownerDeleteHeaders)).status).toBe(401);
  });

  it('enforces the active checkout operator cap when reactivating an expired record', async () => {
    const expiredWallet = ethers.Wallet.createRandom().address;
    await prisma.checkoutOperator.create({
      data: {
        businessId,
        walletAddress: expiredWallet,
        active: true,
        expiresAt: new Date(Date.now() - 1),
      },
    });
    const ownerHeaders = await sellerHeaders(seller, 'operators:create', businessId);

    for (let index = 0; index < 10; index += 1) {
      const response = await postCheckoutOperator(businessId, {
        walletAddress: ethers.Wallet.createRandom().address,
        label: `Counter ${index + 1}`,
      }, ownerHeaders);
      expect(response.status).toBe(201);
    }

    const reactivate = await postCheckoutOperator(businessId, {
      walletAddress: expiredWallet,
      label: 'Expired counter',
      expiresAt: null,
    }, ownerHeaders);
    expect(reactivate.status).toBe(429);
  }, 30_000);

  it('never exceeds the checkout operator cap under concurrent owner requests', async () => {
    const ownerHeaders = await sellerHeaders(seller, 'operators:create', businessId);
    await prisma.checkoutOperator.createMany({
      data: Array.from({ length: 9 }, (_, index) => ({
        businessId,
        walletAddress: ethers.Wallet.createRandom().address,
        label: `Existing counter ${index + 1}`,
      })),
    });

    const responses = await Promise.all([
      postCheckoutOperator(businessId, {
        walletAddress: ethers.Wallet.createRandom().address,
        label: 'Concurrent counter A',
      }, ownerHeaders),
      postCheckoutOperator(businessId, {
        walletAddress: ethers.Wallet.createRandom().address,
        label: 'Concurrent counter B',
      }, ownerHeaders),
    ]);

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
    expect(await prisma.checkoutOperator.count({
      where: { businessId, active: true },
    })).toBe(10);
  }, 30_000);

  it('keeps seller activity metrics owner-protected and calculates checkout status totals', async () => {
    const missingAuth = await getSellerSessions(businessId);
    expect(missingAuth.status).toBe(401);

    const wrongHeaders = await sellerHeaders(otherSeller, 'sessions:list', businessId);
    const wrongSeller = await getSellerSessions(businessId, wrongHeaders);
    expect(wrongSeller.status).toBe(403);

    const todayStartedAt = new Date();
    todayStartedAt.setUTCHours(0, 0, 0, 0);

    await prisma.session.createMany({
      data: [
        {
          businessId,
          nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
          expiresAt: new Date(Date.now() + 300_000),
          status: 'REDEEMED',
          recoveredAddress: ethers.Wallet.createRandom().address,
          redeemedAt: new Date(),
        },
        {
          businessId,
          nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
          expiresAt: new Date(Date.now() + 300_000),
          status: 'REJECTED',
        },
        {
          businessId,
          nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
          expiresAt: new Date(Date.now() + 300_000),
          status: 'PENDING',
        },
        {
          businessId,
          nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
          expiresAt: new Date(todayStartedAt.getTime() - 1),
          createdAt: new Date(todayStartedAt.getTime() - 1),
          status: 'REDEEMED',
          recoveredAddress: ethers.Wallet.createRandom().address,
          redeemedAt: new Date(),
        },
        {
          businessId,
          nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
          expiresAt: new Date(Date.now() - 1),
          status: 'EXPIRED',
        },
        {
          businessId,
          nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
          expiresAt: new Date(Date.now() - 1),
          status: 'PENDING',
        },
      ],
    });

    const ownerHeaders = await sellerHeaders(seller, 'sessions:list', businessId);
    const response = await getSellerSessions(businessId, ownerHeaders);
    const body = await response.json() as {
      metrics: {
        today: { checks: number; approved: number; redeemed: number; rejected: number };
        allTime: { checks: number; approved: number; redeemed: number; rejected: number };
        openChecks: number;
        approvalRatePercent: number | null;
      };
      sessions: unknown[];
    };

    expect(response.status).toBe(200);
    expect(body.metrics.today).toMatchObject({ checks: 6, approved: 2, redeemed: 2, rejected: 1 });
    expect(body.metrics.allTime).toMatchObject({ checks: 7, approved: 3, redeemed: 2, rejected: 1 });
    expect(body.metrics.openChecks).toBe(2);
    expect(body.metrics.approvalRatePercent).toBe(75);
    expect(body.sessions).toHaveLength(7);
  }, 15_000);

  it('updates a benefit rule only for its seller owner and preserves paused state', async () => {
    const rule = await prisma.benefitRule.create({
      data: {
        businessId,
        label: 'Original benefit',
        category: 'Retail',
        productName: 'Original product',
        discountPercent: 10,
        requiredLockIFR: 1000,
        ttlSeconds: 90,
        active: false,
      },
    });
    const payload = {
      label: 'Updated benefit',
      category: 'Local services',
      productName: 'Updated service',
      discountPercent: 20,
      requiredLockIFR: 2500,
      ttlSeconds: 180,
    };

    const missingAuth = await patchSellerRule(rule.id, payload);
    expect(missingAuth.status).toBe(401);

    const wrongHeaders = await sellerHeaders(otherSeller, 'rules:update', businessId);
    const wrongSeller = await patchSellerRule(rule.id, payload, wrongHeaders);
    expect(wrongSeller.status).toBe(403);

    const otherBusiness = await prisma.business.create({
      data: {
        name: 'Other seller business',
        ownerAddress: otherSeller.address,
        discountPercent: 5,
        requiredLockIFR: 500,
        ttlSeconds: 120,
      },
    });
    const otherRule = await prisma.benefitRule.create({
      data: {
        businessId: otherBusiness.id,
        label: 'Other rule',
        category: 'Retail',
        productName: 'Other product',
        discountPercent: 5,
        requiredLockIFR: 500,
        ttlSeconds: 120,
      },
    });

    const wrongBusinessHeaders = await sellerHeaders(seller, 'rules:update', businessId);
    const wrongBusiness = await patchSellerRule(otherRule.id, payload, wrongBusinessHeaders);
    expect(wrongBusiness.status).toBe(401);

    const nonOwnerHeaders = await sellerHeaders(seller, 'rules:update', otherBusiness.id);
    const nonOwner = await patchSellerRule(otherRule.id, payload, nonOwnerHeaders);
    expect(nonOwner.status).toBe(403);

    const ownerHeaders = await sellerHeaders(seller, 'rules:update', businessId);
    const response = await patchSellerRule(rule.id, payload, ownerHeaders);
    const body = await response.json() as {
      label: string;
      productName: string;
      discountPercent: number;
      requiredLockIFR: number;
      ttlSeconds: number;
      active: boolean;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ...payload, active: false });
  });
});
