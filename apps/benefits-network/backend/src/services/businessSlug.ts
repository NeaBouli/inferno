import { Prisma } from '@prisma/client';
import { prisma } from './sessionService';

export const MIN_BUSINESS_SLUG_LENGTH = 3;
export const MAX_BUSINESS_SLUG_LENGTH = 48;

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

export class BusinessSlugError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 409 = 400
  ) {
    super(message);
    this.name = 'BusinessSlugError';
  }
}

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

export function assertCanonicalBusinessSlug(value: string): string {
  if (
    value.length < MIN_BUSINESS_SLUG_LENGTH ||
    value.length > MAX_BUSINESS_SLUG_LENGTH ||
    !BUSINESS_SLUG_PATTERN.test(value) ||
    normalizeBusinessSlug(value) !== value
  ) {
    throw new BusinessSlugError(
      `Seller URL must be ${MIN_BUSINESS_SLUG_LENGTH}-${MAX_BUSINESS_SLUG_LENGTH} lowercase letters, numbers or single hyphens`
    );
  }
  if (RESERVED_BUSINESS_SLUGS.has(value) || CUID_LIKE_PATTERN.test(value)) {
    throw new BusinessSlugError('Seller URL is reserved');
  }
  return value;
}

export async function assertBusinessSlugAvailable(
  slug: string,
  excludeBusinessId?: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  const conflict = await db.business.findFirst({
    where: {
      ...(excludeBusinessId ? { id: { not: excludeBusinessId } } : {}),
      OR: [{ slug }, { id: slug }],
    },
    select: { id: true },
  });
  if (conflict) throw new BusinessSlugError('Seller URL is already in use', 409);
}

export async function resolveBusinessReference(
  reference: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<{ id: string; slug: string | null } | null> {
  if (!reference || reference.length > 80 || !/^[A-Za-z0-9_-]+$/.test(reference)) return null;
  return db.business.findFirst({
    where: { OR: [{ id: reference }, { slug: reference }] },
    select: { id: true, slug: true },
  });
}

export function publicBusinessReference(business: { id: string; slug?: string | null }) {
  return business.slug || business.id;
}
