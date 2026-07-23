import { SessionStatus } from '@/lib/api';
import { ProductCurrency, productCurrencies } from '@/lib/money';

export interface CustomerProofHistoryItem {
  sessionId: string;
  businessId: string;
  sellerName: string;
  status: SessionStatus['status'];
  discountPercent: number;
  requiredLockIFR: number;
  minIFRHeld: number;
  ruleLabel: string;
  productName: string;
  basePriceMinor: string | null;
  currency: ProductCurrency | null;
  expiresAt: string;
  redeemedAt: string | null;
  walletLabel: string;
  savedAt: string;
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
    ruleLabel: item.ruleLabel || 'Business default',
    productName: item.productName || 'Business default benefit',
    basePriceMinor: currency ? basePriceMinor : null,
    currency: basePriceMinor ? currency : null,
    expiresAt: item.expiresAt,
    redeemedAt: item.redeemedAt || null,
    walletLabel: item.walletLabel || 'not verified',
    savedAt: item.savedAt,
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
