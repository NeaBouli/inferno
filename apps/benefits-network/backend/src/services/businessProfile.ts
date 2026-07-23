export const MAX_BUSINESS_CATEGORIES = 8;
export const MAX_BUSINESS_SERVICE_AREA_LENGTH = 80;
export const MAX_BUSINESS_LOGO_URL_LENGTH = 500;

export function normalizeBusinessServiceArea(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > MAX_BUSINESS_SERVICE_AREA_LENGTH) return null;
  return normalized;
}

export function businessServiceAreaKey(value: string | null | undefined): string | null {
  return normalizeBusinessServiceArea(value)?.toLocaleLowerCase('en-US') ?? null;
}

export function serializeBusinessCategories(categories: string[]) {
  return JSON.stringify(categories);
}

export function parseBusinessCategories(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const categories: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const category = item.trim();
      const key = category.toLocaleLowerCase('en-US');
      if (!category || category.length > 80 || seen.has(key)) continue;
      categories.push(category);
      seen.add(key);
      if (categories.length === MAX_BUSINESS_CATEGORIES) break;
    }
    return categories;
  } catch {
    return [];
  }
}

export function safeBusinessWebsite(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function safeBusinessLogoUrl(value: string | null): string | null {
  if (!value || value.length > MAX_BUSINESS_LOGO_URL_LENGTH) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function publicBusinessProfile<T extends {
  categoriesJson: string;
  website?: string | null;
  logoUrl?: string | null;
  serviceArea?: string | null;
  serviceAreaKey?: string | null;
}>(business: T) {
  const { categoriesJson, serviceAreaKey: _serviceAreaKey, ...publicFields } = business;
  return {
    ...publicFields,
    ...(Object.prototype.hasOwnProperty.call(business, 'website')
      ? { website: safeBusinessWebsite(business.website ?? null) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(business, 'logoUrl')
      ? { logoUrl: safeBusinessLogoUrl(business.logoUrl ?? null) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(business, 'serviceArea')
      ? { serviceArea: normalizeBusinessServiceArea(business.serviceArea ?? null) }
      : {}),
    categories: parseBusinessCategories(categoriesJson),
  };
}
