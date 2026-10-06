import { LockSource, SessionStatus } from '@/lib/api';
import { isLockSource } from '@/lib/lockSource';
import { ProductCurrency, productCurrencies } from '@/lib/money';

/**
 * Owner decision B (T-231b): customer history lives only on this device. The server keeps no
 * customer-linked history. A receipt carries the exact signed checkout-proof text (which contains the
 * full wallet address) and the signature, so the device can re-verify what it signed offline.
 */
export const CHECKOUT_PROOF_VERSION_LABEL = 'ifr-benefits/checkout-proof/2';

export interface CustomerProofReceipt {
  version: string;
  termsDigest: string;
  message: string;
  signature: string;
}

export interface CustomerProofHistoryItem {
  sessionId: string;
  businessId: string;
  sellerName: string;
  status: SessionStatus['status'];
  discountPercent: number;
  requiredLockIFR: number;
  minIFRHeld: number;
  lockSource: LockSource;
  ruleLabel: string;
  productName: string;
  basePriceMinor: string | null;
  currency: ProductCurrency | null;
  expiresAt: string;
  redeemedAt: string | null;
  walletLabel: string;
  savedAt: string;
  proof: CustomerProofReceipt | null;
}

const STORAGE_KEY = 'ifr.shop.customerProofHistory.v1';
const MAX_HISTORY_ITEMS = 12;

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function normalizeWholeIFR(value: unknown) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 1_000_000_000
    ? amount
    : 0;
}

export function redactVerifiedAddress(address?: string | null) {
  if (!address) return 'not verified';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizeProof(value: unknown): CustomerProofReceipt | null {
  if (!value || typeof value !== 'object') return null;
  const proof = value as Partial<CustomerProofReceipt>;
  if (
    typeof proof.version !== 'string' ||
    typeof proof.termsDigest !== 'string' ||
    typeof proof.message !== 'string' ||
    proof.message.length > 4000 ||
    typeof proof.signature !== 'string' ||
    !/^0x[0-9a-fA-F]{130}$/.test(proof.signature)
  ) return null;
  return {
    version: proof.version,
    termsDigest: proof.termsDigest,
    message: proof.message,
    signature: proof.signature,
  };
}

function normalizeItem(item: Partial<CustomerProofHistoryItem>): CustomerProofHistoryItem | null {
  if (!item.sessionId || !item.businessId || !item.status || !item.expiresAt || !item.savedAt) return null;
  const currency = typeof item.currency === 'string' && productCurrencies.includes(item.currency as ProductCurrency)
    ? item.currency as ProductCurrency
    : null;
  const basePriceMinor = typeof item.basePriceMinor === 'string' && /^(0|[1-9][0-9]{0,17})$/.test(item.basePriceMinor)
    ? item.basePriceMinor
    : null;
  return {
    sessionId: item.sessionId,
    businessId: item.businessId,
    sellerName: item.sellerName || item.businessId,
    status: item.status,
    discountPercent: Number(item.discountPercent || 0),
    requiredLockIFR: normalizeWholeIFR(item.requiredLockIFR),
    minIFRHeld: normalizeWholeIFR(item.minIFRHeld),
    lockSource: isLockSource(item.lockSource) ? item.lockSource : 'ifrlock',
    ruleLabel: item.ruleLabel || 'Business default',
    productName: item.productName || 'Business default benefit',
    basePriceMinor: currency ? basePriceMinor : null,
    currency: basePriceMinor ? currency : null,
    expiresAt: item.expiresAt,
    redeemedAt: item.redeemedAt || null,
    walletLabel: item.walletLabel || 'not verified',
    savedAt: item.savedAt,
    proof: normalizeProof(item.proof),
  };
}

export function readCustomerProofHistory(): CustomerProofHistoryItem[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeItem(item as Partial<CustomerProofHistoryItem>))
      .filter((item): item is CustomerProofHistoryItem => Boolean(item))
      .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
      .slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

export function saveCustomerProofHistoryItem(args: {
  sessionId: string;
  sellerName?: string | null;
  status: SessionStatus;
  verifiedWalletAddress?: string | null;
  proof?: CustomerProofReceipt | null;
}) {
  if (!canUseStorage()) return;

  const benefit = args.status.benefit;
  const previous = readCustomerProofHistory();
  const existing = previous.find((item) => item.sessionId === args.sessionId);
  const nextItem: CustomerProofHistoryItem = {
    sessionId: args.sessionId,
    businessId: args.status.businessId,
    sellerName: args.sellerName || args.status.businessId,
    status: args.status.status,
    discountPercent: benefit.discountPercent,
    requiredLockIFR: benefit.requiredLockIFR,
    minIFRHeld: benefit.minIFRHeld,
    lockSource: benefit.lockSource,
    ruleLabel: benefit.label || 'Business default',
    productName: benefit.productName || 'Business default benefit',
    basePriceMinor: benefit.basePriceMinor,
    currency: benefit.currency,
    expiresAt: args.status.expiresAt,
    redeemedAt: args.status.redeemedAt,
    walletLabel: args.verifiedWalletAddress
      ? redactVerifiedAddress(args.verifiedWalletAddress)
      : existing?.walletLabel || 'not verified',
    savedAt: existing?.savedAt || new Date().toISOString(),
    proof: normalizeProof(args.proof) ?? existing?.proof ?? null,
  };

  try {
    const withoutCurrent = previous.filter((item) => item.sessionId !== args.sessionId);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([nextItem, ...withoutCurrent].slice(0, MAX_HISTORY_ITEMS))
    );
  } catch {
    // Private browsing or locked-down browsers may reject storage; the proof page still works.
  }
}

export function clearCustomerProofHistory() {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function messageField(message: string, label: string) {
  const prefix = `${label}: `;
  const line = message.split('\n').find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length) : null;
}

export type ReceiptVerification =
  | { ok: true; wallet: string }
  | { ok: false; reason: string };

/**
 * Offline check of a device-local receipt. The full address comes from the signed text itself
 * (never from the redacted display label); the injected `recover` performs EIP-191 recovery.
 * This proves what this wallet signed for this checkout, not that the seller redeemed it: status
 * and redemption time come from the server while the merchant keeps the checkout record.
 */
export async function verifyCustomerProofReceipt(
  item: CustomerProofHistoryItem,
  recover: (message: string, signature: string) => Promise<string>
): Promise<ReceiptVerification> {
  const proof = item.proof;
  if (!proof) return { ok: false, reason: 'No signed proof is stored for this entry.' };
  const wallet = messageField(proof.message, 'Wallet');
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return { ok: false, reason: 'The signed text has no full wallet address.' };
  if (messageField(proof.message, 'Version') !== CHECKOUT_PROOF_VERSION_LABEL || proof.version !== CHECKOUT_PROOF_VERSION_LABEL) {
    return { ok: false, reason: 'Unsupported proof version.' };
  }
  if (messageField(proof.message, 'Session') !== item.sessionId) return { ok: false, reason: 'The signed text is for another checkout.' };
  if (messageField(proof.message, 'Shop') !== item.businessId) return { ok: false, reason: 'The signed text is for another shop.' };
  if (messageField(proof.message, 'Terms Digest') !== proof.termsDigest) return { ok: false, reason: 'The signed terms do not match the receipt.' };
  let recovered: string;
  try {
    recovered = await recover(proof.message, proof.signature);
  } catch {
    return { ok: false, reason: 'The signature cannot be recovered.' };
  }
  if (recovered.toLowerCase() !== wallet.toLowerCase()) {
    return { ok: false, reason: 'The signature does not match the wallet in the signed text.' };
  }
  return { ok: true, wallet };
}
