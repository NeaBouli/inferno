# Changelog

All notable changes to the Inferno ($IFR) project.

---

## [Bootstrap Funded] — 2026-03-11

### Executed
- **Proposal #4** executed: `setFeeExempt(BootstrapVaultV3, true)` — [TX: 0xdb1590bf…](https://etherscan.io/tx/0xdb1590bf)
- **Proposal #5** executed: `setFeeExempt(FeeRouterV1, true)` — [TX: 0x1c885fbe…](https://etherscan.io/tx/0x1c885fbe)
- **Treasury Safe → BootstrapVaultV3:** ~144,750,000 IFR — [TX: 0x6f08eaa6…](https://etherscan.io/tx/0x6f08eaa6)
- **Community Safe → BootstrapVaultV3:** 50,000,000 IFR — [TX: 0x4394bec1…](https://etherscan.io/tx/0x4394bec1)
- **Total in BootstrapVaultV3:** ~194,750,000 IFR (confirmed on-chain)

### Queued
- **Proposal #6** queued: ETA 13.03.2026 09:23 CET — [TX: 0x89eebca7…](https://etherscan.io/tx/0x89eebca7)

### Updated
- All status pages updated (transparency, bootstrap, faq, mainnet-checklist, roadmap)
- Proposal #4+#5: "Queued/Pending" → "Executed" across all wiki pages
- BootstrapVaultV3 balance: "0 IFR (pending)" → "194,750,000 IFR (funded ✅)"

---

## [Plan B Bootstrap Decision] — 2026-03-08

### Changed
- **Bootstrap funding source changed from Plan A to Plan B**
  - Plan A (original): LiquidityReserve → BootstrapVaultV3 (100M IFR)
  - Plan B (active): Treasury Safe (144.75M) + Community Safe (50M) → BootstrapVaultV3 (~194.75M IFR total)
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
- Higher IFR allocation (~194.75M vs 100M) → deeper initial liquidity
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
