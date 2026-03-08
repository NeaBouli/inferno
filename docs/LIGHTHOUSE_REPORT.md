# Lighthouse Optimization — Landing Page

As of: 26 February 2026

## Optimizations Performed

### SEO (Open Graph + Twitter Card)

| Meta Tag | Value |
|----------|-------|
| `og:title` | Inferno ($IFR) — The Deflationary Utility Token |
| `og:description` | Lock IFR to unlock lifetime premium access. 2.5% burned per transfer. Community Fair Launch. |
| `og:type` | website |
| `og:url` | https://neabouli.github.io/inferno/ |
| `og:image` | https://neabouli.github.io/inferno/assets/ifr_icon_4096.png |
| `og:site_name` | Inferno ($IFR) |
| `twitter:card` | summary_large_image |
| `twitter:site` | @IFRtoken |
| `twitter:title` | Inferno ($IFR) — The Deflationary Utility Token |
| `twitter:description` | Lock IFR to unlock lifetime premium access. 2.5% burned per transfer. Community Fair Launch. |
| `twitter:image` | https://neabouli.github.io/inferno/assets/ifr_icon_4096.png |
| `robots` | index, follow |
| `theme-color` | #ff4500 |
| `canonical` | https://neabouli.github.io/inferno/ |

### Already Present

| Optimization | Status |
|-------------|--------|
| `<meta charset="UTF-8">` | OK |
| `<meta name="viewport">` | OK |
| `<meta name="description">` | OK |
| `<title>` | OK |
| `<link rel="icon">` | OK (ifr_icon_64.png) |
| `<html lang="en">` | OK |
| Font Preconnect | OK (googleapis + gstatic) |
| Responsive Design | OK (CSS media queries) |

### Crawling & Indexing

| File | Status |
|------|--------|
| `robots.txt` | Created (Allow: /, sitemap link) |
| `sitemap.xml` | Updated (15 URLs: landing + 14 wiki pages) |
| `canonical` | Set (https://neabouli.github.io/inferno/) |
| `robots` meta | Set (index, follow) |

### Recommended Next Steps

1. **Performance**: Lazy-load images below the fold (e.g., builder logos)
2. **PWA**: `manifest.json` + service worker for offline support
3. **Structured Data**: JSON-LD for Crypto Token Schema (schema.org)
4. **Image Optimization**: WebP variants of PNG assets

### Lighthouse Score Estimate (pre-run)

| Category | Expectation |
|----------|-------------|
| Performance | 85-95 |
| Accessibility | 80-90 |
| Best Practices | 90-100 |
| SEO | 95-100 |

*Verify actual Lighthouse scores after deploy via Chrome DevTools.*

---
*File: docs/index.html*
