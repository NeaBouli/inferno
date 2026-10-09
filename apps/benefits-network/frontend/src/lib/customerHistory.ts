import { LockSource, SessionStatus } from '@/lib/api';
import { isLockSource } from '@/lib/lockSource';
import { ProductCurrency, productCurrencies } from '@/lib/money';
import {
  CHECKOUT_PROOF_PURPOSE,
  CHECKOUT_PROOF_VERSION_LABEL,
  SignedCheckoutProof,
  canonicalTermsJson,
  parseCheckoutProof,
} from '@/lib/checkoutProof';

/**
 * Owner decision B (T-231b): customer history lives only on this device. The server keeps no
 * customer-linked history. A receipt carries the exact signed checkout-proof text (which contains the
 * full wallet address) and the signature, so the device can re-verify what it signed offline.
 */
export { CHECKOUT_PROOF_VERSION_LABEL };

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
  // With a signed proof, every displayed checkout term comes from the signed text itself.
  const signed = nextItem.proof ? parseCheckoutProof(nextItem.proof.message) : null;
  if (signed) Object.assign(nextItem, displayFieldsFromSigned(signed), { walletLabel: redactVerifiedAddress(signed.wallet) });

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

function displayFieldsFromSigned(signed: SignedCheckoutProof) {
  const currency = signed.terms.currency && productCurrencies.includes(signed.terms.currency as ProductCurrency)
    ? signed.terms.currency as ProductCurrency
    : null;
  return {
    sessionId: signed.session,
    businessId: signed.shop,
    discountPercent: signed.terms.discountPercent,
    requiredLockIFR: signed.terms.requiredLockIFR,
    minIFRHeld: signed.terms.minIFRHeld,
    lockSource: isLockSource(signed.terms.lockSource) ? signed.terms.lockSource : 'ifrlock' as LockSource,
    ruleLabel: signed.terms.label,
    productName: signed.terms.productName,
    basePriceMinor: currency ? signed.terms.basePriceMinor : null,
    currency,
    expiresAt: new Date(signed.expires).toISOString(),
  };
}

export type ReceiptVerification =
  | { ok: true; wallet: string; signed: SignedCheckoutProof }
  | { ok: false; reason: string };

export interface ReceiptContext {
  /** Deployment audience the server binds into the proof (this site's host). */
  expectedAudience: string;
  /** Canonical chain of this deployment. */
  expectedChainId: number;
  /** Every receipt in the local store, to reject duplicated/replayed entries. */
  receipts: CustomerProofHistoryItem[];
}

export interface ReceiptVerifier {
  /** EIP-191 signer recovery. */
  recover: (message: string, signature: string) => Promise<string>;
  /** Lower-case hex SHA-256 of a UTF-8 string. */
  sha256Hex: (text: string) => Promise<string>;
}

/**
 * Offline check of a device-local receipt. Every checkout term the receipt displays must equal the
 * signed text; the full address comes from the signed text itself (never from the redacted label)
 * and must be the recovered signer. A valid receipt proves the customer's consent to exactly these
 * terms. It does NOT prove redemption: status, redemption time, seller name and saved time are
 * local notes; the authoritative status comes from the server while the merchant keeps the record.
 */
export async function verifyCustomerProofReceipt(
  item: CustomerProofHistoryItem,
  verifier: ReceiptVerifier,
  context: ReceiptContext
): Promise<ReceiptVerification> {
  // Expected audience and chain come from the running deployment, never from the receipt or
  // localStorage. Without a trusted context nothing can be verified (fail closed).
  if (
    typeof context?.expectedAudience !== 'string' || !context.expectedAudience ||
    !Number.isSafeInteger(context?.expectedChainId) || context.expectedChainId <= 0 ||
    !Array.isArray(context?.receipts)
  ) {
    return { ok: false, reason: 'This device cannot verify receipts without the deployment context.' };
  }
  const proof = item.proof;
  if (!proof) return { ok: false, reason: 'No signed proof is stored for this entry.' };
  const signed = parseCheckoutProof(proof.message);
  if (!signed) return { ok: false, reason: 'The stored proof text is incomplete or malformed.' };
  if (signed.version !== CHECKOUT_PROOF_VERSION_LABEL || proof.version !== CHECKOUT_PROOF_VERSION_LABEL) {
    return { ok: false, reason: 'Unsupported proof version.' };
  }
  if (signed.purpose !== CHECKOUT_PROOF_PURPOSE) return { ok: false, reason: 'Unexpected proof purpose.' };
  if (signed.audience !== context.expectedAudience) {
    return { ok: false, reason: 'The proof was signed for another deployment.' };
  }
  if (signed.chainId !== context.expectedChainId) return { ok: false, reason: 'The proof was signed for another chain.' };
  // Limitation: duplicate detection is LOCAL ONLY. It compares this receipt with the other entries of
  // this device's bounded history (MAX_HISTORY_ITEMS = 12); it is not global replay prevention. Single
  // redemption is enforced by the backend (one conditional PENDING -> REDEEMED update per session).
  const duplicates = context.receipts.filter((other) => {
    if (other === item) return false;
    if (other.sessionId === item.sessionId) return true;
    if (!other.proof) return false;
    if (other.proof.signature === proof.signature) return true;
    const otherSigned = parseCheckoutProof(other.proof.message);
    return Boolean(otherSigned && (otherSigned.nonce === signed.nonce || otherSigned.session === signed.session));
  });
  if (duplicates.length > 0) return { ok: false, reason: 'Duplicate receipt: this checkout appears more than once on this device.' };
  if (signed.termsDigest !== proof.termsDigest) return { ok: false, reason: 'The signed terms do not match the receipt.' };
  const digest = `sha256:${await verifier.sha256Hex(canonicalTermsJson(signed.terms))}`;
  if (digest !== signed.termsDigest) return { ok: false, reason: 'The signed terms digest does not match the signed terms.' };
  const expected = displayFieldsFromSigned(signed);
  for (const [key, value] of Object.entries(expected)) {
    if ((item as unknown as Record<string, unknown>)[key] !== value) {
      return { ok: false, reason: 'A displayed checkout detail differs from the signed proof.' };
    }
  }
  if (item.walletLabel !== redactVerifiedAddress(signed.wallet)) {
    return { ok: false, reason: 'The displayed wallet differs from the signed proof.' };
  }
  let recovered: string;
  try {
    recovered = await verifier.recover(proof.message, proof.signature);
  } catch {
    return { ok: false, reason: 'The signature cannot be recovered.' };
  }
  if (recovered.toLowerCase() !== signed.wallet.toLowerCase()) {
    return { ok: false, reason: 'The signature does not match the wallet in the signed text.' };
  }
  return { ok: true, wallet: signed.wallet, signed };
}
