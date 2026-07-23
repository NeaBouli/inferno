const MIN_BUSINESS_SLUG_LENGTH = 3;
const MAX_BUSINESS_SLUG_LENGTH = 48;
const RESERVED_BUSINESS_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'benefits',
  'guide',
  'help',
  'ifr',
  'inferno',
  'new',
  'root',
  'scan',
  'seller',
  'shop',
  'support',
  'www',
]);
const CUID_LIKE_PATTERN = /^c[a-z0-9]{24}$/;
const BUSINESS_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BUSINESS_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const SHOP_ORIGIN = 'https://shop.ifrunit.tech';

export function normalizeBusinessSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_BUSINESS_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

export function suggestBusinessSlug(name: string): string {
  const normalized = normalizeBusinessSlug(name);
  return normalized.length >= MIN_BUSINESS_SLUG_LENGTH
    ? normalized
    : `ifr-${normalized || 'partner'}`;
}

export function businessSlugError(value: string): string {
  if (
    value.length < MIN_BUSINESS_SLUG_LENGTH ||
    value.length > MAX_BUSINESS_SLUG_LENGTH ||
    !BUSINESS_SLUG_PATTERN.test(value) ||
    normalizeBusinessSlug(value) !== value
  ) {
    return 'Use 3-48 lowercase letters, numbers or single hyphens.';
  }
  if (RESERVED_BUSINESS_SLUGS.has(value) || CUID_LIKE_PATTERN.test(value)) {
    return 'This seller URL is reserved.';
  }
  return '';
}

export function businessPublicReference(business: { id: string; slug?: string | null }) {
  return business.slug || business.id;
}

export function parseBusinessReference(value: string): string {
  const raw = value.trim();
  if (BUSINESS_REFERENCE_PATTERN.test(raw)) return raw;

  try {
    const parsed = new URL(raw, `${SHOP_ORIGIN}/`);
    if (
      parsed.origin !== SHOP_ORIGIN ||
      parsed.search ||
      parsed.hash
    ) {
      return '';
    }
    const match = parsed.pathname.match(/^\/[bs]\/([A-Za-z0-9_-]{1,80})\/?$/);
    return match?.[1] || '';
  } catch {
    return '';
  }
}
