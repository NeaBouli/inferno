import { ethers } from 'ethers';
import { requiresSingleUseSellerChallenge } from './sellerAuthorizationActions';

export const SELLER_AUTH_TTL_MS = 10 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;

export class SellerAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SellerAuthError';
  }
}

export type SellerAuthBinding = {
  nonce: string;
  scope: string;
};

export function buildSellerAuthMessage(
  action: string,
  businessId: string,
  timestamp: string,
  binding?: SellerAuthBinding
): string {
  const lines = [
    'IFR Benefits Network - Seller Authorization',
    `Action: ${action}`,
    `Business: ${businessId || 'new'}`,
    `Timestamp: ${timestamp}`,
  ];
  if (binding) {
    lines.push(`Scope: ${binding.scope}`, `Nonce: ${binding.nonce}`);
  }
  lines.push('Only sign this message inside shop.ifrunit.tech.');
  return lines.join('\n');
}

export function normalizeAddress(address: string): string {
  return ethers.utils.getAddress(address);
}

export function verifySellerSignature(input: {
  walletAddress: string;
  signature: string;
  timestamp: string;
  action: string;
  businessId?: string;
  nonce?: string;
  scope?: string;
}): string {
  if (Boolean(input.nonce) !== Boolean(input.scope)) {
    throw new SellerAuthError('Incomplete seller authorization binding');
  }
  if (requiresSingleUseSellerChallenge(input.action) && (!input.nonce || !input.scope)) {
    throw new SellerAuthError('Seller authorization binding is required for mutations');
  }
  const timestampMs = Number(input.timestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new SellerAuthError('Invalid seller authorization timestamp');
  }

  const now = Date.now();
  if (timestampMs < now - SELLER_AUTH_TTL_MS || timestampMs > now + MAX_FUTURE_SKEW_MS) {
    throw new SellerAuthError('Seller authorization expired');
  }

  try {
    const expectedAddress = normalizeAddress(input.walletAddress);
    const binding = input.nonce && input.scope
      ? { nonce: input.nonce, scope: input.scope }
      : undefined;
    const message = buildSellerAuthMessage(
      input.action,
      input.businessId || 'new',
      input.timestamp,
      binding
    );
    const recoveredAddress = normalizeAddress(ethers.utils.verifyMessage(message, input.signature));
    if (recoveredAddress !== expectedAddress) {
      throw new SellerAuthError('Seller authorization signature mismatch');
    }

    return expectedAddress;
  } catch (err) {
    if (err instanceof SellerAuthError) throw err;
    throw new SellerAuthError('Invalid seller authorization');
  }
}
