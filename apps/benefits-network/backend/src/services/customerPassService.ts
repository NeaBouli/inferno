import crypto from 'crypto';
import { verifyMessage } from 'ethers';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { normalizeAddress } from './sellerAuth';
import { consumeSellerAuthorizationChallenge } from './sellerAuthorizationChallenge';
import {
  attest,
  buildChallengeMessage,
  createSessionSnapshot,
  prisma,
  resolveSessionCreator,
} from './sessionService';
import { safeBusinessLogoUrl } from './businessProfile';
import { safeProductPrice } from './productPrice';

const CUSTOMER_PASS_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CUSTOMER_PASS_TTL_MS = 5 * 60 * 1000;

export class CustomerPassAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomerPassAuthError';
  }
}

function hashControlToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildCreateMessage(input: {
  walletAddress: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}) {
  return [
    'IFR Benefits Network - Create Checkout Pass',
    'Domain: shop.ifrunit.tech',
    `Wallet: ${input.walletAddress}`,
    `Nonce: ${input.nonce}`,
    `Issued: ${input.issuedAt.toISOString()}`,
    `Expires: ${input.expiresAt.toISOString()}`,
    `Chain ID: ${config.CHAIN_ID}`,
    'Action: Create one short-lived customer checkout pass',
    'This does not move tokens or approve a seller benefit.',
  ].join('\n');
}

export async function issueCustomerPassChallenge(db: PrismaClient, walletAddress: string) {
  const wallet = normalizeAddress(walletAddress);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CUSTOMER_PASS_CHALLENGE_TTL_MS);
  const nonce = crypto.randomBytes(32).toString('hex');
  await db.$transaction([
    db.customerPassChallenge.deleteMany({ where: { expiresAt: { lt: issuedAt } } }),
    db.customerPassChallenge.create({ data: { nonce, walletAddress: wallet, issuedAt, expiresAt } }),
  ]);
  return {
    walletAddress: wallet,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    message: buildCreateMessage({ walletAddress: wallet, nonce, issuedAt, expiresAt }),
  };
}

export async function createCustomerPass(input: {
  walletAddress: string;
  nonce: string;
  signature: string;
}) {
  const wallet = normalizeAddress(input.walletAddress);
  const challenge = await prisma.customerPassChallenge.findUnique({ where: { nonce: input.nonce } });
  if (!challenge || challenge.walletAddress !== wallet || challenge.consumedAt || challenge.expiresAt <= new Date()) {
    throw new CustomerPassAuthError('Customer pass challenge is invalid, expired, or already used');
  }
  const message = buildCreateMessage(challenge);
  let recovered: string;
  try {
    recovered = normalizeAddress(verifyMessage(message, input.signature));
  } catch {
    throw new CustomerPassAuthError('Customer pass signature is invalid');
  }
  if (recovered !== wallet) throw new CustomerPassAuthError('Customer pass signature does not match wallet');

  const id = crypto.randomBytes(24).toString('base64url');
  const controlToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + CUSTOMER_PASS_TTL_MS);
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.customerPassChallenge.updateMany({
      where: { nonce: input.nonce, walletAddress: wallet, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new CustomerPassAuthError('Customer pass challenge is invalid, expired, or already used');
    }
    await tx.customerPass.create({
      data: { id, walletAddress: wallet, controlHash: hashControlToken(controlToken), expiresAt },
    });
  });
  return { passId: id, controlToken, expiresAt, qrUrl: `/p/${id}` };
}

function bearerToken(authorization?: string) {
  const match = authorization?.match(/^Bearer\s+([A-Za-z0-9_-]{40,})$/);
  if (!match) throw new CustomerPassAuthError('Customer pass control token is required');
  return match[1];
}

export async function requireCustomerPassControl(passId: string, authorization?: string) {
  const token = bearerToken(authorization);
  const pass = await prisma.customerPass.findFirst({
    where: { id: passId, controlHash: hashControlToken(token) },
    include: {
      session: {
        include: { business: true, benefitRule: true },
      },
    },
  });
  if (!pass) throw new CustomerPassAuthError('Customer pass control token is invalid');
  return pass;
}

export async function getPublicCustomerPass(passId: string) {
  const pass = await prisma.customerPass.findUnique({
    where: { id: passId },
    select: { status: true, expiresAt: true },
  });
  if (!pass) return null;
  const available = pass.status === 'OPEN' && pass.expiresAt > new Date();
  return { available, expiresAt: pass.expiresAt };
}

export async function getControlledCustomerPass(passId: string, authorization?: string) {
  const pass = await requireCustomerPassControl(passId, authorization);
  if (pass.status === 'OPEN' && pass.expiresAt <= new Date()) {
    await prisma.customerPass.updateMany({
      where: { id: pass.id, status: 'OPEN' },
      data: { status: 'EXPIRED' },
    });
    return { status: 'EXPIRED', expiresAt: pass.expiresAt, checkout: null };
  }
  if (await expireBoundCustomerPass(pass)) {
    return {
      status: 'EXPIRED',
      expiresAt: pass.session?.expiresAt ?? pass.expiresAt,
      checkout: pass.session ? {
        status: 'EXPIRED',
        expiresAt: pass.session.expiresAt,
        businessId: pass.session.businessId,
        benefitRuleId: pass.session.benefitRuleId,
        sellerName: pass.session.business.name,
        sellerLogoUrl: safeBusinessLogoUrl(pass.session.business.logoUrl),
        benefit: {
          label: pass.session.benefitLabel,
          category: pass.session.benefitCategory,
          productName: pass.session.benefitProductName,
          ...safeProductPrice({
            basePriceMinor: pass.session.benefitBasePriceMinor,
            currency: pass.session.benefitCurrency,
          }),
          discountPercent: pass.session.benefitDiscountPercent ?? 0,
          requiredLockIFR: pass.session.benefitRequiredLockIFR ?? 0,
          minIFRHeld: (pass.session.benefitSnapshotVersion ?? 0) >= 4
            ? pass.session.benefitMinIFRHeld ?? 0
            : 0,
          lockSource: (pass.session.benefitSnapshotVersion ?? 0) >= 5
            ? pass.session.benefitLockSource ?? 'ifrlock'
            : 'ifrlock',
        },
        reason: null,
      } : null,
    };
  }
  const session = pass.session;
  return {
    status: pass.status,
    expiresAt: pass.expiresAt,
    checkout: session ? {
      status: session.status,
      expiresAt: session.expiresAt,
      businessId: session.businessId,
      benefitRuleId: session.benefitRuleId,
      sellerName: session.business.name,
      sellerLogoUrl: safeBusinessLogoUrl(session.business.logoUrl),
      benefit: {
        label: session.benefitLabel,
        category: session.benefitCategory,
        productName: session.benefitProductName,
        ...safeProductPrice({
          basePriceMinor: session.benefitBasePriceMinor,
          currency: session.benefitCurrency,
        }),
        discountPercent: session.benefitDiscountPercent ?? 0,
        requiredLockIFR: session.benefitRequiredLockIFR ?? 0,
        minIFRHeld: (session.benefitSnapshotVersion ?? 0) >= 4
          ? session.benefitMinIFRHeld ?? 0
          : 0,
        lockSource: (session.benefitSnapshotVersion ?? 0) >= 5
          ? session.benefitLockSource ?? 'ifrlock'
          : 'ifrlock',
      },
      reason: session.status === 'REJECTED' ? session.reason : null,
    } : null,
  };
}

export async function bindCustomerPass(input: {
  passId: string;
  businessId: string;
  benefitRuleId: string;
  sellerWallet: string;
  nonce: string;
  scope: string;
}) {
  return prisma.$transaction(async (tx) => {
    await consumeSellerAuthorizationChallenge(tx, {
      nonce: input.nonce,
      walletAddress: input.sellerWallet,
      action: 'passes:bind',
      businessId: input.businessId,
      scope: input.scope,
    });
    const creator = await resolveSessionCreator(tx, input.businessId, input.sellerWallet);
    if (!creator) throw new Error('Seller wallet is not authorized for checkout');
    const claimed = await tx.customerPass.updateMany({
      where: { id: input.passId, status: 'OPEN', expiresAt: { gt: new Date() } },
      data: { status: 'BOUND', boundAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error('Customer pass is unavailable, expired, or already bound');
    const session = await createSessionSnapshot(tx, {
      businessId: input.businessId,
      benefitRuleId: input.benefitRuleId,
      creator,
      customerPassId: input.passId,
    });
    await tx.customerPass.update({ where: { id: input.passId }, data: { expiresAt: session.expiresAt } });
    return {
      sessionId: session.id,
      expiresAt: session.expiresAt,
      benefit: {
        label: session.benefitLabel,
        category: session.benefitCategory,
        productName: session.benefitProductName,
        ...safeProductPrice({
          basePriceMinor: session.benefitBasePriceMinor,
          currency: session.benefitCurrency,
        }),
        discountPercent: session.benefitDiscountPercent ?? 0,
        requiredLockIFR: session.benefitRequiredLockIFR ?? 0,
        minIFRHeld: (session.benefitSnapshotVersion ?? 0) >= 4
          ? session.benefitMinIFRHeld ?? 0
          : 0,
        lockSource: (session.benefitSnapshotVersion ?? 0) >= 5
          ? session.benefitLockSource ?? 'ifrlock'
          : 'ifrlock',
      },
      createdBy: creator,
    };
  });
}

export async function getCustomerPassChallenge(passId: string, authorization?: string) {
  const pass = await requireCustomerPassControl(passId, authorization);
  if (await expireBoundCustomerPass(pass)) throw new Error('Customer pass expired');
  if (pass.status !== 'BOUND' || !pass.session) throw new Error('Customer pass is not ready for confirmation');
  return buildChallengeMessage(pass.session.id, { allowCustomerPass: true });
}

export async function confirmCustomerPass(passId: string, signature: string, authorization?: string) {
  const pass = await requireCustomerPassControl(passId, authorization);
  if (await expireBoundCustomerPass(pass)) throw new Error('Customer pass expired');
  if (pass.status !== 'BOUND' || !pass.session) throw new Error('Customer pass is not ready for confirmation');
  return attest(pass.session.id, signature, { expectedWallet: pass.walletAddress });
}

export async function cancelCustomerPass(passId: string, authorization?: string) {
  await requireCustomerPassControl(passId, authorization);
  const outcome = await prisma.$transaction(async (tx) => {
    const locked = await tx.$executeRaw`
      UPDATE "CustomerPass" SET "status" = "status" WHERE "id" = ${passId}
    `;
    if (locked !== 1) throw new CustomerPassAuthError('Customer pass control token is invalid');
    const current = await tx.customerPass.findUnique({
      where: { id: passId },
      include: { session: true },
    });
    if (!current) throw new CustomerPassAuthError('Customer pass control token is invalid');
    const now = new Date();
    const sessionExpired = Boolean(
      current.session && ['PENDING', 'APPROVED'].includes(current.session.status) && current.session.expiresAt <= now
    );
    if ((current.status === 'OPEN' && current.expiresAt <= now) || sessionExpired) {
      if (current.session) {
        await tx.session.updateMany({
          where: { id: current.session.id, status: { in: ['PENDING', 'APPROVED'] } },
          data: { status: 'EXPIRED' },
        });
      }
      await tx.customerPass.updateMany({
        where: { id: passId, status: { in: ['OPEN', 'BOUND'] } },
        data: { status: 'EXPIRED' },
      });
      return 'EXPIRED' as const;
    }
    if (!['OPEN', 'BOUND'].includes(current.status)) return current.status;
    if (current.session && current.session.status !== 'PENDING') return current.session.status;

    if (current.session) {
      const rejected = await tx.session.updateMany({
        where: { id: current.session.id, status: 'PENDING' },
        data: { status: 'REJECTED', reason: 'Customer cancelled checkout confirmation.' },
      });
      if (rejected.count !== 1) return 'CHECKOUT_CHANGED' as const;
    }
    const cancelled = await tx.customerPass.updateMany({
      where: { id: passId, status: { in: ['OPEN', 'BOUND'] } },
      data: { status: 'CANCELLED', cancelledAt: now },
    });
    return cancelled.count === 1 ? 'CANCELLED' as const : 'PASS_CHANGED' as const;
  });
  if (outcome !== 'CANCELLED') {
    throw new Error(`Customer pass cannot be cancelled (${outcome.toLowerCase()})`);
  }
  return { status: 'CANCELLED' };
}

async function expireBoundCustomerPass(pass: Awaited<ReturnType<typeof requireCustomerPassControl>>) {
  if (
    pass.status !== 'BOUND' || !pass.session ||
    !(
      pass.session.status === 'EXPIRED' ||
      (['PENDING', 'APPROVED'].includes(pass.session.status) && pass.session.expiresAt <= new Date())
    )
  ) return false;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "CustomerPass" SET "status" = "status" WHERE "id" = ${pass.id}
    `;
    await tx.session.updateMany({
      where: { id: pass.session!.id, status: { in: ['PENDING', 'APPROVED'] }, expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    });
    await tx.customerPass.updateMany({
      where: { id: pass.id, status: 'BOUND' },
      data: { status: 'EXPIRED' },
    });
  });
  return true;
}
