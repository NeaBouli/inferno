import { ethers } from 'ethers';
import { isKnownSellerAction } from './sellerAuthorizationActions';
import { SELLER_AUTH_DOMAIN_PATTERN } from './sellerAuthConfigPolicy';

export const SELLER_AUTH_TTL_MS = 10 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;
const SELLER_AUTH_NONCE_PATTERN = /^[0-9a-f]{64}$/;

export class SellerAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SellerAuthError';
  }
}

export type SellerAuthBinding = {
  nonce: string;
  scope: string;
  /**
   * Target wallet of the action (operators:create, rewards:reward-wallet). It never travels in the
   * challenge URL and is never stored with the challenge: the client appends it to the server-issued
   * message as the final `Target:` line, and the server rebuilds that line from the authenticated request
   * body at verification.
   */
  target?: string;
};

/** Address-shaped text (0x + 40 hex) - forbidden in challenge scope and business fields. */
export function containsWalletAddress(value: string) {
  return /0x[0-9a-fA-F]{40}/.test(value);
}

/** The exact line a targeted seller authorization appends to the server-issued challenge message. */
export function sellerAuthTargetLine(target: string) {
  return `Target: ${normalizeAddress(target).toLowerCase()}`;
}

// Deployment identity bound into every seller authorization message.
export type SellerAuthContext = {
  domain: string;
  chainId: number;
};

export function resolveSellerAuthContext(source: {
  SELLER_AUTH_DOMAIN?: string;
  CHAIN_ID?: number;
}): SellerAuthContext {
  const domain = source.SELLER_AUTH_DOMAIN;
  const chainId = source.CHAIN_ID;
  if (
    !domain ||
    domain.length > 253 ||
    !SELLER_AUTH_DOMAIN_PATTERN.test(domain) ||
    !Number.isSafeInteger(chainId) ||
    (chainId as number) <= 0
  ) {
    throw new SellerAuthError('Seller authorization domain or chain is not configured');
  }
  return { domain, chainId: chainId as number };
}

export function buildSellerAuthMessage(
  context: SellerAuthContext,
  action: string,
  businessId: string,
  timestamp: string,
  binding: SellerAuthBinding
): string {
  const timestampMs = Number(timestamp);
  if (!Number.isSafeInteger(timestampMs)) {
    throw new SellerAuthError('Invalid seller authorization timestamp');
  }
  return [
    'IFR Benefits Network - Seller Authorization',
    `Domain: ${context.domain}`,
    `Chain ID: ${context.chainId}`,
    `Action: ${action}`,
    `Business: ${businessId || 'new'}`,
    `Scope: ${binding.scope}`,
    `Nonce: ${binding.nonce}`,
    `Timestamp: ${timestamp}`,
    `Expires: ${new Date(timestampMs + SELLER_AUTH_TTL_MS).toISOString()}`,
    `Only sign this message inside ${context.domain}.`,
    ...(binding.target !== undefined ? [sellerAuthTargetLine(binding.target)] : []),
  ].join('\n');
}

export function normalizeAddress(address: string): string {
  return ethers.getAddress(address);
}

export function verifySellerSignature(input: {
  context: SellerAuthContext;
  walletAddress: string;
  signature: string;
  timestamp: string;
  action: string;
  businessId?: string;
  nonce?: string;
  scope?: string;
  /** Target wallet from the authenticated request body; rebuilt into the signed `Target:` line. */
  target?: string;
}): string {
  if (!isKnownSellerAction(input.action)) {
    throw new SellerAuthError('Unknown seller authorization action');
  }
  if (!input.nonce || !input.scope) {
    throw new SellerAuthError('Seller authorization nonce and scope are required');
  }
  if (!SELLER_AUTH_NONCE_PATTERN.test(input.nonce)) {
    throw new SellerAuthError('Invalid seller authorization nonce');
  }
  const context = resolveSellerAuthContext({
    SELLER_AUTH_DOMAIN: input.context.domain,
    CHAIN_ID: input.context.chainId,
  });
  if (!/^\d{1,16}$/.test(input.timestamp)) {
    throw new SellerAuthError('Invalid seller authorization timestamp');
  }
  const timestampMs = Number(input.timestamp);

  const now = Date.now();
  if (timestampMs < now - SELLER_AUTH_TTL_MS || timestampMs > now + MAX_FUTURE_SKEW_MS) {
    throw new SellerAuthError('Seller authorization expired');
  }

  try {
    const expectedAddress = normalizeAddress(input.walletAddress);
    const message = buildSellerAuthMessage(
      context,
      input.action,
      input.businessId || 'new',
      input.timestamp,
      { nonce: input.nonce, scope: input.scope, target: input.target }
    );
    const recoveredAddress = normalizeAddress(ethers.verifyMessage(message, input.signature));
    if (recoveredAddress !== expectedAddress) {
      throw new SellerAuthError('Seller authorization signature mismatch');
    }

    return expectedAddress;
  } catch (err) {
    if (err instanceof SellerAuthError) throw err;
    throw new SellerAuthError('Invalid seller authorization');
  }
}
