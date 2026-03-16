# Deep Audit Report — 16.03.2026

## Executive Summary

**12 audit domains checked. 7 issues found and fixed. 0 critical security issues.**

---

## FIXED (this commit)

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | Test count "444" in telegram bot `roadmap.js` + `tokenomics.js` | HIGH | → 578 |
| 2 | Test count "494" in `ai-copilot/server/index.ts` dev welcome | HIGH | → 578 |
| 3 | Wiki page count "25" in `VERCEL_ENV.md` | MEDIUM | → 26 |
| 4 | Wiki page count "16" in `PROJECT-SUMMARY.md` (2 places) | MEDIUM | → 26 |
| 5 | Wiki page count "16" in `WEBSITE_AUDIT_REPORT.md` | MEDIUM | → 26 |
| 6 | Multisig "2-of-4" in `DEPLOYMENTS.md` | MEDIUM | → 3-of-5 |
| 7 | `protocol-plan.html` missing from `sitemap.xml` | MEDIUM | Added |

## VERIFIED OK

| Domain | Status |
|--------|--------|
| Bootstrap allocation (200M) | All files correct |
| Bootstrap dates (07.03/05.06) | All files correct, no old dates |
| Vesting beneficiary (0x04FA) | Correct everywhere |
| Contract addresses | Consistent across all files |
| Private keys in code | **NONE FOUND** |
| .env in git history | **NEVER COMMITTED** |
| Sitemap vs wiki files | 27 URLs / 26 wiki files (after fix) |
| robots.txt AI bots | GPTBot/ClaudeBot/PerplexityBot all allowed |
| Canonical tags | All 26 wiki pages have canonical |
| Meta descriptions | All 26 wiki pages have meta description |
| 48h governance timelock | Consistently documented |

## KNOWN OPEN ITEMS (in TODO.md)

- Proposals #7/#8/#9 queued (execute after 17.03.2026 23:00 UTC)
- Proposal #10 (transferOwnership) pending
- Android MetaMask deep-link bug (low priority)
- npm audit: 34 vulnerabilities (node_modules, not contracts)

## Historical Values (correct, not bugs)

- `CHANGELOG.md`: 194.75M references are historical records
- `BOOTSTRAP_VAULT_SPEC.md`: 194.75M is the original spec
- `multisig.html`: Phase 2b "2-of-4" is historical roadmap entry
- `MULTISIG_SETUP.md`: "2-of-4" references planned phases
