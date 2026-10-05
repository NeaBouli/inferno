# Changelog

## 5 October 2026 — Lending Market Page Shows LendingVault V1 as Retired (T-271)

- `docs/wiki/lending-market.html`: title, meta, Open Graph, Twitter and JSON-LD descriptions no longer call
  the market live. A visible RETIRED notice near the top uses the canonical wording: V1 retired by owner
  decision (3 October 2026); borrowing stays disabled (`ifrPriceWei = 0`, no activation planned or
  authorized) and lenders are withdrawing their offers; those IFR are not lost. No V2 is planned until a
  reviewed price source exists.
- The page no longer guides lenders to create offers; the offer table always shows a read-only "View"
  action and never a borrow call to action. Withdraw guidance (`withdrawOffer`) and the read-only on-chain
  stats stay.
- Copilot knowledge (`ifr-knowledge.ts`): the LendingVault entry and the Web3 distinction now state V1 is
  retired (withdraw only) instead of describing a live lender offer flow; wiki RAG content regenerated.
- `docs/wiki/lending-vault.html`: metadata no longer says live; a visible RETIRED notice replaces the live
  banner. The guided lender flow and the create/increase offer form are hidden, and the offer handler refuses
  to send any `createOffer`/`increaseOffer` transaction. `withdrawOffer` stays and now allows the full
  available amount (the old 1 IFR keep-alive only served later offer increases).
- `docs/llms.txt`, `docs/GOVERNANCE_PRODUCT_DECISION_REGISTER.md` (Lane 1 current truth) and
  `docs/COINMARKETCAP_SUBMISSION.md` describe LendingVault V1 as retired, withdraw only.
- Borrowing on the wiki stays disabled regardless of the read `ifrPriceWei`: the "Request Loan" form on
  `lending-vault.html` is hidden behind a retired note, the button is never re-enabled, the loan preview no
  longer computes collateral, and the borrow handler refuses before any wallet call. The Lending Market
  borrower and repayment steps no longer describe a future borrow path.
- New Playwright spec `tests/browser/lending-retired.spec.js` (in `test:landing-wiki-ui`): with a mocked
  non-zero price, forced borrow and create-offer clicks send no transaction; withdraw max sends
  `withdrawOffer` with exactly the full available amount (12,345,678.123456789 IFR fixture). Further mocked
  regressions: exact full withdrawal of 1 IFR, 0.999999999 IFR and 0.000000001 IFR; refusal above the
  available amount and without an active offer; explicit create and increase refusal; the borrow lock holds
  after the handler and after a 60-second market refresh.
- Copilot system prompt: the Web3 lending topic now says existing lenders only withdraw (no new offers, no
  borrowing) instead of inviting create/borrow "when on-chain pricing permits".
- The retired notes in the lending-vault Lender and Borrower tabs and the refusal messages use readable
  (WCAG AA) colours on the light skin.

## 5 October 2026 — Web3: LendingVault V1 Retired, Withdraw Only (T-273)

- LendingVault V1 retired by owner decision (3 October 2026): borrowing stays disabled (`ifrPriceWei = 0`,
  no activation planned or authorized) and lenders are withdrawing their offers; those IFR are not lost.
  No V2 is planned until a reviewed price source exists.
- `docs/web3/`: the three "Create offer" entry points (hero panel, Users tab, audience action table) now
  read "Withdraw offer"; the `?action=lending-offer` route opens the same withdraw dialog. The dialog shows
  the retired note, hides the deposit button and refuses the create/increase path before any wallet call
  (no approve, no `createOffer`/`increaseOffer`; both were removed from the page ABI). `withdrawOffer`
  stays, and "Use available" fills the full available amount (full withdrawal closes the offer).
- New borrowing is blocked permanently, regardless of `ifrPriceWei`: the borrow submit and "Use offer max"
  controls are hidden and disabled, the handler refuses before any wallet call (no approve, no collateral,
  no `borrow`), and the price shows "Disabled". The entry points read "Loans (borrowing closed)";
  existing-loan repay and top-up stay. `scripts/test-functionality-status.cjs` now pins the permanent
  wording instead of the old "until Governance sets ifrPriceWei" text (owner decision, stricter pin).
- The lending dialog status line no longer shares its selector with the note, so status updates land in
  the status line again.
- `tests/browser/web3-write.spec.js`: the `lending-create` send assertion is replaced by assertions that
  the create path sends no transaction and shows the retired notice, plus a full-amount `withdrawOffer`
  send. New test: with a mocked `ifrPriceWei > 0` borrowing stays blocked and a forced click sends no
  transaction.

## 5 October 2026 — Copilot Builder API: Configuration Score Wording (T-272)

- `POST /api/builder/generate` (copilot server) now returns the same wording as the Builder page:
  `scoreName: "Configuration Score"`, `label` "Strong setup" / "Partial setup" / "Weak setup" and the
  disclaimer "Configuration heuristic only — not audited, not a security audit or certification".
  Scoring math and the endpoint path are unchanged; the response key stays `security`.
- API change: `security.level` is now `strong` / `partial` / `weak` instead of `SAFE` / `MEDIUM` / `RISKY`.
  No consumer in the repository reads the old values (`docs/builder.html` scores locally).
- Copilot knowledge, system prompt and `llms.txt` describe the builder score as a Configuration Score.
  New test `npm run test:builder-score` in the copilot CI. Needs a copilot re-release to go live.

## 5 October 2026 — Governance Proposals #18–#21 Executed (Safe Round)

- #18 `FeeRouterV1.setVoucherSigner(0x790D99c320dafA03d83bEa152178A6523b49CA0d)`: 07:17:47 UTC, block 26124623,
  TX `0x40a856b9f994a17390c042abe851c5ff99ca86289eb86316eb119f465cd89679`. The points backend activated the same
  signer in the same minute (CWA-06 fixed and verified).
- #19/#20 `setGuardian(Treasury Safe)` on LiquidityReserve and BurnReserve: one Treasury Safe TX at 07:22:47 UTC,
  block 26124647, TX `0xa432f061d42d3cbf306e44cf27394da5f70443d8d765cb1cfea66e17be19df27`. All six mutable
  guardians are now the Treasury Safe (CWA-09 fixed and verified).
- #21 `InfernoToken.setPoolFeeReceiver(BuybackController)`: 07:25:23 UTC, block 26124660,
  TX `0x8de48b47dfa8f17b631fb744bc4deef9bbb68271f8b700b422cdd3abb739ca26`. New IFR pool fees are recoverable at
  BuybackController (CWA-02 fixed and verified).
- Permanently lost IFR as of block 26124660: 27,153,013.068435700 IFR (CV-01 26,418,467.994338353 + FeeRouterV1
  734,545.074097347). #21 stopped the pool-fee inflow to FeeRouterV1; direct transfers remain possible, so the
  Landing and the Copilot keep reading that part live.
- CWA register: 56 fixed and verified, 8 governance or owner gated.

## 4 October 2026 — Open Benefits Verification Version 2 (CommitmentVault V2)

- New specification `ifr-benefits-verify/2` (`docs/specs/ifr-benefits-verify-2.md`). It reads
  CommitmentVault V1 and V2 and sums their active TIME_ONLY tranches as one source; the sum is never
  added to IFRLock. Tier data is unchanged. Version 1 stays valid and unchanged; a `/1` result reads V1
  only and never exceeds the `/2` result.
- Reference library `ifr-benefits-verify` 1.1.0: `spec: "ifr-benefits-verify/2"` option, `/1` stays the
  default; messages can name either version (`expected.specs`, `benefitMessageSpec`). New vectors
  `vectors/v2.json` and a Mainnet-fork test with a real V2 lock.
- Benefits backend: optional `COMMITMENT_VAULT_V2_ADDRESS`; when set, the commitment source adds V2's
  active TIME_ONLY tranches to V1's at the same block, with the same identity checks.

## 3 October 2026 — One Default Tier Preset for Project Surfaces

- The AI Copilot (`/api/ifr/check`, knowledge and prompts) and `ifr-sdk` use one default tier preset,
  identical to the Benefits network: IFR locked in IFRLock only, Bronze 1,000 / Silver 2,500 /
  Gold 5,000 / Platinum 10,000. The separate Basic/Premium/Pro 500/2,000/10,000 access scheme is
  retired. `/api/ifr/check` now derives `tier` from locked IFR (`tierBasis: "locked"`) and fails
  closed when the IFRLock read fails; `hasAccess` still compares balance + locked with the caller's
  own `required` amount.
- The preset is a default, not a rule: Benefits partners set their own thresholds, held-IFR minimums,
  lock sources and discounts per benefit, and any project may verify IFR with its own rule under
  `ifr-benefits-verify/1`. Discounts are independent of PartnerVault rewards.

## 3 October 2026 — Public Council Vote Record (Lane 6)

- New wiki page [Council Votes](https://ifrunit.tech/wiki/council-votes.html) lists every ballot, its exact
  texts, each signed vote and the tally. The data lives in `docs/data/council-votes.json`.
- `scripts/verify-council-votes.cjs` checks in CI that every counted vote and every counted abstention is an
  EIP-191 signature over the exact published text of its choice on its own ballot (each text names its ballot
  id, so a signature cannot be reused for another ballot) and recovers to the wallet listed in the record; it
  does not verify Safe ownership on-chain. A record without such a signature is shown as unverified and not
  counted. The page is rendered from the data and checked for drift.
- Open ballots run through the Etherscan verified-signature procedure. Secret ballots are in planning as a
  separate milestone.
- Status: CV-01 open (2 of 3 YES; one abstention unverified, not counted), EX-01 approved on 4 October 2026 (3 YES), EX-02 open (no option vote yet). No deadline.

## 3 October 2026 — Partner Rewards Model B (Lane 4)

- Decision recorded: partner rewards are valued in EUR and paid in IFR only for verified checkout
  redemptions at registered pilot partners, within a fixed per-partner budget, settled per Governance
  `recordMilestone` proposal. No lock-percentage reward, no authorized caller, no refill.
- Rewards remain inactive (0 partners, 0 rewarded). Policy: `docs/PARTNER_REWARDS_MODEL_B.md`.
- Landing, Web3 page, wiki (integration, tokenomics, lock mechanism, FAQ, one-pager, press kit, protocol
  plan, wallet guide, transparency, fair launch, contracts, business onboarding), Benefits seller copy,
  Copilot knowledge, README and docs no longer promise lock-triggered creator rewards, a "revenue share"
  of lock fees or a "10–20%" reward rate.

## 3 October 2026 — PriceLockVault Built, Price Locks Disabled (Lane 2)

- New `PriceLockVault` (source only, not deployed). Price conditions use a 7-day TWAP of the IFR/WETH pair;
  spot prices are never used.
- Every lock has a mandatory rescue time of at most 4 years; tokens always return to the locker and nobody can
  withdraw user funds.
- Price locks stay disabled until Governance activates them. Activation and every new lock revert unless the
  on-chain readiness scope (pool WETH depth and/or TWAP) holds. `readiness()` exposes progress.
- The rescue unlock makes no pair or oracle call, so a broken pair cannot block it.
- The pair is taken from the Uniswap V2 factory for IFR and the canonical WETH, never configured directly.
- The depth check samples two points (observation and now); this limit is documented in the specification.
- 25 unit tests and a Mainnet-fork test. An independent review is required before any deployment.

## 3 October 2026 — Permanently Lost IFR Disclosed Everywhere (T-202)

- The Landing, Transparency, Tokenomics, Press Kit, FEE_DESIGN, TRANSPARENCY.md and llms.txt now show the
  permanently lost IFR: 27,143,460.66 IFR at block 26,108,134. They are not burned and stay in `totalSupply()`.
  - 26,418,467.99 IFR in CommitmentVault V1 price-conditioned tranches (CV-01).
  - 724,992.67 IFR of pool fees in FeeRouterV1, which has no IFR withdrawal path (CWA-02).
- The Landing card reads the FeeRouterV1 part live. A failed or implausible read keeps the last verified figure
  with its date and never shows 0.
- Corrected the remaining claims that BuybackVault and BurnReserve receive the 1% IFR pool fee.
- Lane 3 decision (owner, 3 October 2026): future pool fees go to BuybackController. This is pending Governance
  execution; IFR already in FeeRouterV1 stays lost.
- Lane 1 decision (owner, 3 October 2026): LendingVault V1 is retired. Borrowing stays disabled by Governance decision (no activation planned or authorized) and
  no V2 is planned yet. Lending pages, the Web3 lending panel and the Landing say so; lenders can still withdraw
  unlent offers, and those IFR are not lost.

## 2 October 2026 — CommitmentVault V1 Incident Record and Council Proposal CV-01

- 11 price-conditioned CommitmentVault V1 tranches (26,418,467.994338353 IFR) cannot unlock. The
  deployed vault has no working price check. A Mainnet-fork simulation confirmed that no oracle or
  time setting can release them.
- New wiki page `commitment-vault-compensation.html`. It records the affected tranches with a
  status (red: Council pending; yellow: approved, awaiting a verified 7-day TWAP record; green:
  approved and TWAP verified with published blocks). Live spot data is shown as indicative only and
  never changes a status. It also records the open vote (2 of 3 required YES signatures, no
  deadline; not approved), the deployed TIME_ONLY CommitmentVault V2 and queued Governance
  proposal #17, and the urgent
  Council proposal CV-01, which compensates from the LP Reserve Safe by each tranche's original
  time and price conditions (7-day TWAP).
- The governance Council agenda and vote log list CV-01. The transparency page and the decision
  register record the permanently locked amount as non-circulating.

## 2 October 2026 — BuybackController Source Hardening

- `execute()` is now `nonReentrant`. A nested call from the router reverts with the reentrancy
  guard (tested).
- `withdrawIFR` requires a successful token transfer.
- The two corresponding reviewed Slither items are resolved: the unchecked-transfer entry is
  removed, and the baseline now has 5 reviewed High signals.
- Source only. The deployed Mainnet controller is unchanged and dormant.

## 2 October 2026 — Buyback Fee-on-Transfer Accounting for Future Deployments (JUL-08)

- BuybackController and BuybackVault sources now swap with
  `swapExactETHForTokensSupportingFeeOnTransferTokens`. They account for the IFR actually
  received (balance difference) instead of the router's quoted output. The previous quoted
  output overstated burned IFR, and the vault split could revert when IFR's transfer tax applied.
- Covered by taxed-router tests. The deployed Mainnet buyback contracts are unchanged and
  dormant. Activation requires a reviewed, governed redeploy. JUL-08 moves to
  "Governance or future-version gated".

## 1 October 2026 — Open, Permissionless Benefit Verification (`ifr-benefits-verify/1`)

- Published the open specification `docs/specs/ifr-benefits-verify-1.md` (MIT). It covers lock sources,
  the 9-decimal tier rule, block pinning, the momentary-check rule, the EIP-4361 wallet message profile,
  and fail-closed error codes.
- Published tier data `docs/specs/ifr-benefits-tiers.v1.json` (Bronze 1,000 / Silver 2,500 / Gold 5,000 /
  Platinum 10,000 IFR) with a pinned SHA-256.
- Added the MIT reference library `apps/benefits-verify` and language-neutral conformance vectors. The
  vectors run against a simulated node and against the real IFRLock and CommitmentVault contracts.
- Unified the wiki integration guide on the shared tier keys, and stated the MIT licence of
  `apps/benefits-network`.

## 1 October 2026 — Hardhat 3.18 / Mocha 12 Toolchain Batch

- Upgraded development tooling: hardhat 3.18.0, hardhat-ethers 4.2.0,
  hardhat-mocha 4.0.0 with mocha 12.0.3, and dotenv 18.0.5.
- Mocha 12 had been deferred because hardhat-mocha 3 did not support it;
  hardhat-mocha 4 now requires it. Mocha's js-yaml copy is deduplicated to the
  patched 5.4.2.
- Root `npm audit` still reports no vulnerabilities; all 644 contract tests pass.

## 1 October 2026 — hardhat-verify 3.1.2 Security Upgrade

- Upgraded the development-only `@nomicfoundation/hardhat-verify` plugin from
  3.1.0 to 3.1.2, which drops the Ethers-5 `@ethersproject/*` -> `elliptic`
  chain behind the Low advisory GHSA-848j-6mx2-7j84.
- The root `npm audit` now reports no vulnerabilities; the advisory baseline
  check requires a clean root audit instead of allowlisting the old chain.

## 6 September 2026 — LiquidityReserve Post-Lock Status Correction

- Reverified the Mainnet LiquidityReserve after its initial timelock ended:
  all 200M IFR remains held, 0 IFR has been withdrawn, and the current
  contract cap permits at most 50M IFR per 90-day period.
- Confirmed that no LiquidityReserve governance proposal is pending and that
  the elapsed timelock did not automatically add liquidity to Uniswap.
- Corrected current Landing, Wiki, roadmap, status and AI Copilot wording while
  retaining clearly historical bootstrap and changelog statements.

## 4 September 2026 — Wiki JSON-LD Regression Gate

- Added a fail-closed structured-data check across all tracked Wiki pages.
- The gate validates JSON syntax, Schema.org context, canonical URL matching,
  primary page metadata and present BreadcrumbList or FAQPage structures.
- Repaired incomplete FAQ metadata and copied URL/title metadata on the Open
  Audit Log and Protocol Plan pages found by the new gate.
- Wired the check into the Docs Validator JSON job.

## 4 September 2026 — Security Audit Toolchain Pins

- Pinned Security Audit jobs to the reviewed Ubuntu 24.04 runner.
- Pinned future Cargo and Python audit paths to Rust 1.88.0,
  `cargo-audit` 0.22.2 with Cargo lock resolution and `pip-audit` 2.10.1.
- Added a regression test that rejects floating action references, runners or
  top-level audit tools in the Security Audit workflow.

## 4 September 2026 — CI Token Least Privilege

- Added explicit top-level GitHub token permissions to every workflow.
- Restricted build, test, documentation and monitoring workflows to
  `contents: read`; the Security Audit additionally receives
  `pull-requests: read` for Gitleaks PR commit discovery.
- Preserved `contents: write` only for the existing Update Stats and
  Post-Deploy repository update workflows.
- Added a repository policy test covering a deliberate 16-workflow inventory
  and rejecting missing, unrelated or job-level token scopes.

## 4 September 2026 — Markdown Lint Regression Gate

- Replaced the floating global Markdownlint install and unconditional
  `|| true` with exact `markdownlint-cli@0.49.1` project tooling.
- Restricted analysis to the 179 Markdown files tracked by Git, excluding
  dependency and build directories by construction.
- Recorded the 3,482 historical findings as 2,174 line-independent
  fingerprints. CI now fails on every baseline change so cleanup and new
  regressions require explicit review instead of being silently ignored.

## 4 September 2026 — Bounded Mythril CI Delivery

- Added a hash-locked, path-scoped/weekly/manual Mythril runner for all 17
  concrete production contracts with two-transaction,
  30-second-per-contract symbolic analysis.
- Made the runner fail closed on process timeouts, malformed reports, missing
  execution evidence and hidden compiler/tool errors even when Mythril exits
  with status zero.
- Hash-locked the complete Python toolchain and pinned the official Linux
  amd64 solc 0.8.28 artifact digest.
- Four complete local runs finished in roughly six to seven minutes; all
  reported zero signals at any severity. This bounded result does not replace an independent
  professional audit or prove complete state-space coverage.
- Integrated the gate through PR #77 after exact-head and Main Linux CI passed.

## 4 September 2026 — Recursive Slither CI Delivery

- Added a pinned direct-solc Slither runner covering all 21 production
  Solidity sources; mocks and npm dependencies are excluded from the gate.
- Added a reviewed six-entry High baseline. CI fails closed on every Critical
  signal and any new, changed or stale High fingerprint rather than hiding
  detector output.
- Recorded `BuybackController.withdrawIFR()` return-value handling as a future,
  separately gated V2 hardening item. No Solidity source or Mainnet state was
  changed.
- Integrated the gate through PR #77 after exact-head and Main Linux CI passed.

## 4 September 2026 — Vault Invariant Monitor Delivery

- Added a read-only four-hour Mainnet monitor for CommitmentVault and
  LendingVault fee exemptions and custody coverage.
- Corrected the LendingVault invariant: liquid token custody is compared with
  `totalAvailable`; borrower-held `totalLent` is reported as a receivable.
- Added deterministic monitor tests and two negative contract regressions,
  bringing the current contract suite to 644 tests. No contract, transaction
  or Mainnet state was changed.
- Integrated the monitor through PR #77 after exact-head and Main CI passed.

## 4 September 2026 — Hardhat Maintenance Delivery

- Updated Hardhat from 3.12.0 to 3.15.0 and
  hardhat-verify 3.0.22 to 3.1.0.
- Verified all 644 contract tests, 30 Generator Engine tests and 36 IFR SDK
  tests against the bundled EDR 0.19 runtime.
- Kept Mocha at 11.8.0 because hardhat-mocha 3.1.0 does not support Mocha 12.
- Integrated the update through PR #77 after exact-head and Main Linux CI
  passed. No Mainnet verification or other on-chain action was performed.

## 26 August 2026 — Exchange Fee-Exemption Policy

- Five-member Core Developer and Keyholder Council approved full fee
  exemption by a 4-1 vote at 00:17 MET for transfers to and from officially
  verified CEX operational addresses.
- Published the address-verification, TreasurySafe 3-of-5, 48-hour timelock,
  monitoring and revocation process. No CEX address was active on-chain at
  publication time.
- Corrected public Uniswap guidance: the IFR/WETH pair is fee-exempt, the V2
  router is not, and pair swaps do not require a fixed 4% tolerance for the
  IFR token fee.

All notable changes to the Inferno ($IFR) project.

---

## [Bootstrap Funded] — 2026-03-11

### Executed
- **Proposal #4** executed: `setFeeExempt(BootstrapVaultV3, true)` (full execution hash not retained in this historical entry)
- **Proposal #5** executed: `setFeeExempt(FeeRouterV1, true)` (full execution hash not retained in this historical entry)
- **Treasury Safe → BootstrapVaultV3:** 144,750,000 IFR — [TX](https://etherscan.io/tx/0x6f08eaa67cf7562af2f9098d3bdfd177ac86cb00a365b354881accf3aa41d5b0)
- **Community Safe → BootstrapVaultV3:** 50,000,000 IFR — [TX](https://etherscan.io/tx/0x4394bec13c809084a4e669d2bb51fb35a4d2c2c050963c156c525fdb1cfbbf1c)
- **Initial total in BootstrapVaultV3:** 194,750,000 IFR
- **15.03.2026 Treasury top-up:** 5,250,000 IFR — [TX](https://etherscan.io/tx/0x47e9a6096b2088ffafaa1d04f2d435aa59777c29a26078d1b2e4b07106083fc0); final funded total 200,000,000 IFR

### Queued
- **Proposal #6** queued: ETA 13.03.2026 09:23 CET (historical entry; full transaction hash not retained)

### Updated
- All status pages updated (transparency, bootstrap, faq, mainnet-checklist, roadmap)
- Proposal #4+#5: "Queued/Pending" → "Executed" across all wiki pages
- BootstrapVaultV3 balance: "0 IFR (pending)" → "194,750,000 IFR initial funding"; completed to 200,000,000 IFR on 15.03.2026

---

## [Plan B Bootstrap Decision] — 2026-03-08

### Changed
- **Bootstrap funding source changed from Plan A to Plan B**
  - Plan A (original): LiquidityReserve → BootstrapVaultV3 (100M IFR)
  - Plan B (active): Treasury Safe (144.75M initial + 5.25M top-up) + Community Safe (50M) → BootstrapVaultV3 (200M IFR total)
  - Reason: LiquidityReserve hard-locked until 01.09.2026 — inaccessible for Bootstrap without governance risk. Plan B uses liquid multisig funds with zero smart contract risk.

### Decision Details
- **Date:** 08.03.2026
- **Decided by:** Core Dev Team (Kaspartizan)
- **On-chain execution:** Proposals #4 + #5 executed (11.03.2026). Proposal #6 executed 13.03.2026
- **Community Safe allocation after Bootstrap:**
  - 50M IFR → BootstrapVaultV3 (Bootstrap contribution)
  - 7.9M IFR → Community Operations Reserve (permanent — bug bounties, grants, DAO seed, ecosystem incentives)
- **LiquidityReserve status:** Unchanged — remains locked until 01.09.2026 for Phase 2 LP expansion

### Why Plan B is superior
- No governance proposal required to unlock funds
- 200M IFR funding supports the immutable 100M claim allocation plus 100M IFR for initial liquidity
- Fully transparent — both Safe addresses publicly documented
- Community-held funds used for community Bootstrap event

### References
- docs/BOOTSTRAP_VAULT_SPEC.md
- docs/wiki/bootstrap.html
- docs/wiki/transparency.html

---

## [Unreleased]

### Added
- AI Copilot Wiki RAG: wiki-rag.ts loads all wiki docs, builds mode-specific system prompts
- Voucher validate endpoint: GET /voucher/validate/:nonce (status, expiry, usage check)
- Anti-Sybil middleware: lockProof.ts (on-chain IFR lock verification, 5min cache)
- Anti-Sybil middleware: captcha.ts (Cloudflare Turnstile, dev-bypass)
- Creator Gateway SIWE: nonce + verify flow (replaces placeholder wallet auth)
- IFRLock edge case tests: +8 tests (1-wei lock, max balance, boundary checks, cycle tests)
- Release Notes v0.1.0 (docs/RELEASE_NOTES_v0.1.0.md)
- Wiki roadmap.html (14th wiki page, 6 phases with status badges)
- Dead link checker script (scripts/check-links.js)
- Lighthouse meta tags: OG + Twitter Card on landing page
- Points Backend Anti-Sybil Tests: lockProof.test.ts (9 tests), captcha.test.ts (6 tests)
- Creator Gateway SIWE Tests: siwe.test.ts (6 tests -- nonce, verify, validation)
- PartnerVault Integration Tests: 6 full lifecycle tests (create->claim, multi-partner, authorizedCaller, anti-double-count, finalize, guardian)
- ChatGPT Audit V4 Prompt: docs/CHATGPT_AUDIT_PROMPT_V4.md (8 Self-Checks: A-H)
- ChatGPT Audit V4 Results: docs/CHATGPT_AUDIT_V4_RESULTS.md (8/8 PASS)
- docs/ROADMAP_v0.2.0.md -- Mainnet-Ready Milestones (Audit, Multisig, Deploy, Post-Launch)
- docs/COPILOT_TEST_RESULTS.md -- AI Copilot RAG Test (6 questions, 3 modes, Safety Guards)
- docs/LIGHTHOUSE_REPORT.md -- SEO Audit (OG, Twitter Card, robots, sitemap)
- docs/GITHUB_SETUP.md -- Repository Setup (Discussions, Topics, Pages)
- docs/sitemap.xml -- 15 URLs (Landing + 14 wiki pages)
- docs/robots.txt -- Crawler control (Allow: /, Sitemap link)
- .env.example for: dashboard, governance-dashboard, ai-copilot/server, benefits-network/frontend
- GitHub Discussions enabled + 8 topics set (ethereum, defi, erc20, solidity, web3, token, hardhat, typescript)
- GitHub Release v0.1.0 created (gh release create)

### Changed
- 276 -> 321 Contract Tests (+45: IFRLock +8, BuybackVault +11, Vesting +14, LiquidityReserve +6, PartnerVault +6)
- 330 -> 444 Total Tests (367 Contract + 41 Creator Gateway + 20 Points Backend + 16 Benefits Network)
- Branch Coverage: 85% -> 91% (BuybackVault 62->94%, Vesting 69->97%, LiquidityReserve 87->97%)
- Coverage Final: 99.45% Stmts, 90.79% Branch, 98.26% Funcs, 99% Lines
- SLOC: 1520 -> 1697 (real wc -l measured, all contracts)
- Wiki: 13 -> 14 pages (roadmap.html added to all sidebars)
- Voucher issuance now requires lock proof (Bronze+ tier)
- Points event recording now requires captcha (Cloudflare Turnstile)
- Numbers sync: all docs updated to 367/444/91% (16+ files)
- AUDIT_BRIEF.md: 8 -> 9 Contracts, LOC updated
- DEPLOYMENTS.md: Proposal #2 cancelled, #3 executed, 9/9 verified

### Fixed
- Creator Gateway wallet auth: SIWE signature verification instead of trust-all
- Creator Gateway open handles: setInterval.unref() in auth.ts nonce cleanup
- Stale test counts across all docs (STATUS-REPORT, PROJECT-SUMMARY, COVERAGE_REPORT, WHITEPAPER, ONE-PAGER, PRESS_KIT, AUDIT_BRIEF, AUDIT_SUBMISSION, TESTNET_GUIDE, wiki/security.html, index.html)
- Stale LOC counts in DOCS.md (76->93, 139->151, 111->132, 148->175, 86->92, 491->549, 165->228)
- PartnerVault test count: 89 -> 95 in DOCS.md, ROADMAP.md

---

## [v0.1.0] -- 2026-02-26

### Added
- docs/TRANSPARENCY.md -- complete on-chain audit report (8 checks)
- docs/FAIR_LAUNCH.md -- Fair Launch Statement with allocation comparison
- docs/FEE_DESIGN.md -- Fee mechanism explanation + CEX strategy
- docs/OFFCHAIN_SECURITY.md -- Off-chain security hardening guide
- docs/AUDIT_SUBMISSION.md -- Code4rena/Sherlock Submission Prep (1697 SLOC)
- docs/ONE-PAGER.md -- Investor One-Pager
- docs/CONTRIBUTING.md -- Contribution Guide
- docs/SECURITY_POLICY.md -- Responsible Disclosure + Bug Bounty
- docs/TOKENOMICS_MODEL.md -- Deflation curve + emission simulation
- docs/GOVERNANCE_CONSTITUTION.md -- Governance Constitution v1.0
- docs/BUSINESS_ONBOARDING.md -- Business Onboarding SOP
- docs/YOUTUBE_INTEGRATION.md -- YouTube Hybrid Model B Guide
- docs/PARTNER_REWARDS_SPEC.md -- Builder Rewards Specification
- docs/CHATGPT_AUDIT_PROMPT_V3.md -- Audit V3 Prompt (8 areas)
- docs/CHATGPT_AUDIT_V3_RESULTS.md -- Audit V3 Results (placeholder)
- docs/wiki/faq.html -- FAQ Wiki (30 Q&A, 6 sections)
- docs/wiki/transparency.html -- On-Chain Transparency Wiki
- docs/wiki/fair-launch.html -- Fair Launch Wiki
- docs/wiki/fee-design.html -- Fee Design Wiki
- apps/creator-gateway/ -- Creator Gateway App (OAuth + IFRLock Bridge)
- scripts/onchain-audit.js -- On-Chain Audit Script (8 checks)
- scripts/propose-ownership-transfer.js -- Governance Proposal Script
- scripts/burn-lp-tokens.js -- LP Token Burn Script (DRY RUN protection)
- scripts/topup-partnervault.js -- PartnerVault Top-up Script
- .github/ISSUE_TEMPLATE/ -- Bug Report, Feature Request, Security Templates
- .github/pull_request_template.md -- PR Template
- .github/workflows/benefits-network.yml -- Benefits Network CI
- .github/workflows/update-stats.yml -- daily 06:00 UTC on-chain stats
- .github/workflows/post-deploy.yml -- trigger after deploy/execute script push
- scripts/update-stats.js -- On-Chain Stats Auto-Update (stats.json + TRANSPARENCY.md + index.html)
- apps/partner-directory/index.html -- Builder Directory (created, later removed)
- apps/dashboard/src/components/LockPanel -- Lock/Unlock UI (Approve, Lock, Unlock, Tier)
- apps/governance-dashboard/src/components/ProposalAlert -- Notification banner (Pending/Ready)
- docs/ROADMAP.md -- 6-phase roadmap (Foundation -> DAO)
- docs/PRESS_KIT.md -- Press Kit (Key Facts, Token Allocation, Links)
- docs/GITHUB_SECRETS.md -- GitHub Actions Secrets Documentation
- docs/DEPLOYMENTS.md -- Deployment Registry (10 Contracts, Constructor Args, Proposals)
- FeeRouterV1 Tests: 13 -> 33 (isVoucherValid 6 branches, setVoucherSigner, setFeeCollector, receive(), access control, signer rotation)
- Creator Gateway: youtube-checker.test.ts (6 YouTube mock tests) + access.test.ts (6 access route tests) -- 26 tests total
- Wiki security.html: solidity-coverage table (per contract), FeeRouterV1 row in test suite table
- MAINNET_CHECKLIST.md v1.1: FeeRouter deploy step, Sepolia status summary, correct test counts
- COVERAGE_REPORT.md: completely rewritten with current coverage values
- Landing Page FAQ: 5 + 3 new entries (FeeRouter, Points, Creator Gateway, Security, Mainnet, Fee 3.5%, CEX, Fee-Exempt)

### Changed
- 256 -> 276 Contract Tests (FeeRouterV1 Branch Coverage: 13 -> 33 Tests)
- 298 -> 330 Total Tests (Creator Gateway: 20 -> 26 Tests)
- Coverage: 95%/81% -> 99%/85% Statements/Branch
- Wiki: 9 -> 13 pages (faq, transparency, fair-launch, fee-design)
- MAINNET_CHECKLIST.md: LP Lock + Ownership Transfer marked as CRITICAL
- README.md: Fair Launch section, Apps table, all new docs
- FeeRouterV1.sol: NatSpec for all public functions
- InfernoToken.sol, IFRLock.sol, PartnerVault.sol, Vesting.sol, BuybackVault.sol, BurnReserve.sol, LiquidityReserve.sol: NatSpec added
- WHITEPAPER.md, AUDIT_BRIEF.md: Test counts 243 -> 276 updated
- CHATGPT_AUDIT_PROMPT_V2.md: old references updated

### Fixed
- STATUS-REPORT.md: completely rewritten (125 -> 330 tests, 6 -> 10 contracts)
- WHITEPAPER.md: Test counts 276 -> 330 updated
- contracts.html: "8th protocol component" -> "10th on-chain component"
- deployment.html: FeeRouterV1 added to deployment table
- gov-queue Task: queryFilter -> getProposal() loop (Alchemy-compatible, shows status)

### Security
- OFFCHAIN_SECURITY.md: VoucherSigner key management documented
- .gitignore: extended (*.pem, *.key, .env*.local)
- Points Backend: Voucher logging added
- FeeRouterV1: NatSpec + isVoucherValid branch coverage improved

---

## [0.9.0] -- 2026-02-24/25

### Added
- PartnerVault v2 deployed on Sepolia (`0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39`)
  - authorizedCaller model (whitelist for recordLockReward)
  - Anti-double-count mapping (wallet -> partnerId -> bool)
  - Algorithmic Emission Throttle (lockRatio -> emissionFactor)
- Governance Dashboard (`apps/governance-dashboard/`)
  - 4 Tabs: Overview, Builders, Timelock Queue, Calldata Generator
  - React 18 + Vite + TypeScript + Tailwind + ethers v5
  - FeeRouter functions in Calldata Generator
- IFR AI Copilot (`apps/ai-copilot/`)
  - 3 modes: Customer, Builder, Developer
  - RAG over IFR_KNOWLEDGE (canon parameters)
  - Safety Guards: no seed phrase, source quoting
  - Embedded in Landing Page + 9 wiki pages
- Points Backend (`apps/points-backend/`)
  - SIWE Authentication (Sign-In with Ethereum)
  - 5 event types with daily limits
  - EIP-712 Voucher Issuance
  - Anti-Sybil: Rate Limiting, Daily Caps
  - 20 Tests passing
- FeeRouterV1 deployed on Sepolia (`0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4`)
  - EIP-712 Voucher Verification
  - Protocol Fee (5 bps default, 25 bps hard cap)
  - Whitelisted Adapters
  - Replay Protection + Pause
  - 13 Tests passing
- Wiki: `agent.html` (AI Copilot, Points System, Safety)
- Docs: WHITEPAPER.md, SDK_QUICKSTART.md, TESTNET_GUIDE.md
- Docs: CREATOR_GATEWAY.md, GOVERNANCE_CONSTITUTION.md
- Docs: BUSINESS_ONBOARDING.md, PARTNER_INTEGRATION_SPEC.md
- Docs: MAINNET_CHECKLIST.md, AUDIT_BRIEF.md, MULTISIG_SETUP.md

### Changed
- PartnerVault address updated (v1 -> v2)
- Docs: 243 -> 256 tests, 9 -> 14 on-chain components
- Landing Page: 5 new FAQ entries
- Landing Page: Tokenomics Donut Chart + Deflation Visualizer
- Audit wording clarified (Slither static analysis, not "audited")
- rewardBps deployment.html: 1000 -> 1500 corrected

### Fixed
- Wiki Quick Stats: 221 -> 243 -> 256 tests
- LP Pair Label: "8 repo contracts + 1 Uniswap V2 LP Pair"
- Alchemy Free Tier getLogs fix (DEPLOY_BLOCK + graceful fallback)

### Security
- AuthorizedCaller pattern in PartnerVault (no public recordLockReward)
- FeeRouter: Replay protection via usedNonces mapping
- FeeRouter: Pause mechanism for emergencies
- Points Backend: Rate limiting + daily issuance cap
