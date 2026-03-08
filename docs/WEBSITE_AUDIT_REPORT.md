# Website Coherence Audit Report

> **Date:** 2026-03-05
> **Scope:** All public-facing HTML pages (`docs/index.html`, `docs/wiki/*.html`) + markdown docs
> **Triggered by:** Post-mainnet deployment coherence check
> **Method:** Automated multi-agent audit + manual verification greps

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 7 | Outdated pre-mainnet text, Sepolia addresses in mainnet code examples |
| HIGH | 5 | Wrong test counts, wrong audit numbers, broken links, widget mismatch |
| MEDIUM | 3 | Sepolia-only LP data, TBA addresses, duplicate testnet address |
| PASS | 5 | Markdown docs (README, DEPLOYMENTS, DOCS, PROJECT-SUMMARY, MAINNET_CHECKLIST) |

**Total findings: 15 issues across HTML pages. All 5 markdown docs passed.**

---

## CRITICAL Issues

### C1: "Third-party audit before mainnet" (mainnet already deployed)

| File | Line | Text |
|------|------|------|
| `docs/index.html` | 1455 | "Third-party audit recommended before mainnet." |
| `docs/wiki/security.html` | 1005 | "Professional penetration test recommended before mainnet" |
| `docs/wiki/security.html` | 1033 | "A professional security audit...is strongly recommended before mainnet deployment." |
| `docs/wiki/faq.html` | 646 | "A professional third-party audit...is planned before mainnet launch." |

**Impact:** Users see "before mainnet" language on a project that IS on mainnet. Undermines credibility.
**Fix:** Replace with "recommended as next security milestone" or "planned for Q2 2026".

### C2: Sepolia addresses in mainnet code examples (`integration.html`)

| Line | Variable | Sepolia Address | Correct Mainnet Address |
|------|----------|-----------------|------------------------|
| 593 | `LOCK_ADDRESS` | `0x0Cab0A9440643128540222acC6eF5028736675d3` | `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` |
| 665 | `TOKEN_ADDRESS` | `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` |
| 896 | `VAULT_ADDR` | `0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39` | `0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D` |

**Impact:** Developers copy-pasting code examples will interact with non-existent Sepolia contracts on mainnet.
**Fix:** Replace all three addresses with mainnet equivalents. Add comment `// Ethereum Mainnet`.

### C3: "Mainnet deployment pending" (`deployment.html`)

| File | Line | Text |
|------|------|------|
| `docs/wiki/deployment.html` | 578 | "Mainnet deployment pending. Addresses will be published here after launch." |

**Impact:** Visitors think mainnet hasn't launched yet.
**Fix:** Add all 9 mainnet addresses to Section 2 of deployment.html.

---

## HIGH Issues

### H1: Wrong test count in landing page

| File | Line | Current | Correct |
|------|------|---------|---------|
| `docs/index.html` | 1675 | "367 tests" | "494 tests" |

**Fix:** Update to "494 tests" (367 contract + 41 Creator Gateway + 20 Points Backend + 16 Benefits Network).

### H2: Wrong test count in FAQ

| File | Line | Current | Correct |
|------|------|---------|---------|
| `docs/wiki/faq.html` | 646 | "361 automated tests" | "444 automated tests" |

**Fix:** Update to "444 automated tests with 99% statement coverage".

### H3: Wrong audit numbers in landing page

| File | Line | Current | Correct |
|------|------|---------|---------|
| `docs/index.html` | 1483 | "0 critical, 12 warnings, 78 checks passed" | "0 FAIL, 21 WARN, 81 PASS" |

**Fix:** Update to match actual Claude security audit results.

### H4: Broken documentation links (`integration.html`)

| File | Link Target | Status |
|------|-------------|--------|
| `docs/wiki/integration.html` | `../SDK_QUICKSTART.md` | File does not exist |
| `docs/wiki/integration.html` | `../YOUTUBE_INTEGRATION.md` | File does not exist |

**Fix:** Either create the referenced files or remove/update the links.

### H5: Widget code inconsistency (index.html vs wiki pages)

| Component | `docs/index.html` | `docs/wiki/*.html` (16 pages) |
|-----------|-------------------|-------------------------------|
| Button ID | `ifr-btn` | `ifr-copilot-btn` |
| Panel ID | `ifr-panel` | `ifr-copilot-window` |
| Toggle | inline `onclick` | `toggleCopilot()` function |
| Localhost guard | None | `if (window.location.hostname === 'localhost') return;` |

**Impact:** Widget may not work on wiki pages (localhost guard blocks testing). Inconsistent UX.
**Fix:** Align all 16 wiki pages to the `ifr-btn`/`ifr-panel` minimal widget pattern.

---

## MEDIUM Issues

### M1: LP Pair section has Sepolia-only data (`contracts.html`)

| File | Lines | Issue |
|------|-------|-------|
| `docs/wiki/contracts.html` | 1987-2028 | LP Pair address `0x2252e8bB...` is Sepolia. Pool shows "0.01 ETH (Sepolia testnet)". |

**Fix:** Add mainnet LP Pair address once created. Mark Sepolia data as testnet reference.

### M2: BootstrapVault mainnet address "TBA" (`bootstrap.html`)

| File | Line | Text |
|------|------|------|
| `docs/wiki/bootstrap.html` | 598 | `<tr><td>Mainnet</td><td>TBA</td></tr>` |

**Fix:** BootstrapVault was not deployed on mainnet (testnet-only). Either note "Sepolia only" or add the testnet address with context.

### M3: FeeRouterV1 and BootstrapVault share same address (`testnet.html`)

| File | Lines | Issue |
|------|-------|-------|
| `docs/wiki/testnet.html` | 464, 472 | Both contracts show `0xE0E8F76e4fb38B2e367Aee043a2C02b8D1c7c037` |

**Fix:** Verify if BootstrapVault has a separate Sepolia address or document the address sharing.

---

## PASSED Checks

### Markdown Documentation (all 5 files PASS)

| File | Test Count | Contract Count | Addresses | Language |
|------|-----------|----------------|-----------|----------|
| `README.md` | 444 correct | 9 mainnet correct | All mainnet correct | English only |
| `docs/DEPLOYMENTS.md` | N/A | 9 mainnet correct | All 9 verified | English only |
| `docs/DOCS.md` | 444 correct | 10 (9+1 testnet) | Correct | English only |
| `docs/PROJECT-SUMMARY.md` | 444 correct | 10 correct | All mainnet correct | English only |
| `docs/MAINNET_CHECKLIST.md` | 444 correct | 9 correct | N/A | English only |

### Landing Page (`docs/index.html`) — Passed Checks

- Domain: All references use `ifrunit.tech` (no `ifrunit.tech`)
- Mainnet badge: Green "Ethereum Mainnet" badge visible
- Coin animation: All 3 keyframe animations present (`coinSpin`, `coinSpinFast`, `shadowPulse`)
- Contract addresses: All 9 mainnet addresses correct with copy buttons
- Etherscan links: Point to mainnet (`etherscan.io`, not `sepolia.etherscan.io`)
- No German text detected
- Roadmap section present with proper `#roadmap` anchor

### AI Copilot Widget

- Railway URL (`https://ifr-ai-copilot-production.up.railway.app`) present in all 17 HTML files
- No references to old Vercel URL (`ifr-copilot.vercel.app`)

---

## Fix Priority

### Priority 1 — Immediate (user-facing credibility)
1. C1: Remove "before mainnet" audit language (4 locations)
2. C2: Replace Sepolia addresses in integration.html code examples (3 addresses)
3. C3: Add mainnet addresses to deployment.html Section 2
4. H1+H2: Fix test counts to 444 (index.html + faq.html)

### Priority 2 — High (developer-facing accuracy)
5. H3: Fix audit numbers in index.html
6. H4: Fix or remove broken .md links in integration.html
7. H5: Align widget code across all 16 wiki pages

### Priority 3 — Medium (completeness)
8. M1: Update LP Pair section in contracts.html
9. M2: Clarify BootstrapVault status in bootstrap.html
10. M3: Verify testnet address duplication

---

*Generated by automated multi-agent audit. All findings verified with grep.*
