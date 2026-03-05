# Page Update Checklist

Which files need to be updated for each type of event.

---

## After Every Commit

| File | What to Update |
|------|----------------|
| `README.md` | Test count, contract count, new features |
| `docs/DOCS.md` | Chronicle entry, file structure, modules, test count |
| `docs/CHANGELOG.md` | Add to [Unreleased] section |

## After Contract Changes

| File | What to Update |
|------|----------------|
| `README.md` | Contract list, architecture description |
| `docs/DOCS.md` | Module status, LOC, test count |
| `docs/index.html` | Stats (contract count, test count) |
| `docs/wiki/contracts.html` | Contract description, functions |
| `docs/wiki/security.html` | Slither findings, test coverage |
| `docs/TRANSPARENCY.md` | Update on-chain checks |
| `docs/wiki/transparency.html` | Sync HTML version |
| `docs/WHITEPAPER.md` | Architecture section, security |

## After Governance Actions

| File | What to Update |
|------|----------------|
| `docs/TRANSPARENCY.md` | Proposal status (Pending -> Executed) |
| `docs/wiki/transparency.html` | Update status badges |
| `docs/wiki/governance.html` | Add to proposal list |
| `CLAUDE.md` | Governance proposals table |
| `docs/DEPLOYMENTS.md` | New addresses if relevant |

## After Test Changes

| File | What to Update |
|------|----------------|
| `README.md` | Test count |
| `docs/DOCS.md` | Test count per file + total |
| `docs/index.html` | Stats section (X tests) |
| `docs/WHITEPAPER.md` | Security section |
| `docs/ONE-PAGER.md` | Key numbers |

## After App Changes (Dashboard/Copilot/Points/Benefits)

| File | What to Update |
|------|----------------|
| `docs/DOCS.md` | App status, file structure |
| `docs/DASHBOARD_TEST_RESULTS.md` | Build results |
| `docs/BENEFITS_E2E_RESULTS.md` | E2E results |
| `README.md` | App mentions |

## After On-Chain Events (Deploy, Transfer, Burn)

| File | What to Update |
|------|----------------|
| `docs/TRANSPARENCY.md` | Update numbers (supply, burned, balances) |
| `docs/wiki/transparency.html` | Sync HTML version |
| `docs/DEPLOYMENTS.md` | New contract addresses |
| `docs/ONE-PAGER.md` | Key numbers |
| `docs/PROJECT-SUMMARY.md` | Update numbers |

## After Adding Wiki Pages

| File | What to Update |
|------|----------------|
| All `docs/wiki/*.html` | Add sidebar links |
| `docs/wiki/index.html` | Quick Stats (page count) |
| `docs/DOCS.md` | Wiki page count, file structure |

## After Deploy (Sepolia or Mainnet)

| File | What to Update |
|------|----------------|
| `docs/DEPLOYMENTS.md` | All addresses + constructor args |
| `docs/TRANSPARENCY.md` | Complete on-chain audit |
| `CLAUDE.md` | Address table |
| `docs/MAINNET_CHECKLIST.md` | Update status |
| `docs/index.html` | Contract addresses (if displayed) |

---
*As of: March 2026*
