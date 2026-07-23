import type { MetadataRoute } from 'next';

const lastModified = new Date('2026-07-19T00:00:00Z');
const siteOrigin = 'https://shop.ifrunit.tech';
const apiOrigin = process.env.BENEFITS_API_INTERNAL_URL || 'http://localhost:3001';

export const revalidate = 3600;
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${siteOrigin}/`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${siteOrigin}/guide`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${siteOrigin}/scan`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
  ];

  try {
    const response = await fetch(`${apiOrigin}/api/businesses/catalog-index`, {
      next: { revalidate },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return staticRoutes;
    const payload = await response.json() as {
      catalogs?: Array<{ businessId: string; businessRef?: string; lastModified: string }>;
    };
    if (!Array.isArray(payload.catalogs)) return staticRoutes;
    const catalogs = payload.catalogs.flatMap((catalog) => {
      const businessRef = catalog.businessRef || catalog.businessId;
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(businessRef)) return [];
      const modified = new Date(catalog.lastModified);
      if (!Number.isFinite(modified.getTime())) return [];
      return [{
        url: `${siteOrigin}/s/${encodeURIComponent(businessRef)}`,
        lastModified: modified,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      }];
    });
    return [...staticRoutes, ...catalogs];
  } catch {
    return staticRoutes;
  }
}
