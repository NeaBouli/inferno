export const SUPPORTED_PRODUCT_CURRENCIES = [
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

export type SupportedProductCurrency = typeof SUPPORTED_PRODUCT_CURRENCIES[number];

const supportedCurrencies = new Set<string>(SUPPORTED_PRODUCT_CURRENCIES);
export const PRODUCT_PRICE_MINOR_PATTERN = /^(0|[1-9][0-9]{0,17})$/;

export function isSupportedProductCurrency(value: unknown): value is SupportedProductCurrency {
  return typeof value === 'string' && supportedCurrencies.has(value);
}

export function safeProductPrice(input: {
  basePriceMinor?: string | null;
  currency?: string | null;
}) {
  if (
    typeof input.basePriceMinor !== 'string' ||
    !PRODUCT_PRICE_MINOR_PATTERN.test(input.basePriceMinor) ||
    !isSupportedProductCurrency(input.currency)
  ) {
    return { basePriceMinor: null, currency: null };
  }
  return {
    basePriceMinor: input.basePriceMinor,
    currency: input.currency,
  };
}
