import type { MetadataRoute } from 'next';

const lastModified = new Date('2026-07-19T00:00:00Z');

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://shop.ifrunit.tech/',
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: 'https://shop.ifrunit.tech/guide',
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: 'https://shop.ifrunit.tech/scan',
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
  ];
}
