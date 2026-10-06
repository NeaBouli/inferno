import { createHmac } from 'node:crypto';

/**
 * Customer wallet fingerprints (T-231a).
 *
 * The backend never persists a raw customer wallet address. Wherever a stored identity is needed
 * (anti-replay challenges, pass binding, redemption limits, customer history, one reward per
 * wallet and partner, self-redemption exclusion) it stores this keyed fingerprint instead:
 *
 *   "wfp1:" + hex(HMAC-SHA256(CUSTOMER_WALLET_HMAC_KEY, DOMAIN + lowercase(address)))
 *
 * The key lives only in the server environment and is never logged. Without the key nobody can
 * test a guessed address against the database, which a plain hash of a public address would allow.
 * Raw addresses exist only in memory for the duration of a request.
 */

export const WALLET_FINGERPRINT_PREFIX = 'wfp1:';
export const CUSTOMER_WALLET_HMAC_KEY_MIN_LENGTH = 32;
const FINGERPRINT_DOMAIN = 'ifr-benefits/customer-wallet/v1:';
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const FINGERPRINT_PATTERN = /^wfp1:[0-9a-f]{64}$/;

const documentedPlaceholders = new Set([
  'replace-with-a-long-random-customer-wallet-hmac-key',
  'change-me',
]);

export class WalletFingerprintUnavailableError extends Error {
  constructor() {
    super('Customer wallet protection is not configured on this server; no customer identity is stored');
    this.name = 'WalletFingerprintUnavailableError';
  }
}

/** Startup validation: an absent key is allowed (customer paths then fail closed), a weak one is not. */
export function getCustomerWalletKeyPolicyIssue(
  key: string | undefined,
  adminSecret: string | undefined
): string | null {
  if (key === undefined || key === '') return null;
  if (key.length < CUSTOMER_WALLET_HMAC_KEY_MIN_LENGTH) {
    return `CUSTOMER_WALLET_HMAC_KEY must be at least ${CUSTOMER_WALLET_HMAC_KEY_MIN_LENGTH} characters long`;
  }
  if (documentedPlaceholders.has(key.trim().toLowerCase())) {
    return 'CUSTOMER_WALLET_HMAC_KEY must not use a documented placeholder default';
  }
  if (adminSecret && key === adminSecret) {
    return 'CUSTOMER_WALLET_HMAC_KEY must differ from ADMIN_SECRET';
  }
  return null;
}

export function isRawWalletAddress(value: unknown): value is string {
  return typeof value === 'string' && ADDRESS_PATTERN.test(value);
}

export function isWalletFingerprint(value: unknown): value is string {
  return typeof value === 'string' && FINGERPRINT_PATTERN.test(value);
}

/** Pure, key-explicit form used by the service and by the offline data migration. */
export function computeWalletFingerprint(key: string, address: string): string {
  if (!key || key.length < CUSTOMER_WALLET_HMAC_KEY_MIN_LENGTH) throw new WalletFingerprintUnavailableError();
  if (!isRawWalletAddress(address)) throw new Error('Invalid wallet address');
  const digest = createHmac('sha256', key).update(FINGERPRINT_DOMAIN + address.toLowerCase()).digest('hex');
  return WALLET_FINGERPRINT_PREFIX + digest;
}

function configuredKey(): string | null {
  // Lazy require keeps this module importable by the migration CLI without the full app config.
  const { config } = require('../config') as { config: { CUSTOMER_WALLET_HMAC_KEY?: string } };
  const key = config.CUSTOMER_WALLET_HMAC_KEY;
  return key && key.length >= CUSTOMER_WALLET_HMAC_KEY_MIN_LENGTH ? key : null;
}

export function isWalletFingerprintConfigured(): boolean {
  return configuredKey() !== null;
}

/** Fail closed: throws WalletFingerprintUnavailableError when the server key is missing. */
export function fingerprintWallet(address: string): string {
  const key = configuredKey();
  if (!key) throw new WalletFingerprintUnavailableError();
  return computeWalletFingerprint(key, address);
}

/** Fingerprint a list of (seller) addresses, skipping empty and malformed values. */
export function fingerprintWallets(addresses: Array<string | null | undefined>): Set<string> {
  const result = new Set<string>();
  for (const address of addresses) {
    if (isRawWalletAddress(address)) result.add(fingerprintWallet(address));
  }
  return result;
}
