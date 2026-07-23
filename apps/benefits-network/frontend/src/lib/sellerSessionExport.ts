import type { SellerSessionSummary } from '@/lib/api';

export const SELLER_SESSION_PAGE_LIMIT = 50;

export function maskSellerSessionWallet(address: string | null) {
  if (!address) return '';
  if (address.length <= 12) return 'verified';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function csvCell(value: string | number | null | undefined) {
  const raw = value === null || value === undefined ? '' : String(value);
  const spreadsheetSafe = /^[\s]*[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${spreadsheetSafe.replace(/"/g, '""')}"`;
}

function isoOrOriginal(value: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export function buildSellerSessionCsv(sellerName: string, sessions: SellerSessionSummary[]) {
  const headers = [
    'Seller',
    'Session ID',
    'Status',
    'Created UTC',
    'Expires UTC',
    'Redeemed UTC',
    'Rule',
    'Product',
    'Category',
    'Reference price minor',
    'Currency',
    'Discount %',
    'Required lock IFR',
    'Verified lock IFR',
    'Customer wallet (masked)',
    'Reason',
    'Attest attempts',
  ];
  const rows = sessions.map((session) => [
    sellerName,
    session.id,
    session.status,
    isoOrOriginal(session.createdAt),
    isoOrOriginal(session.expiresAt),
    isoOrOriginal(session.redeemedAt),
    session.label || 'Business default',
    session.productName || 'Business default benefit',
    session.category || '',
    session.basePriceMinor || '',
    session.currency || '',
    session.discountPercent,
    session.requiredLockIFR,
    session.lockAmountRaw || '',
    maskSellerSessionWallet(session.recoveredAddress),
    session.reason || '',
    session.attestAttempts,
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function sellerSessionCsvFilename(sellerName: string, now = new Date()) {
  const safeSeller = sellerName
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48) || 'seller';
  return `ifr-benefits-${safeSeller}-history-${now.toISOString().slice(0, 10)}.csv`;
}
