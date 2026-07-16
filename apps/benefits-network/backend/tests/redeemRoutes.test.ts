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

describe('Redeem route authorization', () => {
  const seller = ethers.Wallet.createRandom();
  const otherSeller = ethers.Wallet.createRandom();
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
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 'REDEEMED' });

    const secondResponse = await postRedeem(approvedSessionId, headers);
    expect(secondResponse.status).toBe(409);
  });
});
