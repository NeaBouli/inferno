export const productCurrencies = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'NZD',
  'CHF',
  'JPY',
  'SGD',
  'HKD',
  'AED',
  'SAR',
  'INR',
  'BRL',
  'MXN',
] as const;

export type ProductCurrency = typeof productCurrencies[number];

const currencyMinorDigits: Record<ProductCurrency, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  NZD: 2,
  CHF: 2,
  JPY: 0,
  SGD: 2,
  HKD: 2,
  AED: 2,
  SAR: 2,
  INR: 2,
  BRL: 2,
  MXN: 2,
};

const MAX_MINOR_DIGITS = 18;

export function majorPriceToMinor(value: string, currency: ProductCurrency): string | null {
  const digits = currencyMinorDigits[currency];
  const pattern = digits === 0
    ? /^(0|[1-9][0-9]*)$/
    : /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/;
  const match = value.trim().match(pattern);
  if (!match) return null;

  const whole = match[1];
  const fraction = digits === 0 ? '' : (match[2] || '').padEnd(digits, '0');
  const canonical = `${whole}${fraction}`.replace(/^0+(?=[0-9])/, '');
  return canonical.length <= MAX_MINOR_DIGITS ? canonical : null;
}

export function minorPriceToMajor(value: string | null, currency: ProductCurrency | null) {
  if (!value || !currency || !/^(0|[1-9][0-9]{0,17})$/.test(value)) return '';
  const digits = currencyMinorDigits[currency];
  if (digits === 0) return value;
  const padded = value.padStart(digits + 1, '0');
  const whole = padded.slice(0, -digits);
  const fraction = padded.slice(-digits);
  return `${whole}.${fraction}`;
}

export function formatProductPrice(value: string | null, currency: ProductCurrency | null) {
  const major = minorPriceToMajor(value, currency);
  if (!major || !currency) return null;
  const [whole, fraction] = major.split('.');
  const groupedWhole = BigInt(whole).toLocaleString('en-US');
  return fraction === undefined
    ? `${currency} ${groupedWhole}`
    : `${currency} ${groupedWhole}.${fraction}`;
}
