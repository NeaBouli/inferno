import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Request, RequestHandler, Response, Router } from 'express';
import { ethers } from 'ethers';

const mockEligibility = vi.hoisted(() => vi.fn());

vi.mock('../src/services/ifrLockService', async () => {
  const actual = await vi.importActual<typeof import('ethers')>('ethers');
  return {
    checkBenefitEligibility: (...args: unknown[]) => mockEligibility(...args),
    recoverSigner: (message: string, signature: string) => actual.verifyMessage(message, signature),
  };
});

vi.mock('../src/config', () => ({
  config: {
    CHAIN_ID: 11155111,
    SELLER_AUTH_DOMAIN: 'shop.example.test',
    RPC_URL: 'https://mock-rpc.example.com',
    IFRLOCK_ADDRESS: '0x0000000000000000000000000000000000000001',
    ADMIN_SECRET: 'test-secret-12345',
  },
}));

import sessionRoutes from '../src/routes/sessions';
import attestRoutes from '../src/routes/attest';
import { attest, buildChallengeMessage, createSession, prisma } from '../src/services/sessionService';
import { createReadOnlyDatabaseAssertion } from './helpers/readOnlyDatabase';

const expectNoDatabaseWrites = createReadOnlyDatabaseAssertion(prisma);

// Invoke the registered controllers with real services and SQLite, without opening a TCP port.
function getController(router: Router, path: string): RequestHandler {
  const route = router.stack.find((layer) =>
    layer.route?.path === path && layer.route.stack.some((handler) => handler.method === 'get')
  )?.route;
  const getLayers = route?.stack.filter((layer) => layer.method === 'get');
  const handler = getLayers?.[getLayers.length - 1]?.handle;
  if (!handler) throw new Error(`GET ${path} is not registered`);
  return handler;
}

const statusGet = getController(sessionRoutes, '/:id');
const challengeGet = getController(attestRoutes, '/sessions/:id/challenge');
const seller = ethers.Wallet.createRandom();
const customer = ethers.Wallet.createRandom();
let businessId: string;

async function readOnlyGet(handler: RequestHandler, sessionId: string, expectedStatus = 200) {
  const response = {
    set: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  await expectNoDatabaseWrites(async () => {
    await handler({ params: { id: sessionId } } as unknown as Request, response as unknown as Response, next);
  });
  expect(next).not.toHaveBeenCalled();
  expect(response.json).toHaveBeenCalledTimes(1);
  if (expectedStatus === 200) expect(response.status).not.toHaveBeenCalled();
  else expect(response.status).toHaveBeenCalledWith(expectedStatus);
  expect(response.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  expect(response.set).toHaveBeenCalledWith('Pragma', 'no-cache');
  return response.json.mock.calls[0][0] as Record<string, unknown>;
}

async function cleanDb() {
  await prisma.rewardEvent.deleteMany();
  await prisma.sellerRewardLink.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.customerPass.deleteMany();
  await prisma.sellerAuthorizationChallenge.deleteMany();
  await prisma.benefitRule.deleteMany();
  await prisma.product.deleteMany();
  await prisma.checkoutOperator.deleteMany();
  await prisma.adminAuditLog.deleteMany();
  await prisma.business.deleteMany();
}

beforeEach(async () => {
  mockEligibility.mockReset();
  mockEligibility.mockResolvedValue({
    eligible: true,
    lockEligible: true,
    heldEligible: true,
    verifiedLockSource: 'ifrlock',
  });
  await cleanDb();
  businessId = (await prisma.business.create({
    data: {
      name: 'Read-only Session Shop', ownerAddress: seller.address,
      discountPercent: 10, requiredLockIFR: 1000, ttlSeconds: 300,
    },
  })).id;
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

describe('CWA-43: public session GETs are read-only', () => {
  it.each(['PENDING', 'APPROVED'] as const)(
    'reports a stale %s session as EXPIRED without updating records on repeated GETs',
    async (status) => {
      const { sessionId } = await createSession(businessId);
      const before = await prisma.session.update({
        where: { id: sessionId },
        data: {
          status,
          expiresAt: new Date(Date.now() - 1000),
          updatedAt: new Date(Date.now() - 60_000),
        },
      });
      const auditsBefore = await prisma.auditLog.findMany();

      for (let poll = 0; poll < 2; poll++) {
        const body = await readOnlyGet(statusGet, sessionId);
        expect(Object.keys(body).sort()).toEqual([
          'attestAttempts', 'benefit', 'benefitRuleId', 'businessId', 'expiresAt',
          'presentation', 'reason', 'redeemedAt', 'status',
        ]);
        expect(body).toMatchObject({
          status: 'EXPIRED',
          reason: 'Session expired.',
          redeemedAt: null,
          expiresAt: before.expiresAt,
          attestAttempts: 0,
          businessId,
          benefitRuleId: before.benefitRuleId,
          benefit: { discountPercent: 10, requiredLockIFR: 1000, ttlSeconds: 300 },
          presentation: 'SELLER_QR',
        });
        expect(await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).toEqual(before);
        expect(await prisma.auditLog.findMany()).toEqual(auditsBefore);
      }
    }
  );

  it.each(['PENDING', 'APPROVED'] as const)(
    'reports %s as EXPIRED at the exact expiry instant without persisting it',
    async (status) => {
      const { sessionId } = await createSession(businessId);
      const before = await prisma.session.update({
        where: { id: sessionId },
        data: { status, expiresAt: new Date(Date.now() + 60_000) },
      });
      const clock = vi.spyOn(Date, 'now').mockReturnValue(before.expiresAt.getTime());
      try {
        const body = await readOnlyGet(statusGet, sessionId);
        expect(body.status).toBe('EXPIRED');
        expect(body.reason).toBe('Session expired.');
        expect(await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).toEqual(before);
      } finally {
        clock.mockRestore();
      }
    }
  );

  it.each([
    ['PENDING', false],
    ['APPROVED', false],
    ['REDEEMED', true],
    ['REJECTED', true],
    ['EXPIRED', true],
  ] as const)('preserves the response and stored state for %s', async (status, expired) => {
    const { sessionId } = await createSession(businessId);
    const before = await prisma.session.update({
      where: { id: sessionId },
      data: {
        status,
        expiresAt: new Date(Date.now() + (expired ? -60_000 : 60_000)),
        redeemedAt: status === 'REDEEMED' ? new Date() : null,
      },
    });

    const body = await readOnlyGet(statusGet, sessionId);

    expect(body.status).toBe(status);
    expect(body.redeemedAt).toEqual(before.redeemedAt);
    expect(await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).toEqual(before);
  });

  it('returns 404 without creating records for an unknown session', async () => {
    expect(await readOnlyGet(statusGet, 'missing-session', 404)).toEqual({ error: 'Session not found' });
  });

  it('keeps the retired challenge GET read-only even for a stale session', async () => {
    const { sessionId } = await createSession(businessId);
    const before = await prisma.session.update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await readOnlyGet(challengeGet, sessionId, 410)).toEqual({
      error: 'Request the checkout proof with POST and { walletAddress } in the JSON body.',
    });
    expect(await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).toEqual(before);
  });

  it('still redeems through the mutating proof flow after status polling', async () => {
    const { sessionId } = await createSession(businessId);
    const before = await prisma.session.update({
      where: { id: sessionId },
      data: { confirmedByWallet: seller.address, confirmedByRole: 'OWNER' },
    });
    expect((await readOnlyGet(statusGet, sessionId)).status).toBe('PENDING');
    expect(await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).toEqual(before);
    const message = await buildChallengeMessage(sessionId, customer.address);

    expect(await attest(sessionId, customer.address, await customer.signMessage(message)))
      .toMatchObject({ status: 'REDEEMED' });
    const redeemed = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(redeemed).toMatchObject({ status: 'REDEEMED', attestAttempts: 1 });
    expect(await prisma.auditLog.count({ where: { sessionId, type: 'REDEEMED' } })).toBe(1);
    expect((await readOnlyGet(statusGet, sessionId)).status).toBe('REDEEMED');
    expect(await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).toEqual(redeemed);
  });
});
