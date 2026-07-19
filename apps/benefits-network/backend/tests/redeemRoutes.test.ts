import { ethers } from 'ethers';
import * as authenticatedRateLimiter from '../src/services/authenticatedRateLimiter';

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
import { app, server } from '../src/index';

function baseUrl() {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not bind to a TCP port');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function sellerHeaders(
  wallet: ethers.Wallet,
  action: string,
  businessId: string,
  scope?: string
): Promise<Record<string, string>> {
  const mutations = new Set([
    'business:create', 'business:delete', 'operators:create', 'operators:delete',
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

async function postRedeem(sessionId: string, headers?: Record<string, string>) {
  return fetch(`${baseUrl()}/api/sessions/${sessionId}/redeem`, {
    method: 'POST',
    headers: headers ?? { 'content-type': 'application/json' },
  });
}

async function postCreateSession(
  businessId: string,
  headers?: Record<string, string>,
  benefitRuleId?: string
) {
  return fetch(`${baseUrl()}/api/sessions`, {
    method: 'POST',
    headers: headers ?? { 'content-type': 'application/json' },
    body: JSON.stringify({ businessId, benefitRuleId }),
  });
}

async function getSellerSessions(
  businessId: string,
  headers?: Record<string, string>,
  query?: { limit?: number; cursor?: string; snapshot?: string }
) {
  const search = new URLSearchParams();
  if (query?.limit !== undefined) search.set('limit', String(query.limit));
  if (query?.cursor) search.set('cursor', query.cursor);
  if (query?.snapshot) search.set('snapshot', query.snapshot);
  return fetch(`${baseUrl()}/api/seller/businesses/${businessId}/sessions${search.size ? `?${search}` : ''}`, {
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
  let sellerWalletLimiterSpy: jest.SpyInstance;
  let businessId: string;
  let approvedSessionId: string;

  beforeEach(async () => {
    sellerWalletLimiterSpy = jest
      .spyOn(authenticatedRateLimiter, 'assertSellerWalletActionAllowed')
      .mockImplementation(() => undefined);
    await prisma.sellerAuthorizationChallenge.deleteMany();
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

  afterEach(() => {
    sellerWalletLimiterSpy.mockRestore();
  });

  afterAll(async () => {
    await prisma.sellerAuthorizationChallenge.deleteMany();
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

  it('requires a current owner or operator signature before creating a QR session', async () => {
    const initialCount = await prisma.session.count({ where: { businessId } });

    expect((await postCreateSession(businessId)).status).toBe(401);
    expect((await postCreateSession(
      businessId,
      await sellerHeaders(otherSeller, 'sessions:create', businessId)
    )).status).toBe(403);
    expect(await prisma.session.count({ where: { businessId } })).toBe(initialCount);

    const ownerResponse = await postCreateSession(
      businessId,
      await sellerHeaders(seller, 'sessions:create', businessId)
    );
    const ownerBody = await ownerResponse.json() as {
      sessionId: string;
      createdBy: { authorized: boolean; walletAddress: string; role: string };
    };
    expect(ownerResponse.status).toBe(201);
    expect(ownerBody.createdBy).toMatchObject({
      authorized: true,
      walletAddress: seller.address,
      role: 'OWNER',
    });
    const ownerAudit = await prisma.auditLog.findFirstOrThrow({
      where: { sessionId: ownerBody.sessionId, type: 'SESSION_CREATED' },
    });
    expect(JSON.parse(ownerAudit.payload)).toMatchObject({
      createdBy: { walletAddress: seller.address, role: 'OWNER', operatorId: null },
    });

    await prisma.checkoutOperator.create({
      data: { businessId, walletAddress: checkoutOperator.address, label: 'Counter tablet' },
    });
    const operatorResponse = await postCreateSession(
      businessId,
      await sellerHeaders(checkoutOperator, 'sessions:create', businessId)
    );
    const operatorBody = await operatorResponse.json() as {
      createdBy: { authorized: boolean; walletAddress: string; role: string; label: string };
    };
    expect(operatorResponse.status).toBe(201);
    expect(operatorBody.createdBy).toMatchObject({
      authorized: true,
      walletAddress: checkoutOperator.address,
      role: 'OPERATOR',
      label: 'Counter tablet',
    });
  });

  it('consumes a rule-bound session authorization exactly once', async () => {
    const rule = await prisma.benefitRule.create({
      data: {
        businessId,
        label: 'Replay-safe rule',
        category: 'Retail',
        productName: 'Replay-safe item',
        discountPercent: 10,
        requiredLockIFR: 1000,
        ttlSeconds: 120,
      },
    });
    const otherRule = await prisma.benefitRule.create({
      data: {
        businessId,
        label: 'Other rule',
        category: 'Retail',
        productName: 'Other item',
        discountPercent: 20,
        requiredLockIFR: 2000,
        ttlSeconds: 120,
      },
    });
    const headers = await sellerHeaders(seller, 'sessions:create', businessId, rule.id);

    expect((await postCreateSession(businessId, headers, otherRule.id)).status).toBe(401);
    expect((await postCreateSession(businessId, headers, rule.id)).status).toBe(201);
    expect((await postCreateSession(businessId, headers, rule.id)).status).toBe(401);
    expect(await prisma.session.count({ where: { businessId, benefitRuleId: rule.id } })).toBe(1);
  });

  it('rechecks operator access atomically when consuming the session challenge', async () => {
    const initialCount = await prisma.session.count({ where: { businessId } });
    const operator = await prisma.checkoutOperator.create({
      data: { businessId, walletAddress: checkoutOperator.address, label: 'Revoked counter' },
    });
    const headers = await sellerHeaders(checkoutOperator, 'sessions:create', businessId);
    await prisma.checkoutOperator.update({
      where: { id: operator.id },
      data: { active: false },
    });

    expect((await postCreateSession(businessId, headers)).status).toBe(403);
    expect(await prisma.session.count({ where: { businessId } })).toBe(initialCount);
  });

  it('returns authentication errors and authenticated limits without HTTP 500', async () => {
    const malformed = await postCreateSession(businessId, {
      'content-type': 'application/json',
      'x-ifr-wallet': seller.address,
      'x-ifr-signature': '0x00',
      'x-ifr-timestamp': 'not-a-time',
      'x-ifr-nonce': 'missing',
    });
    expect(malformed.status).toBe(401);

    sellerWalletLimiterSpy.mockImplementationOnce(() => {
      throw new authenticatedRateLimiter.AuthenticatedRateLimitError(42);
    });
    const limited = await postCreateSession(
      businessId,
      await sellerHeaders(seller, 'sessions:create', businessId)
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('42');
  });

  it('trusts private proxy hops but not public client addresses', () => {
    const trustProxy = app.get('trust proxy fn') as (address: string, hop: number) => boolean;
    expect(trustProxy('127.0.0.1', 0)).toBe(true);
    expect(trustProxy('172.27.0.6', 1)).toBe(true);
    expect(trustProxy('8.8.8.8', 2)).toBe(false);
  });

  it('charges the wallet limiter only after a valid signature recovers the claimed seller', async () => {
    sellerWalletLimiterSpy.mockClear();
    const query = new URLSearchParams({
      action: 'sessions:create',
      businessId,
      walletAddress: seller.address,
      scope: 'default',
    });
    const challenge = await (
      await fetch(`${baseUrl()}/api/seller/auth-message?${query}`)
    ).json() as { message: string; timestamp: string; nonce: string };
    const forgedHeaders = {
      'content-type': 'application/json',
      'x-ifr-wallet': seller.address,
      'x-ifr-signature': await otherSeller.signMessage(challenge.message),
      'x-ifr-timestamp': challenge.timestamp,
      'x-ifr-nonce': challenge.nonce,
    };

    expect((await postCreateSession(businessId, forgedHeaders)).status).toBe(401);
    expect(sellerWalletLimiterSpy).not.toHaveBeenCalled();

    expect((await postCreateSession(
      businessId,
      await sellerHeaders(seller, 'sessions:create', businessId)
    )).status).toBe(201);
    expect(sellerWalletLimiterSpy).toHaveBeenCalledTimes(1);
    expect(sellerWalletLimiterSpy).toHaveBeenCalledWith(seller.address);
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
    expect(secondResponse.status).toBe(401);
  });

  it('returns 429 and audits a per-wallet daily redemption limit', async () => {
    const customer = ethers.Wallet.createRandom().address;
    const rule = await prisma.benefitRule.create({
      data: {
        businessId,
        label: 'One per day',
        category: 'Retail',
        productName: 'Daily benefit',
        discountPercent: 10,
        requiredLockIFR: 1000,
        dailyRedemptionLimit: 1,
      },
    });
    const sessions = await Promise.all([0, 1].map(() => prisma.session.create({
      data: {
        businessId,
        benefitRuleId: rule.id,
        benefitSnapshotVersion: 2,
        benefitDailyRedemptionLimit: 1,
        benefitMonthlyRedemptionLimit: 0,
        nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 300_000),
        status: 'APPROVED',
        recoveredAddress: customer,
      },
    })));

    const firstHeaders = await sellerHeaders(seller, 'sessions:redeem', sessions[0].id);
    expect((await postRedeem(sessions[0].id, firstHeaders)).status).toBe(200);
    const secondHeaders = await sellerHeaders(seller, 'sessions:redeem', sessions[1].id);
    const denied = await postRedeem(sessions[1].id, secondHeaders);
    const body = await denied.json() as { error: string };

    expect(denied.status).toBe(429);
    expect(body.error).toContain('Daily redemption limit reached');
    expect(await prisma.session.findUniqueOrThrow({ where: { id: sessions[1].id } })).toMatchObject({
      status: 'REJECTED',
      reason: expect.stringContaining('Daily redemption limit reached'),
    });
    expect(await prisma.auditLog.count({
      where: { sessionId: sessions[1].id, type: 'REDEEM_DENIED_LIMIT' },
    })).toBe(1);
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
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
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
    const reactivatedHeaders = await sellerHeaders(
      checkoutOperator,
      'sessions:redeem',
      approvedSessionId
    );
    expect((await postRedeem(approvedSessionId, reactivatedHeaders)).status).toBe(200);

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

    const operatorScope = payload.walletAddress.toLowerCase();
    const outsiderCreateHeaders = await sellerHeaders(
      otherSeller,
      'operators:create',
      businessId,
      operatorScope
    );
    expect((await postCheckoutOperator(businessId, payload, outsiderCreateHeaders)).status).toBe(403);

    const ownerCreateHeaders = await sellerHeaders(seller, 'operators:create', businessId, operatorScope);
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

    const operatorDeleteHeaders = await sellerHeaders(
      checkoutOperator,
      'operators:delete',
      businessId,
      created.id
    );
    expect((await deleteCheckoutOperator(created.id, operatorDeleteHeaders)).status).toBe(403);

    const ownerDeleteHeaders = await sellerHeaders(seller, 'operators:delete', businessId, created.id);
    expect((await deleteCheckoutOperator(created.id, ownerDeleteHeaders)).status).toBe(204);
    const revokedStatusHeaders = await sellerHeaders(checkoutOperator, 'operators:status', businessId);
    expect((await getCheckoutOperatorStatus(businessId, revokedStatusHeaders)).status).toBe(403);

    expect((await postCheckoutOperator(businessId, payload, ownerCreateHeaders)).status).toBe(401);
    const freshCreateHeaders = await sellerHeaders(seller, 'operators:create', businessId, operatorScope);
    expect((await postCheckoutOperator(businessId, payload, freshCreateHeaders)).status).toBe(200);
    expect((await deleteCheckoutOperator(created.id, ownerDeleteHeaders)).status).toBe(401);
  }, 30_000);

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
    for (let index = 0; index < 10; index += 1) {
      const counterWallet = ethers.Wallet.createRandom().address;
      const ownerHeaders = await sellerHeaders(
        seller,
        'operators:create',
        businessId,
        counterWallet.toLowerCase()
      );
      const response = await postCheckoutOperator(businessId, {
        walletAddress: counterWallet,
        label: `Counter ${index + 1}`,
      }, ownerHeaders);
      expect(response.status).toBe(201);
    }

    const reactivateHeaders = await sellerHeaders(
      seller,
      'operators:create',
      businessId,
      expiredWallet.toLowerCase()
    );
    const reactivate = await postCheckoutOperator(businessId, {
      walletAddress: expiredWallet,
      label: 'Expired counter',
      expiresAt: null,
    }, reactivateHeaders);
    expect(reactivate.status).toBe(429);
  }, 45_000);

  it('never exceeds the checkout operator cap under concurrent owner requests', async () => {
    await prisma.checkoutOperator.createMany({
      data: Array.from({ length: 9 }, (_, index) => ({
        businessId,
        walletAddress: ethers.Wallet.createRandom().address,
        label: `Existing counter ${index + 1}`,
      })),
    });

    const walletA = ethers.Wallet.createRandom().address;
    const walletB = ethers.Wallet.createRandom().address;
    const [headersA, headersB] = await Promise.all([
      sellerHeaders(seller, 'operators:create', businessId, walletA.toLowerCase()),
      sellerHeaders(seller, 'operators:create', businessId, walletB.toLowerCase()),
    ]);
    const responses = await Promise.all([
      postCheckoutOperator(businessId, {
        walletAddress: walletA,
        label: 'Concurrent counter A',
      }, headersA),
      postCheckoutOperator(businessId, {
        walletAddress: walletB,
        label: 'Concurrent counter B',
      }, headersB),
    ]);

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
    expect(await prisma.checkoutOperator.count({
      where: { businessId, active: true },
    })).toBe(10);
  }, 45_000);

  it('serializes concurrent operator reactivation and revocation', async () => {
    const operator = await prisma.checkoutOperator.create({
      data: {
        businessId,
        walletAddress: checkoutOperator.address,
        label: 'Concurrent counter',
        active: true,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const createHeaders = await sellerHeaders(
      seller,
      'operators:create',
      businessId,
      checkoutOperator.address.toLowerCase()
    );
    const deleteHeaders = await sellerHeaders(seller, 'operators:delete', businessId, operator.id);

    const [createResponse, deleteResponse] = await Promise.all([
      postCheckoutOperator(businessId, {
        walletAddress: checkoutOperator.address,
        label: 'Concurrent counter updated',
      }, createHeaders),
      deleteCheckoutOperator(operator.id, deleteHeaders),
    ]);

    const statuses = [createResponse.status, deleteResponse.status];
    expect(statuses.filter((status) => status === 401)).toHaveLength(1);
    expect([200, 204]).toContain(statuses.find((status) => status !== 401));
    const stored = await prisma.checkoutOperator.findUniqueOrThrow({ where: { id: operator.id } });
    expect(stored.active).toBe(createResponse.status === 200);
  }, 45_000);

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

  it('paginates seller history without duplicates and rejects foreign or invalid cursors', async () => {
    const createdAtBase = Date.now() - 60_000;
    await prisma.session.createMany({
      data: Array.from({ length: 4 }, (_, index) => ({
        businessId,
        nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 300_000),
        createdAt: new Date(createdAtBase + index * 1000),
        status: 'PENDING',
      })),
    });
    const expected = await prisma.session.findMany({
      where: { businessId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    const headers = await sellerHeaders(seller, 'sessions:list', businessId);
    const collected: string[] = [];
    let cursor: string | undefined;
    let snapshot: string | undefined;
    let insertedAfterSnapshot = false;

    do {
      const response = await getSellerSessions(businessId, headers, { limit: 2, cursor, snapshot });
      expect(response.status).toBe(200);
      const page = await response.json() as {
        sessions: Array<{ id: string }>;
        pagination: { limit: number; hasMore: boolean; nextCursor: string | null; snapshot: string };
      };
      expect(page.sessions.length).toBeLessThanOrEqual(2);
      expect(page.pagination.limit).toBe(2);
      collected.push(...page.sessions.map((session) => session.id));
      cursor = page.pagination.nextCursor ?? undefined;
      snapshot = page.pagination.snapshot;
      expect(Number.isNaN(new Date(snapshot).getTime())).toBe(false);
      if (!insertedAfterSnapshot) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await prisma.session.create({
          data: {
            businessId,
            nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
            expiresAt: new Date(Date.now() + 300_000),
            status: 'PENDING',
          },
        });
        insertedAfterSnapshot = true;
      }
      if (!page.pagination.hasMore) expect(cursor).toBeUndefined();
    } while (cursor);

    expect(collected).toEqual(expected.map((session) => session.id));
    expect(new Set(collected).size).toBe(collected.length);

    const otherBusiness = await prisma.business.create({
      data: {
        name: 'Other seller cursor',
        ownerAddress: seller.address,
        discountPercent: 10,
        requiredLockIFR: 1000,
      },
    });
    const foreignSession = await prisma.session.create({
      data: {
        businessId: otherBusiness.id,
        nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 300_000),
      },
    });
    expect((await getSellerSessions(businessId, headers, { cursor: foreignSession.id })).status).toBe(400);
    expect((await getSellerSessions(businessId, headers, { limit: 51 })).status).toBe(400);
    expect((await getSellerSessions(businessId, headers, { snapshot: 'not-a-date' })).status).toBe(400);
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
      dailyRedemptionLimit: 2,
      monthlyRedemptionLimit: 12,
    };

    const missingAuth = await patchSellerRule(rule.id, payload);
    expect(missingAuth.status).toBe(401);

    const wrongHeaders = await sellerHeaders(otherSeller, 'rules:update', businessId, rule.id);
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

    const wrongBusinessHeaders = await sellerHeaders(seller, 'rules:update', businessId, otherRule.id);
    const wrongBusiness = await patchSellerRule(otherRule.id, payload, wrongBusinessHeaders);
    expect(wrongBusiness.status).toBe(401);

    const nonOwnerHeaders = await sellerHeaders(seller, 'rules:update', otherBusiness.id, otherRule.id);
    const nonOwner = await patchSellerRule(otherRule.id, payload, nonOwnerHeaders);
    expect(nonOwner.status).toBe(403);

    const ownerHeaders = await sellerHeaders(seller, 'rules:update', businessId, rule.id);
    const response = await patchSellerRule(rule.id, payload, ownerHeaders);
    const body = await response.json() as {
      label: string;
      productName: string;
      discountPercent: number;
      requiredLockIFR: number;
      ttlSeconds: number;
      dailyRedemptionLimit: number;
      monthlyRedemptionLimit: number;
      active: boolean;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ...payload, active: false });
  });
});
