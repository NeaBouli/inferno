# Lighthouse Optimierung — Landing Page

Stand: 26. Februar 2026

## Durchgefuehrte Optimierungen

### SEO (Open Graph + Twitter Card)

| Meta Tag | Wert |
|----------|------|
| `og:title` | Inferno ($IFR) — The Deflationary Utility Token |
| `og:description` | Lock IFR to unlock lifetime premium access. 2.5% burned per transfer. Community Fair Launch. |
| `og:type` | website |
| `og:url` | https://neabouli.github.io/inferno/ |
| `og:image` | https://neabouli.github.io/inferno/assets/ifr_logo.png |
| `og:site_name` | Inferno ($IFR) |
| `twitter:card` | summary_large_image |
| `twitter:site` | @IFRtoken |
| `twitter:title` | Inferno ($IFR) — The Deflationary Utility Token |
| `twitter:description` | Lock IFR to unlock lifetime premium access. 2.5% burned per transfer. Community Fair Launch. |
| `twitter:image` | https://neabouli.github.io/inferno/assets/ifr_logo.png |
| `robots` | index, follow |
| `theme-color` | #ff4500 |
| `canonical` | https://neabouli.github.io/inferno/ |

### Bereits vorhanden

| Optimierung | Status |
|-------------|--------|
| `<meta charset="UTF-8">` | OK |
| `<meta name="viewport">` | OK |
| `<meta name="description">` | OK |
| `<title>` | OK |
| `<link rel="icon">` | OK (token.png) |
| `<html lang="en">` | OK |
| Font Preconnect | OK (googleapis + gstatic) |
| Responsive Design | OK (CSS media queries) |

### Empfohlene naechste Schritte

1. **Performance**: Lazy-load Bilder unterhalb des Folds (z.B. Partner-Logos)
2. **Accessibility**: Alt-Texte fuer dekorative Bilder pruefen
3. **PWA**: `manifest.json` + Service Worker fuer Offline-Support
4. **Structured Data**: JSON-LD fuer Crypto Token Schema (schema.org)
5. **Image Optimization**: WebP-Varianten der PNG-Assets

### Lighthouse Score Schaetzung (pre-run)

| Kategorie | Erwartung |
|-----------|-----------|
| Performance | 85-95 |
| Accessibility | 80-90 |
| Best Practices | 90-100 |
| SEO | 95-100 |

*Tatsaechliche Lighthouse Scores nach Deploy ueber Chrome DevTools verifizieren.*

---
*Datei: docs/index.html*
