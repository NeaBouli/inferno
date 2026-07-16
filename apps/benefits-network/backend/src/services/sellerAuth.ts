import { ethers } from 'ethers';

const MAX_SIGNATURE_AGE_MS = 10 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;

export function buildSellerAuthMessage(action: string, businessId: string, timestamp: string): string {
  return [
    'IFR Benefits Network - Seller Authorization',
    `Action: ${action}`,
    `Business: ${businessId || 'new'}`,
    `Timestamp: ${timestamp}`,
    'Only sign this message inside shop.ifrunit.tech.',
  ].join('\n');
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
}): string {
  const timestampMs = Number(input.timestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new Error('Invalid seller auth timestamp');
  }

  const now = Date.now();
  if (timestampMs < now - MAX_SIGNATURE_AGE_MS || timestampMs > now + MAX_FUTURE_SKEW_MS) {
    throw new Error('Seller authorization expired');
  }

  const expectedAddress = normalizeAddress(input.walletAddress);
  const message = buildSellerAuthMessage(input.action, input.businessId || 'new', input.timestamp);
  const recoveredAddress = normalizeAddress(ethers.utils.verifyMessage(message, input.signature));
  if (recoveredAddress !== expectedAddress) {
    throw new Error('Seller authorization signature mismatch');
  }

  return expectedAddress;
}
