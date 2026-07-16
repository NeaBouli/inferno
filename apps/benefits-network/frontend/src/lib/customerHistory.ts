import { SessionStatus } from '@/lib/api';

export interface CustomerProofHistoryItem {
  sessionId: string;
  businessId: string;
  sellerName: string;
  status: SessionStatus['status'];
  discountPercent: number;
  requiredLockIFR: number;
  ruleLabel: string;
  productName: string;
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

function redactAddress(address?: string | null) {
  if (!address) return 'not verified';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizeItem(item: Partial<CustomerProofHistoryItem>): CustomerProofHistoryItem | null {
  if (!item.sessionId || !item.businessId || !item.status || !item.expiresAt || !item.savedAt) return null;
  return {
    sessionId: item.sessionId,
    businessId: item.businessId,
    sellerName: item.sellerName || item.businessId,
    status: item.status,
    discountPercent: Number(item.discountPercent || 0),
    requiredLockIFR: Number(item.requiredLockIFR || 0),
    ruleLabel: item.ruleLabel || 'Business default',
    productName: item.productName || 'Business default benefit',
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
  walletAddress?: string | null;
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
    ruleLabel: benefit.label || 'Business default',
    productName: benefit.productName || 'Business default benefit',
    expiresAt: args.status.expiresAt,
    redeemedAt: args.status.redeemedAt,
    walletLabel: redactAddress(args.status.recoveredAddress || args.walletAddress),
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
