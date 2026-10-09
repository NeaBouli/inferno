/**
 * Parser for the server-derived checkout proof v2 text (owner decision B, T-231b).
 * Dependency-free so the backend test-suite can cross-check it against the server derivation.
 */
export const CHECKOUT_PROOF_VERSION_LABEL = 'ifr-benefits/checkout-proof/2';
export const CHECKOUT_PROOF_PURPOSE = 'Redeem this one checkout with verified IFR benefit eligibility';

export interface SignedCheckoutTerms {
  benefitRuleId: string;
  label: string;
  productName: string;
  basePriceMinor: string | null;
  currency: string | null;
  requiredLockIFR: number;
  minIFRHeld: number;
  lockSource: string;
  discountPercent: number;
}

export interface SignedCheckoutProof {
  version: string;
  purpose: string;
  wallet: string;
  audience: string;
  chainId: number;
  shop: string;
  session: string;
  nonce: string;
  expires: string;
  terms: SignedCheckoutTerms;
  termsDigest: string;
}

function field(lines: string[], label: string) {
  const prefix = `${label}: `;
  const matches = lines.filter((line) => line.startsWith(prefix));
  return matches.length === 1 ? matches[0].slice(prefix.length) : null;
}

function wholeNumber(value: string | null) {
  if (value === null || !/^(0|[1-9][0-9]{0,15})$/.test(value)) return null;
  return Number(value);
}

/** Returns null unless every required field is present exactly once and well-formed. */
export function parseCheckoutProof(message: string): SignedCheckoutProof | null {
  const lines = message.split('\n');
  if (lines[0] !== 'IFR Benefits Network - Checkout Proof') return null;
  const version = field(lines, 'Version');
  const purpose = field(lines, 'Purpose');
  const wallet = field(lines, 'Wallet');
  const audience = field(lines, 'Audience');
  const chainId = wholeNumber(field(lines, 'Chain ID'));
  const shop = field(lines, 'Shop');
  const session = field(lines, 'Session');
  const nonce = field(lines, 'Nonce');
  const expires = field(lines, 'Expires');
  const benefitRuleId = field(lines, 'Benefit Rule');
  const label = field(lines, 'Benefit');
  const productName = field(lines, 'Product');
  const requiredLockIFR = wholeNumber(field(lines, 'Required Lock IFR'));
  const minIFRHeld = wholeNumber(field(lines, 'Minimum Held IFR'));
  const lockSource = field(lines, 'Lock Source');
  const discountPercent = wholeNumber(field(lines, 'Discount Percent'));
  const termsDigest = field(lines, 'Terms Digest');
  const price = field(lines, 'Reference Price');
  const priceMatch = price === null ? null : price.match(/^([A-Z]{3}) (0|[1-9][0-9]{0,17}) minor units$/);
  if (
    !version || !purpose || !wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet) || !audience || chainId === null ||
    !shop || !/^[A-Za-z0-9_-]{1,64}$/.test(shop) || !session || !/^[A-Za-z0-9_-]{1,64}$/.test(session) ||
    !nonce || !/^[0-9a-f]{64}$/.test(nonce) || !expires || Number.isNaN(Date.parse(expires)) || benefitRuleId === null ||
    label === null || productName === null || requiredLockIFR === null || minIFRHeld === null ||
    !lockSource || discountPercent === null || !termsDigest || !/^sha256:[0-9a-f]{64}$/.test(termsDigest) ||
    (price !== null && !priceMatch)
  ) return null;
  return {
    version,
    purpose,
    wallet,
    audience,
    chainId,
    shop,
    session,
    nonce,
    expires,
    terms: {
      benefitRuleId,
      label,
      productName,
      basePriceMinor: priceMatch ? priceMatch[2] : null,
      currency: priceMatch ? priceMatch[1] : null,
      requiredLockIFR,
      minIFRHeld,
      lockSource,
      discountPercent,
    },
    termsDigest,
  };
}

/** Canonical terms JSON exactly as the server hashes it (fixed key order). */
export function canonicalTermsJson(terms: SignedCheckoutTerms) {
  return JSON.stringify({
    benefitRuleId: terms.benefitRuleId,
    label: terms.label,
    productName: terms.productName,
    basePriceMinor: terms.basePriceMinor,
    currency: terms.currency,
    requiredLockIFR: terms.requiredLockIFR,
    minIFRHeld: terms.minIFRHeld,
    lockSource: terms.lockSource,
    discountPercent: terms.discountPercent,
  });
}
