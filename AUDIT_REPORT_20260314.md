# IFR Repo Audit Report
**Date:** 2026-03-14
**Repo:** /Users/gio/Desktop/inferno
**Branch:** main @ `17e47a9a`

---

## 1. Hardcoded Values — Update-Pflicht

### 🔴 Test-Zahlen (KRITISCH — 19 veraltete Stellen)

**Aktuell korrekt: 568 tests (521 protocol + 47 ecosystem)**

| Datei | Zeile | Alter Wert | Status |
|-------|-------|------------|--------|
| `SKYWALKER.md` | 84 | 444 | 🔴 VERALTET |
| `SKYWALKER.md` | 224 | 494 | 🔴 VERALTET |
| `docs/WHITEPAPER.md` | 192 | 494 | 🔴 VERALTET |
| `docs/COVERAGE_REPORT.md` | 3, 62 | 494 | 🔴 VERALTET |
| `docs/PATCH-GUIDELINES.md` | 101 | 494 | 🔴 VERALTET |
| `docs/CONTRIBUTING.md` | 63 | 494 | 🔴 VERALTET |
| `docs/SECURITY_POLICY.md` | 69 | 494 | 🔴 VERALTET |
| `docs/AUDIT_SUBMISSION.md` | 15 | 494 | 🔴 VERALTET |
| `docs/CHATGPT_AUDIT_PROMPT_V4.md` | 3, 65 | 494 / 444 | 🔴 VERALTET |
| `docs/ROADMAP.md` | 19 | 494 | 🔴 VERALTET |
| `docs/wiki/faq.html` | 488, 946 | 494 | 🔴 VERALTET |
| `docs/wiki/press-kit.html` | 567, 742 | 494 | 🔴 VERALTET |
| `docs/wiki/one-pager.html` | 608, 644 | 494 | 🔴 VERALTET |
| `docs/wiki/roadmap.html` | 571 | 494 | 🔴 VERALTET |
| `apps/ai-copilot/src/context/system-prompts.ts` | 56, 108 | 494 | 🔴 VERALTET |
| `reports/docs-status.md` | 20 | 444 | 🔴 VERALTET |
| `audit/summary.md` | 9 | 444 | 🔴 VERALTET |
| `audit/contracts/token-audit.md` | 23 | 444 | 🔴 VERALTET |

**Korrekte Dateien (568):** README.md, docs/DOCS.md, docs/index.html, docs/wiki/security.html ✅

---

### 🟡 Wiki-Seitenanzahl (8 veraltete Stellen)

**Aktuell korrekt: 25 Seiten** (tatsächlich gezählt in `docs/wiki/`)

| Datei | Zeile | Alter Wert | Status |
|-------|-------|------------|--------|
| `docs/wiki/index.html` | 7, 424, 435 | 24 | 🟡 VERALTET |
| `docs/wiki/one-pager.html` | 655 | 24 | 🟡 VERALTET |
| `SKYWALKER.md` | 86 | 16 | 🟡 VERALTET |
| `reports/docs-status.md` | 22 | 16 | 🟡 VERALTET |
| `reports/docs-watchdog-report.md` | 14 | 16 | 🟡 VERALTET |
| `docs/PROJECT-SUMMARY.md` | 96 | 16 | 🟡 VERALTET |
| `docs/VERCEL_ENV.md` | 70 | 16 | 🟡 VERALTET |
| `docs/WEBSITE_AUDIT_REPORT.md` | 104, 176 | 16 | 🟡 VERALTET |

**Korrekte Datei (25):** docs/DOCS.md ✅

---

### 🟢 Bootstrap Dates — KONSISTENT ✅

Alle Stellen zeigen: **Start 17.04.2026 / End 05.06.2026** (on-chain endTime korrigiert 15.03.2026)
- `docs/wiki/bootstrap.html` ✅
- `apps/ai-copilot/src/context/ifr-knowledge.ts` ✅
- `apps/ai-copilot/src/context/system-prompts.ts` ✅
- `apps/ai-copilot/server/index.ts` ✅

### 🟢 Token Supply — KONSISTENT ✅

1B IFR total, 194.75M Bootstrap — überall identisch.

### 🟢 Contract-Adressen — KONSISTENT ✅

Alle 14 Adressen stimmen in docs/, apps/, DEPLOYMENTS.md überein.

---

## 2. SEO/LLMO Lücken

### 🔴 Fehlende Canonical URLs (25 Seiten)

Alle 25 Wiki-Seiten haben **kein** `<link rel="canonical">`. Nur `docs/index.html` hat eines.

**Betroffen:** Alle `docs/wiki/*.html`

### 🟡 Fehlende JSON-LD (1 Seite)

| Datei | Status |
|-------|--------|
| `docs/wiki/verify.html` | ❌ Kein `application/ld+json` Schema |

Alle anderen 25 Seiten haben JSON-LD. ✅

### 🟡 Sitemap unvollständig (1 fehlende URL)

`docs/sitemap.xml` hat 27 URLs, aber es fehlt:
- `https://ifrunit.tech/wiki/verify.html`

(`/wiki/` ist als `/wiki/` gelistet → deckt index.html ab)

### 🟢 Meta Description — VOLLSTÄNDIG ✅
Alle 26 HTML-Seiten haben `<meta name="description">`.

### 🟢 OG Tags — VOLLSTÄNDIG ✅
Alle 26 HTML-Seiten haben `og:title` + `og:description`.

### 🟢 H1 Tags — VOLLSTÄNDIG ✅
Alle 26 HTML-Seiten haben mindestens ein `<h1>`.

### 🟢 Image Alt-Tags — VOLLSTÄNDIG ✅
Alle `<img>` Tags haben `alt=` Attribute.

### 🟢 robots.txt — VORHANDEN ✅
Erlaubt alle Bots inkl. ClaudeBot, PerplexityBot.

---

## 3. Inkohärenzen

### 🔴 Test-Count Abweichungen

| Quelle | Wert | Korrekt? |
|--------|------|----------|
| README.md | 556 (521+35) | ✅ |
| docs/index.html | 568 | ✅ |
| docs/wiki/security.html | 568 | ✅ |
| docs/DOCS.md | 568 | ✅ |
| docs/wiki/faq.html | **494** | ❌ |
| docs/wiki/press-kit.html | **494** | ❌ |
| docs/wiki/one-pager.html | **494** | ❌ |
| docs/wiki/roadmap.html | **494** | ❌ |
| docs/WHITEPAPER.md | **494** | ❌ |
| SKYWALKER.md | **494 / 444** | ❌ |
| Ali Copilot system-prompts.ts | **494** | ❌ |

### 🟡 Wiki-Seitenanzahl Abweichung

Tatsächlich: 25 Seiten. Behauptet: 16 (SKYWALKER), 24 (wiki/index), 25 (DOCS.md).

### 🟢 Contract-Adressen — KONSISTENT ✅

### 🟢 Roadmap Phasen — KONSISTENT ✅

Phase 1 ✅ Complete, Phase 2 🔄 In Progress, Phase 3–5 geplant.

---

## 4. Developer Marker — TODO-Kommentare

Folgende Dateien brauchen `<!-- IFR_UPDATE: TEST_COUNT -->` bzw. `// IFR_UPDATE: TEST_COUNT` Marker:

### TEST_COUNT Marker (bei jedem Sprint aktualisieren)
```
docs/wiki/faq.html:488
docs/wiki/faq.html:946
docs/wiki/press-kit.html:567
docs/wiki/press-kit.html:742
docs/wiki/one-pager.html:608
docs/wiki/one-pager.html:644
docs/wiki/roadmap.html:571
docs/wiki/security.html:775
docs/wiki/security.html:780
docs/index.html:1548
docs/index.html:2086
docs/index.html:2156
docs/index.html:2210
docs/index.html:2260
README.md:11
README.md:94
```

### WIKI_PAGE_COUNT Marker (bei neuer Wiki-Seite aktualisieren)
```
docs/wiki/index.html:7
docs/wiki/index.html:424
docs/wiki/index.html:435
docs/wiki/one-pager.html:655
docs/DOCS.md:139
docs/sitemap.xml (neue URL hinzufügen)
```

### CONTRACT_COUNT Marker (bei neuem Contract aktualisieren)
```
README.md:11
docs/index.html:2115
docs/wiki/contracts.html:8
docs/wiki/security.html:775
```

---

## 5. Priorisierte Aktionsliste

### 🔴 SOFORT (19 Dateien betroffen)

- [ ] Test-Count 494→556 in: faq.html, press-kit.html, one-pager.html, roadmap.html
- [ ] Test-Count 494→556 in: WHITEPAPER.md, COVERAGE_REPORT.md, PATCH-GUIDELINES.md, CONTRIBUTING.md, SECURITY_POLICY.md, AUDIT_SUBMISSION.md, CHATGPT_AUDIT_PROMPT_V4.md, ROADMAP.md
- [ ] Test-Count 494→556 in: apps/ai-copilot/src/context/system-prompts.ts (Ali kennt falsche Zahl!)
- [ ] Test-Count 444→556 in: SKYWALKER.md:84, audit/summary.md, audit/contracts/token-audit.md, reports/docs-status.md
- [ ] Test-Count 494→556 in: SKYWALKER.md:224
- [ ] Wiki-Count 24→25 in: wiki/index.html (3x), wiki/one-pager.html
- [ ] Wiki-Count 16→25 in: SKYWALKER.md, reports/docs-status.md, reports/docs-watchdog-report.md, PROJECT-SUMMARY.md

### 🟡 NÄCHSTER SPRINT

- [ ] Canonical URLs für alle 25 Wiki-Seiten hinzufügen
- [ ] JSON-LD Schema für verify.html hinzufügen
- [ ] Sitemap: verify.html ergänzen, lastmod-Daten aktualisieren
- [ ] TODO-Marker in Quellcode einfügen (IFR_UPDATE Kommentare)

### 🟢 LANGFRISTIG

- [ ] Build-Script das Test-Count automatisch in Docs injiziert
- [ ] Canonical-URL Generator für Wiki-Seiten
- [ ] Automated sitemap generation auf Basis von `docs/wiki/*.html`
- [ ] docs/WEBSITE_AUDIT_REPORT.md: historische 444-Referenzen OK (Audit-Snapshot)
- [ ] docs/VERCEL_ENV.md: "16 wiki pages" → 25

---

*Report generiert: 2026-03-14 | Audit-Scope: docs/, apps/, contracts/, README.md, SKYWALKER.md*
