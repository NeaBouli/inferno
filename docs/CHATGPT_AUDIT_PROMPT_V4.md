# ChatGPT Independent Audit Prompt — V4

As of: March 2026 | 10 On-Chain Components | 578 tests | 91% Branch Coverage

## Instructions

Copy this prompt into ChatGPT (GPT-4o) and run the 8 self-checks.
Each check verifies a specific aspect of the project against the current codebase.

---

## Self-Check A: Anti-Sybil Middleware Present

Check whether the Points Backend (`apps/points-backend/src/middleware/`) contains the following files:
1. `lockProof.ts` — On-chain IFR Lock verification (min 1000 IFR, Bronze tier)
2. `captcha.ts` — Cloudflare Turnstile verification

**PASS criteria:**
- `lockProof.ts` exists and contains `isLocked(wallet, minAmount)` call
- `captcha.ts` exists and contains Cloudflare Turnstile URL
- Fail-closed pattern in lockProof (503 on RPC error, not fail-open)
- Dev bypass in captcha only when `CAPTCHA_SECRET` is empty (not based on NODE_ENV)

---

## Self-Check B: Creator Gateway SIWE Auth

Check whether `apps/creator-gateway/src/routes/auth.ts` implements SIWE (Sign-In with Ethereum):
1. `GET /auth/siwe/nonce` — Generates nonce with 10-minute TTL
2. `POST /auth/siwe/verify` — Verifies SIWE signature, checks nonce + Chain ID, returns JWT

**PASS criteria:**
- `siwe` package imported (`SiweMessage`, `generateNonce`)
- Nonce store with TTL (not unlimited)
- Chain ID validation against `CONFIG.chainId`
- JWT is only issued after successful verification
- Legacy `/wallet` endpoint remains for backward compatibility

---

## Self-Check C: PartnerVault Integration Tests

Check whether `test/PartnerVault.test.js` contains a `describe("Integration: full lifecycle")` block:

**PASS criteria:**
- At least 5 integration tests present
- Full lifecycle test: create → activate → milestone → lockReward → vest → claim
- Multi-partner test with independent vesting timelines
- Anti-double-count tested in integration
- authorizedCaller tested in integration
- Guardian pause/unpause tested in integration

---

## Self-Check D: Test Number Consistency

Check whether the following numbers are consistent across all docs:

| Metric | Target Value |
|--------|-------------|
| Contract Tests | 367 |
| Creator Gateway Tests | 41 |
| Points Backend Tests | 20 |
| Benefits Network Tests | 16 |
| Total Tests | 578 |
| Branch Coverage | 91% |

**Files to check:**
- README.md
- STATUS-REPORT.md
- docs/PROJECT-SUMMARY.md
- docs/ONE-PAGER.md
- docs/PRESS_KIT.md
- docs/COVERAGE_REPORT.md
- docs/AUDIT_SUBMISSION.md
- docs/AUDIT_BRIEF.md
- docs/wiki/security.html
- docs/index.html

**PASS:** No outdated numbers (276, 315, 330, 339, 361, 369, 436) in the listed files.

---

## Self-Check E: AI Copilot Wiki RAG

Check whether `apps/ai-copilot/server/wiki-rag.ts` exists and:
1. Loads wiki documents (HTML parsing)
2. Generates mode-specific system prompts (Customer, Builder, Developer)
3. Is integrated in `apps/ai-copilot/server/index.ts`

**PASS criteria:**
- File exists at `apps/ai-copilot/server/wiki-rag.ts`
- At least 3 modes defined
- HTML parsing (cheerio or regex)
- System prompt generation exported

---

## Self-Check F: EIP-712 Voucher Validation Endpoint

Check whether `apps/points-backend/src/routes/voucher.ts` has a GET `/validate/:nonce` endpoint:

**PASS criteria:**
- Route exists and returns status + expiry date
- Nonce-based query (not wallet-based)
- Distinction: unused, redeemed, expired, unknown

---

## Self-Check G: Numbers in CHANGELOG Up to Date

Check whether `docs/CHANGELOG.md` in the [Unreleased] section contains the current numbers:

**PASS criteria:**
- Contract test counter mentioned (367 or current)
- Total tests mentioned (578)
- Branch coverage mentioned (91%)
- New files listed (lockProof.ts, captcha.ts, siwe.test.ts)

---

## Self-Check H: Deployment Complete

Check whether `docs/DEPLOYMENTS.md` and `README.md` list all on-chain components:

**PASS criteria:**
- 10 addresses listed (InfernoToken, LiquidityReserve, Vesting, BuybackVault, BurnReserve, Governance, IFRLock, PartnerVault, FeeRouterV1, LP Pair)
- All verified on Etherscan
- Ownership transfer to Governance mentioned

---

## Result Template

| Check | Status | Comment |
|-------|--------|---------|
| A) Anti-Sybil Middleware | ? | |
| B) Creator Gateway SIWE | ? | |
| C) PartnerVault Integration | ? | |
| D) Test Number Consistency | ? | |
| E) AI Copilot Wiki RAG | ? | |
| F) EIP-712 Voucher Validate | ? | |
| G) CHANGELOG Up to Date | ? | |
| H) Deployment Complete | ? | |

**Total:** ?/8 PASS
