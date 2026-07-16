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

describe('Redeem route authorization', () => {
  const seller = ethers.Wallet.createRandom();
  const otherSeller = ethers.Wallet.createRandom();
  let businessId: string;
  let approvedSessionId: string;

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.benefitRule.deleteMany();
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
