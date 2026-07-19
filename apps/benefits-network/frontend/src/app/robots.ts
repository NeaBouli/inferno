import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/guide', '/scan', '/s/'],
      disallow: ['/api/', '/b/', '/p/', '/r/'],
    },
    sitemap: 'https://shop.ifrunit.tech/sitemap.xml',
    host: 'https://shop.ifrunit.tech',
  };
}
