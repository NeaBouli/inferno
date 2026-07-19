export const MAX_BUSINESS_CATEGORIES = 8;

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

export function publicBusinessProfile<T extends {
  categoriesJson: string;
  website?: string | null;
}>(business: T) {
  const { categoriesJson, ...publicFields } = business;
  return {
    ...publicFields,
    ...(Object.prototype.hasOwnProperty.call(business, 'website')
      ? { website: safeBusinessWebsite(business.website ?? null) }
      : {}),
    categories: parseBusinessCategories(categoriesJson),
  };
}
