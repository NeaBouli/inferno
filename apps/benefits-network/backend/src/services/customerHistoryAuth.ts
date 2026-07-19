import crypto from 'crypto';
import { ethers } from 'ethers';
import type { PrismaClient } from '@prisma/client';

const CUSTOMER_HISTORY_DOMAIN = 'shop.ifrunit.tech';
export const CUSTOMER_HISTORY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const CUSTOMER_HISTORY_ACCESS_TTL_MS = 10 * 60 * 1000;

export class CustomerHistoryAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomerHistoryAuthError';
  }
}

export function normalizeCustomerAddress(address: string) {
  try {
    return ethers.utils.getAddress(address);
  } catch {
    throw new CustomerHistoryAuthError('Invalid customer wallet address');
  }
}

export function buildCustomerHistoryMessage(input: {
  walletAddress: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}) {
  return [
    'IFR Benefits Network - Customer History Authorization',
    `Domain: ${CUSTOMER_HISTORY_DOMAIN}`,
    `Wallet: ${input.walletAddress}`,
    `Issued: ${input.issuedAt.toISOString()}`,
    `Expires: ${input.expiresAt.toISOString()}`,
    `Nonce: ${input.nonce}`,
    'Action: Read My Benefits History',
    'This signature is read-only and does not move tokens.',
  ].join('\n');
}

function tokenHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function issueCustomerHistoryChallenge(db: PrismaClient, walletAddress: string) {
  const wallet = normalizeCustomerAddress(walletAddress);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CUSTOMER_HISTORY_CHALLENGE_TTL_MS);
  const nonce = crypto.randomBytes(32).toString('hex');

  await db.$transaction([
    db.customerHistoryChallenge.deleteMany({ where: { expiresAt: { lt: issuedAt } } }),
    db.customerHistoryAccess.deleteMany({ where: { expiresAt: { lt: issuedAt } } }),
    db.customerHistoryChallenge.create({
      data: { nonce, walletAddress: wallet, issuedAt, expiresAt },
    }),
  ]);

  return {
    nonce,
    expiresAt: expiresAt.toISOString(),
    message: buildCustomerHistoryMessage({ walletAddress: wallet, nonce, issuedAt, expiresAt }),
  };
}

export async function authorizeCustomerHistory(db: PrismaClient, input: {
  walletAddress: string;
  nonce: string;
  signature: string;
}) {
  const wallet = normalizeCustomerAddress(input.walletAddress);
  const challenge = await db.customerHistoryChallenge.findUnique({ where: { nonce: input.nonce } });
  const now = new Date();
  if (
    !challenge || challenge.walletAddress !== wallet || challenge.consumedAt ||
    challenge.expiresAt <= now
  ) {
    throw new CustomerHistoryAuthError('Customer history challenge is invalid, expired, or already used');
  }

  const message = buildCustomerHistoryMessage({
    walletAddress: challenge.walletAddress,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  });
  let recovered: string;
  try {
    recovered = normalizeCustomerAddress(ethers.utils.verifyMessage(message, input.signature));
  } catch (error) {
    if (error instanceof CustomerHistoryAuthError) throw error;
    throw new CustomerHistoryAuthError('Invalid customer history authorization');
  }
  if (recovered !== wallet) {
    throw new CustomerHistoryAuthError('Customer history authorization signature mismatch');
  }

  const accessToken = crypto.randomBytes(32).toString('base64url');
  const accessExpiresAt = new Date(now.getTime() + CUSTOMER_HISTORY_ACCESS_TTL_MS);
  await db.$transaction(async (tx) => {
    const consumed = await tx.customerHistoryChallenge.updateMany({
      where: {
        nonce: challenge.nonce,
        walletAddress: wallet,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw new CustomerHistoryAuthError('Customer history challenge is invalid, expired, or already used');
    }
    await tx.customerHistoryAccess.create({
      data: { tokenHash: tokenHash(accessToken), walletAddress: wallet, expiresAt: accessExpiresAt },
    });
  });

  return {
    accessToken,
    expiresAt: accessExpiresAt.toISOString(),
  };
}

export async function requireCustomerHistoryAccess(db: PrismaClient, authorizationHeader?: string) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorizationHeader || '');
  if (!match) throw new CustomerHistoryAuthError('Customer history access token is required');

  const access = await db.customerHistoryAccess.findUnique({
    where: { tokenHash: tokenHash(match[1]) },
  });
  if (!access || access.expiresAt <= new Date()) {
    throw new CustomerHistoryAuthError('Customer history access expired');
  }
  return access.walletAddress;
}
