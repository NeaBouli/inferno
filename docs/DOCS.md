<p align="center">
  <img src="assets/ifr_icon_256.png" alt="Inferno $IFR" width="200" />
</p>

# Inferno -- Project Status & Structure

## Legend
- [x] completed -- code + tests finished, stable
- [ ] open -- not yet implemented or in progress

---

## Repository Structure

```
inferno/
├── contracts/
│   ├── token/InfernoToken.sol          [x] 93 LOC, 22 Tests
│   ├── liquidity/LiquidityReserve.sol  [x] 161 LOC, 42 Tests
│   ├── vesting/Vesting.sol             [x] 142 LOC, 27 Tests
│   ├── buyback/BuybackVault.sol        [x] 173 LOC, 26 Tests
│   ├── burnreserve/BurnReserve.sol     [x] 102 LOC, 27 Tests
│   ├── governance/Governance.sol       [x] 150 LOC, 36 Tests
│   ├── lock/IFRLock.sol               [x] 127 LOC, 37 Tests
│   ├── partner/PartnerVault.sol       [x] 549 LOC, 95 Tests
│   ├── bootstrap/BootstrapVault.sol  [x] 225 LOC, 22 Tests
│   ├── FeeRouterV1.sol               [x] 228 LOC, 33 Tests
│   └── mocks/                          MockToken, MockRouter, MockInfernoToken, MockAdapter, MockBootstrapHelpers
├── test/
│   ├── InfernoToken.test.js            [x] 258 LOC
│   ├── LiquidityReserve.test.js        [x] 283 LOC
│   ├── Vesting.test.js                 [x] 112 LOC
│   ├── BuybackVault.test.js            [x] 149 LOC
│   ├── BurnReserve.test.js             [x] 212 LOC
│   ├── Governance.test.js              [x] 320 LOC
│   ├── IFRLock.test.js                [x] 363 LOC
│   ├── PartnerVault.test.js           [x] 480 LOC
│   ├── FeeRouterV1.test.js           [x] 500 LOC
│   └── BootstrapVault.test.js        [x] 337 LOC
├── scripts/
│   ├── deploy-testnet.js               [x] 232 LOC (9-Step CFLM Deploy)
│   ├── create-lp.js                    [x] 4-Step LP Pairing + Router Update
│   ├── test-transfer.js               [x] Live Fee-on-Transfer Verification
│   ├── sepolia-smoke-test.js          [x] Full Protocol Smoke Test (11 Checks)
│   ├── execute-proposal.js           [x] Governance Proposal Executor (Status/ETA/Execute/Verify)
│   ├── deploy-lock.js                [x] IFRLock Deploy + Governance Proposal
│   ├── test-lock.js                  [x] IFRLock Live Test (Lock/Unlock/isLocked)
│   ├── deploy-feerouter.js           [x] FeeRouterV1 Deploy + Verify
│   ├── update-stats.js              [x] Auto-Update On-Chain Stats -> docs/stats.json + TRANSPARENCY.md + index.html
│   ├── onchain-audit.js             [x] 8-Check On-Chain Audit (Ownership, LP, Vesting, Supply, FeeExempt)
│   ├── propose-ownership-transfer.js [x] Ownership Transfer Proposals (3 Contracts, DRY RUN protection)
│   ├── execute-ownership-transfer.js [x] Ownership Transfer Executor (after 48h Timelock)
│   ├── redeploy-reserves.js         [x] Redeploy LiquidityReserve/BuybackVault/BurnReserve (transferOwnership upgrade)
│   ├── burn-lp-tokens.js            [x] LP Token Burn -> 0xdead (DRY RUN protection, irreversible)
│   ├── deploy-mainnet.js           [x] Unified Mainnet Deploy (9 Contracts, 12 Steps, DRY RUN compatible)
│   └── check-links.js              [x] Dead Link Checker (internal links in docs/)
├── tasks/
│   └── admin.js                       [x] Hardhat CLI Tasks (lock-check, vault-status, feerouter-status, token-stats, gov-queue)
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md             [x] Bug Report Template
│   │   ├── feature_request.md        [x] Feature Request Template
│   │   └── security.md              [x] Security Advisory Redirect
│   ├── pull_request_template.md      [x] PR Template with checklist
│   └── workflows/
│       ├── creator-gateway.yml       [x] CI: tsc + jest
│       ├── points-backend.yml        [x] CI: prisma generate + tsc + jest
│       ├── ai-copilot.yml           [x] CI: tsc + build
│       ├── update-stats.yml         [x] Cron: daily 06:00 UTC On-Chain Stats Update
│       └── post-deploy.yml          [x] Trigger: after deploy/execute script push
├── apps/
│   ├── dashboard/                      [x] React + Vite Frontend (Phase 1 + Phase 2 + LockPanel)
│   ├── governance-dashboard/          [x] React + Vite + TS + Tailwind (Overview, Builders, Timelock, Calldata, ProposalAlert)
│   ├── partner-directory/             [removed] Replaced by open ecosystem model
│   ├── ai-copilot/                   [x] React + Vite + TS + Tailwind + Express (3 modes, RAG, Safety Guards)
│   ├── points-backend/               [x] Express + Prisma + SQLite + siwe + jose (SIWE Auth, Points, EIP-712 Voucher, 35 Tests)
│   ├── creator-gateway/              [x] Express + ethers v5 + googleapis + JWT (YouTube x IFR Lock Bridge, Port 3005, 41 Tests)
│   └── benefits-network/
│       ├── backend/                   [x] Express + Prisma + SQLite (16 Tests)
│       └── frontend/                  [x] Next.js 14 + Tailwind + wagmi v2 (PWA)
├── docs/
│   ├── DOCS.md                         This document
│   ├── FAIR-LAUNCH-MIGRATION.md        CFLM Migration Plan
│   ├── WHITEPAPER.md                   Project Whitepaper v1.0 (Builders & Investors, non-technical)
│   ├── WHITEPAPER_EN.md                Whitepaper (EN, outdated)
│   ├── CHANGELOG.md                    Change log
│   ├── KNOWN-ISSUES.md                 Known Issues
│   ├── SECURITY-AUDIT.md               Slither Audit Report
│   ├── DEPLOYMENTS.md                  Sepolia + Mainnet Contract Addresses
│   ├── GOVERNANCE_CONSTITUTION.md     Governance Constitution v1.0 (Hard Bounds, Roles, Upgrade Path)
│   ├── BUSINESS_ONBOARDING.md         Business Onboarding Guide (Benefits Network Setup & Go-Live)
│   ├── PARTNER_INTEGRATION_SPEC.md    Technical Builder Integration Spec (IFRLock + PartnerVault ABI, Rewards, Algo Throttle)
│   ├── MAINNET_CHECKLIST.md           Deployment Checklist (3 Phases)
│   ├── AUDIT_BRIEF.md                 Security Audit Brief + Scope
│   ├── MULTISIG_SETUP.md              Gnosis Safe 4-of-7 Setup Guide
│   ├── CREATOR_GATEWAY.md             Creator Gateway Spec v0.1 (YouTube Hybrid, Docker, Entitlement Engine)
│   ├── SDK_QUICKSTART.md              Developer Quickstart v1.0 (ethers.js, wagmi, Python, Tier System)
│   ├── TESTNET_GUIDE.md               Sepolia E2E Guide (Lock, Benefits Network, Governance, PartnerVault, FeeRouter)
│   ├── CHATGPT_AUDIT_PROMPT_V2.md    Independent Audit Checklist (7 areas A-G)
│   ├── E2E_FLOW.md                    Points -> Voucher -> FeeRouter End-to-End Flow
│   ├── YOUTUBE_INTEGRATION.md         YouTube x IFR Hybrid Model B, Creator Gateway, Entitlement Config
│   ├── SECURITY_POLICY.md             Responsible Disclosure, Bug Bounty, Scope, Known Design Decisions
│   ├── TOKENOMICS_MODEL.md            Deflation Curve, Allocation, PartnerVault Emission, Lock Economics, FeeRouter Fee
│   ├── PARTNER_REWARDS_SPEC.md        Reward Formula, Vesting, Anti-Gaming, Builder Types (A/B/C), Onboarding
│   ├── PATCH-GUIDELINES.md             Patch Guidelines v1.0 (6 Steps, Versioning, Emergency Patches)
│   ├── COVERAGE_REPORT.md             Solidity Coverage Report (99% Stmts, 91% Branch, 98% Funcs, 99% Lines, Final Run)
│   ├── BENEFITS_NETWORK_TEST.md       Benefits Network E2E Test Guide (Test Flow, API, Lock Tiers, Errors)
│   ├── PROJECT-SUMMARY.md             Complete Overview (10 Contracts, 444 Tests, 7 Apps, CI/CD)
│   ├── CONTRIBUTING.md                Contributing Guide v1.0 (Bug Reports, Code Standards, Git Conventions)
│   ├── TRANSPARENCY.md               On-Chain Transparency Report (8 Checks, Supply, Vesting, LP, Mainnet TODOs)
│   ├── ONE-PAGER.md                  Investor One-Pager (Key Numbers, Products, Technology, Mainnet Live)
│   ├── CHATGPT_AUDIT_PROMPT_V3.md   Independent Audit V3 (8 areas: Transparency, LP Lock, Consistency, Scripts)
│   ├── FEE_DESIGN.md                Fee Design v1.0 (Why 3.5%, Fee-Exempt, CEX Strategy, MEV/Slippage)
│   ├── FAIR_LAUNCH.md               Fair Launch Statement (No Presale, No VC, Allocation Comparison, On-Chain Proofs)
│   ├── OFFCHAIN_SECURITY.md         Off-Chain Security (VoucherSigner, JWT, SIWE, Rate Limiting, Secrets Checklist)
│   ├── AUDIT_SUBMISSION.md          Audit Submission Prep (Code4rena/Sherlock, 9 Contracts, 1697 SLOC, Known Issues)
│   ├── CHATGPT_AUDIT_V3_RESULTS.md Audit V3 Results (12/12 PASS, Methodology, Findings)
│   ├── CHATGPT_AUDIT_PROMPT_V4.md Independent Audit V4 (8 Self-Checks: Anti-Sybil, SIWE, Integration, Numbers, RAG, Voucher, CHANGELOG, Deployment)
│   ├── RAILWAY_ENV.md               Points Backend Railway Deploy (Env Vars, CLI Setup, Health Check)
│   ├── VERCEL_ENV.md                AI Copilot Vercel + Railway Deploy (Two-App, Proxy, Env Vars)
│   ├── PAGE_UPDATE_CHECKLIST.md    Which files need updating for which event
│   ├── DASHBOARD_TEST_RESULTS.md   Dashboard Build Results (0 Errors, 198 Modules)
│   ├── BENEFITS_E2E_RESULTS.md     Benefits Network E2E Checklist (Backend, API, Sepolia)
│   ├── PRESS_KIT.md                 Press Kit (Key Facts, Token Allocation, Roadmap, Links)
│   ├── GITHUB_SECRETS.md            GitHub Actions Secrets Documentation
│   ├── ROADMAP.md                   6-Phase Roadmap (Foundation -> DAO)
│   ├── stats.json                   Auto-generated On-Chain Stats (via update-stats.js)
│   ├── RELEASE_NOTES_v0.1.0.md        First tagged release (Sepolia Testnet)
│   ├── LIGHTHOUSE_REPORT.md           SEO Optimizations (OG, Twitter Card, Meta Tags, Sitemap, robots.txt)
│   ├── COPILOT_TEST_RESULTS.md        AI Copilot RAG Test (6 Questions, 3 Modes, Safety Guards)
│   ├── ROADMAP_v0.2.0.md             Mainnet-Ready Milestones (Audit, Multisig, Deploy, Post-Launch)
│   ├── CHATGPT_AUDIT_V4_RESULTS.md    Audit V4 Results (8/8 PASS)
│   ├── GITHUB_SETUP.md               Repository Setup (Discussions, Topics, Pages)
│   ├── APP_SECURITY_REVIEW.md        App Security Review (12 Findings, 7 Fixed: CORS, JWT, ABI, Wallet)
│   ├── robots.txt                     Crawler control (Allow: /, Sitemap link)
│   ├── sitemap.xml                    15 URLs (Landing + 14 Wiki pages)
│   └── wiki/                          [x] 18 HTML pages (index, contracts, tokenomics, lock, governance, security, deployment, integration, bootstrap, agent, faq, transparency, fair-launch, fee-design, vesting, roadmap, testnet, multisig)
├── STATUS-REPORT.md                    Complete Status Report
└── README.md                           Project Overview
```

---

## Modules

### 1. InfernoToken -- [x] DONE
- **Path:** `contracts/token/InfernoToken.sol`
- **Tests:** 22 (InfernoToken.test.js)
- **Description:** ERC20 + ERC20Burnable + Ownable, 9 Decimals, 1B Supply
- **Features:** Fee-on-Transfer (2% Sender Burn, 0.5% Recipient Burn, 1% Pool Fee), Fee Exemption, Owner Functions (setFeeRates, setFeeExempt, setPoolFeeReceiver), Max 5% Fee Cap

### 2. LiquidityReserve -- [x] DONE
- **Path:** `contracts/liquidity/LiquidityReserve.sol`
- **Tests:** 42 (LiquidityReserve.test.js)
- **Description:** Strategic Reserve for 200M IFR
- **Features:** 6-month lock, staged release (50M per quarter), period tracking, Guardian Pause, Owner withdraw after lock, transferOwnership

### 3. Vesting -- [x] DONE
- **Path:** `contracts/vesting/Vesting.sol`
- **Tests:** 27 (Vesting.test.js)
- **Description:** Team Vesting for 150M IFR
- **Features:** Post-cliff formula (12mo cliff, 36mo linear), Guardian Pause, Beneficiary Release
- **Formula:** `(totalAllocation * (elapsed - cliff)) / (duration - cliff)`

### 4. BuybackVault -- [x] DONE
- **Path:** `contracts/buyback/BuybackVault.sol`
- **Tests:** 26 (BuybackVault.test.js)
- **Description:** ETH-to-IFR Buyback with automatic split
- **Features:** 50/50 Split (BurnReserve + Treasury), Cooldown (1h), Slippage Protection (5%), 60-day activation delay, Guardian Pause, transferOwnership

### 5. BurnReserve -- [x] DONE
- **Path:** `contracts/burnreserve/BurnReserve.sol`
- **Tests:** 27 (BurnReserve.test.js)
- **Description:** Permanent Token Burning with tracking
- **Features:** deposit(), burn(), burnAll(), totalBurned counter, ERC20Burnable (totalSupply decreases), Owner + Guardian Auth, transferOwnership

### 6. Governance -- [x] DONE
- **Path:** `contracts/governance/Governance.sol`
- **Tests:** 36 (Governance.test.js)
- **Description:** Timelock Governor for all protocol parameters
- **Features:** propose/execute/cancel, Delay 1h-30d (default 48h), Guardian Emergency Cancel, Self-Governance (setDelay via own Timelock), Integration with InfernoToken (transferOwnership)

### 7. IFRLock -- [x] DONE
- **Path:** `contracts/lock/IFRLock.sol`
- **Tests:** 37 (IFRLock.test.js)
- **Description:** Generic IFR Token Lock without Rewards/Vesting
- **Features:** lock(amount), lockWithType(amount, lockType), unlock(), isLocked(user, minAmount), lockInfo(), ReentrancyGuard, Emergency Pause (lock only), Guardian Auth, Multi-App lockType Tag

### 8. PartnerVault -- [x] DONE
- **Path:** `contracts/partner/PartnerVault.sol`
- **Tests:** 95 (PartnerVault.test.js)
- **Description:** Builder Ecosystem Pool (40M IFR) with Milestone-Unlocking + Lock-triggered Creator Rewards
- **Features:** createPartner, activatePartner, recordMilestone, recordLockReward (lockAmount x effectiveBps, wallet), claim (linear vesting with cliff), finalizeMilestones, SafeERC20, ReentrancyGuard, Pausable, Guardian Auth, Governance-controlled parameters (rewardBps 5-25%, annualEmissionCap, partnerCap) with min/max bounds, Annual Cap Reset, authorizedCaller Whitelist, Anti-Double-Count (wallet->partner), Algo Emission Throttle (lockRatio-based BPS scaling via IIFRLock)
- **Mainnet:** rewardBps=1000 (10%), annualCap=4M IFR, Address: `0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D`
- **CRITICAL:** feeExempt MUST be set BEFORE the 40M transfer (Sepolia lesson: 1.4M IFR fee loss)

### 9. FeeRouterV1 (`contracts/FeeRouterV1.sol`) -- 228 LOC, 33 Tests
- **Purpose:** Protocol fee routing with EIP-712 signed discount vouchers
- **Features:** swapWithFee (adapter-based), DiscountVoucher (EIP-712 signed), Replay Protection (nonce), Whitelisted Adapters, Governance-controlled fee (0-25 bps), Pause
- **Mainnet:** protocolFeeBps=5 (0.05%), FEE_CAP_BPS=25 (0.25%), Address: `0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a`
- **Integration:** Points Backend signs vouchers via EIP-712, FeeRouterV1 validates on-chain

### 10. BootstrapVault (`contracts/bootstrap/BootstrapVault.sol`) -- 225 LOC, 22 Tests
- **Purpose:** Trustless community bootstrap for initial IFR/ETH liquidity pool creation
- **Features:** contribute() (0.01-2 ETH/wallet), finalise() (permissionless LP creation), claim() (pro-rata IFR share), LP lock via Team.Finance, anti-whale max 2 ETH, 90-day window, no admin keys, no pause, no withdrawal
- **Mainnet:** Deployed

### Removed
- ~~Presale.sol~~ -- Removed during CFLM migration (no presale in Fair Launch model)

---

## Summary

| Metric | Value |
|--------|-------|
| Contracts | 10 (+ 5 Mocks) |
| Solidity LOC | 1,950 |
| Tests | 367 contract + 41 Creator Gateway + 20 Points + 16 Benefits = 494 total |
| Branch Coverage | 91% |
| Test LOC | 2,402 |
| Deploy Script | 232 LOC, 9 Steps |
| Model | CFLM (Community Fair Launch) |
| Compiler | 0 Errors, 0 Warnings |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-05 | **Mainnet deployment**: 9 contracts deployed + verified on Ethereum Mainnet |
| 2026-02-28 | Redeploy: LiquidityReserve/BuybackVault/BurnReserve v2 on Sepolia (transferOwnership upgrade), Ownership -> Governance, feeExempt Proposals #7-9 queued |
| 2026-02-28 | transferOwnership: +18 Tests (LR 36->42, BV 20->26, BR 21->27), immutable owner -> mutable + transferOwnership() |
| 2026-02-26 | PRESS_KIT.md: Press Kit (112 lines, Key Facts, Token Allocation, Roadmap, Links, Media) |
| 2026-02-26 | GITHUB_SECRETS.md: GitHub Actions Secrets Documentation (Required + Optional, Workflows, Environments) |
| 2026-02-26 | CHANGELOG v0.1.0: [Unreleased] -> [v0.1.0], git tag v0.1.0 created |
| 2026-02-26 | Benefits Network E2E Test v2: Health OK, Business + Session created, route corrections documented |
| 2026-02-26 | Points Backend: .dockerignore created, Dockerfile + railway.json verified |
| 2026-02-26 | AI Copilot: server/Dockerfile created, VERCEL_ENV.md deploy steps added |
| 2026-02-26 | Consistency Check: 7/7 passed (test counts, 40M, Proposal #3, Wiki 13, .env, no keys) |
| 2026-02-26 | ChatGPT Audit V3: 8 -> 12 checks expanded (PRESS_KIT, ROADMAP, v0.1.0, GitHub Templates), 12/12 PASS |
| 2026-02-26 | LockPanel.jsx: Lock/Unlock UI in Token Dashboard (Approve, Lock, Unlock, Tier display, Balance, TX links) |
| 2026-02-26 | Builder Directory: created, later removed (open ecosystem model) |
| 2026-02-26 | ProposalAlert.tsx: Notification banner in Governance Dashboard (Pending/Ready Proposals, Countdown, Dismiss) |
| 2026-02-26 | ROADMAP.md: 6-phase roadmap (Foundation -> Governance -> Ecosystem -> Mainnet -> Growth -> DAO) |
| 2026-02-26 | Landing Page: Roadmap Phase 3/5 corrected (Multi-Chain removed, Full Roadmap link) |
| 2026-02-26 | IFRLock ABI: lock() + unlock() write functions added (Dashboard) |
| 2026-02-25 | .env.example: Deployed Contract Addresses added (TOKEN, GOVERNANCE, IFRLOCK, PARTNERVAULT, FEEROUTER) |
| 2026-02-25 | token-stats Task Fix: burnFeeBps -> senderBurnBps + recipientBurnBps + totalFeeBps |
| 2026-02-25 | Benefits Network E2E Test: Script + Test Guide (docs/BENEFITS_NETWORK_TEST.md) |
| 2026-02-25 | Governance Wiki: Proposal details expanded (Targets, Reasons, Proposer) + Governance Learnings section |
| 2026-02-25 | Solidity Coverage: solidity-coverage installed, report generated (99% Stmts, 85% Branch) |
| 2026-02-25 | PROJECT-SUMMARY.md: Completely rewritten (10 Contracts, 324 Tests, 7 Apps, Coverage, CI/CD, Token Metrics) |
| 2026-02-25 | Creator Gateway Tests: 14 Tests (lock-checker, entitlement OR/AND, auth routes) with Jest + ts-jest + supertest |
| 2026-02-25 | Dashboard: ProtocolStats component (IFRLock totalLocked, PartnerVault Balance, FeeRouter Fee, Reward Rate, Auto-refresh 30s) |
| 2026-02-25 | PATCH-GUIDELINES.md v1.0: 6-step process, severity matrix, smart contract patch rules, versioning, emergency patches |
| 2026-02-25 | GitHub Actions CI: Creator Gateway (tsc+jest), Points Backend (prisma+tsc+jest), AI Copilot (tsc+build) |
| 2026-02-25 | Deployment Wiki: Proposal #3 info box with scripts + 1.4M IFR top-up step |
| 2026-02-26 | update-stats.js: Auto-Update Script (Sepolia -> stats.json + TRANSPARENCY.md + STATUS-REPORT.md + index.html) |
| 2026-02-26 | GitHub Actions: update-stats.yml (daily cron 06:00 UTC) + post-deploy.yml (trigger after deploy/execute push) |
| 2026-02-26 | Wiki index.html: Stats cards expanded (330 Tests, 99% Coverage, 2M+ Burned, 13 Wiki Pages, 48h Timelock) |
| 2026-02-26 | MULTISIG_SETUP.md v2.0: 3 phases (2-of-4 -> 3-of-5 -> 4-of-7), Guardian Multisig, wallet requirements, costs, checklist |
| 2026-02-26 | Coverage Final: 98.89% Stmts, 84.65% Branch (unchanged) |
| 2026-02-26 | PROJECT-SUMMARY.md: FeeRouterV1 Coverage 100%/96% completed, Proposals #4-#6 updated |
| 2026-02-26 | CHATGPT_AUDIT_V3_RESULTS.md: Complete results with methodology (8/8 PASS, 1 Finding) |
| 2026-02-26 | WHITEPAPER.md: CFLM Section (comparison UNI/AAVE/COMP), Fee Design expanded (Lock>Transfer, Fee-Exempt, CEX) |
| 2026-02-26 | RAILWAY_ENV.md: Points Backend Railway Deploy Guide (Env Vars, CLI, Health Check) |
| 2026-02-26 | VERCEL_ENV.md: AI Copilot Vercel + Railway Deploy (Two-App, Proxy Config, Env Vars) |
| 2026-02-26 | PAGE_UPDATE_CHECKLIST.md: Comprehensive update matrix (7 event types, all affected files) |
| 2026-02-26 | DASHBOARD_TEST_RESULTS.md: Build OK (0 Errors, 198 Modules, Bundle Sizes) |
| 2026-02-26 | BENEFITS_E2E_RESULTS.md: E2E checklist (Backend Health, API, Sepolia Integration) |
| 2026-02-26 | Governance Proposals #4-#6 scheduled: LiquidityReserve/BuybackVault/BurnReserve Ownership -> Governance (ETA 28.02.) |
| 2026-02-26 | Wiki RAG: wiki-rag.ts, mode-specific system prompts, 14 wiki pages as RAG context |
| 2026-02-26 | Voucher validate endpoint: GET /voucher/validate/:nonce (Status, Expiry, Usage) |
| 2026-02-26 | Anti-Sybil: lockProof.ts + captcha.ts middleware, voucher requires lock, points require captcha |
| 2026-02-26 | Creator Gateway SIWE: siwe package, Nonce/Verify flow, JWT issued after SIWE verification |
| 2026-02-26 | Branch Coverage: 85% -> 91% (BuybackVault 62->94%, Vesting 69->97%, LiquidityReserve 87->97%) |
| 2026-02-26 | IFRLock Edge Case Tests: +8 tests (1-wei, max balance, boundary, cycle, lockInfo reset) |
| 2026-02-26 | Release Notes v0.1.0: docs/RELEASE_NOTES_v0.1.0.md |
| 2026-02-26 | Wiki roadmap.html: 14th wiki page, sidebar updated in all 14 pages |
| 2026-02-26 | Dead Link Check: scripts/check-links.js (283 links, 3 fixed, 0 broken) |
| 2026-02-26 | Lighthouse Meta Tags: OG + Twitter Card + robots + theme-color + canonical on landing page |
| 2026-02-26 | Test Counts: 276 -> 315 Contract Tests (BuybackVault +11, Vesting +14, LiquidityReserve +6, IFRLock +8) |
| 2026-02-26 | AI Copilot TS Fix: IFRCopilot.tsx window cast (as unknown as Record) -- Build 0 Errors |
| 2026-02-26 | FeeRouterV1 Tests: 13 -> 33 (isVoucherValid, setVoucherSigner, setFeeCollector, receive(), access control, signer rotation) |
| 2026-02-26 | Creator Gateway YouTube Mock Tests: 6 Tests (isMember mock, fail-closed, API errors) -- Total: 26 Tests |
| 2026-02-26 | Wiki Security: solidity-coverage table added (per contract), FeeRouterV1 test suite row |
| 2026-02-26 | Mainnet Checklist v1.1: FeeRouter step, status summary, Sepolia milestones, correct test counts |
| 2026-02-26 | Test counts synchronized: 276 contract tests (InfernoToken 22, LiquidityReserve 30, FeeRouterV1 33), 330 total |
| 2026-02-26 | Coverage updated: 95%/81% -> 99%/85% Stmts/Branch (FeeRouterV1 100%/96%), all docs synchronized |
| 2026-02-26 | Benefits Network CI Workflow: .github/workflows/benefits-network.yml (test-backend + test-frontend) |
| 2026-02-26 | Creator Gateway access.test.ts: 6 access route tests (auth 401, granted/denied, YouTube detect, no-wallet) -- 26 tests total |
| 2026-02-26 | gov-queue Task Fix: queryFilter -> getProposal() loop (shows status PENDING/READY/EXECUTED/CANCELLED) |
| 2026-02-26 | Landing Page FAQ: 5 new entries (FeeRouter, Points, Creator Gateway, Security, Mainnet Launch) -- 24 FAQ total |
| 2026-02-26 | Wiki FAQ page: docs/wiki/faq.html -- 30 Q&A in 6 sections, sidebar updated in all 10 wiki pages |
| 2026-02-26 | CONTRIBUTING.md: Contributing Guide v1.0 (Bug Reports, Code Standards, Git Conventions, Review Process) |
| 2026-02-26 | TRANSPARENCY.md: On-Chain Transparency Report (8 Checks, Supply, Vesting, LP, FeeExempt, Mainnet TODOs) |
| 2026-02-26 | MAINNET_CHECKLIST.md: Critical LP Lock + Ownership Transfer section, Deployer Wallet reduction |
| 2026-02-26 | Wiki Security: On-Chain Audit section (Ownership table, Supply distribution, Vesting, Deflation) |
| 2026-02-26 | Landing Page: On-Chain Transparency section (4 stat cards: Vesting, Burned, Governance, Tests) |
| 2026-02-26 | propose-ownership-transfer.js: 3 Ownership Transfer Proposals (Reserve, Buyback, Burn -> Governance) with DRY RUN |
| 2026-02-26 | execute-ownership-transfer.js: Ownership Transfer Executor (after 48h Timelock, status check) |
| 2026-02-26 | burn-lp-tokens.js: LP Token Burn -> 0xdead (DRY RUN protection, 3s countdown, irreversible) |
| 2026-02-26 | Wiki transparency.html: On-Chain Transparency Report (8 Checks, Etherscan links, TODOs, verify instructions) |
| 2026-02-26 | Sidebar: transparency.html linked in all 11 wiki pages |
| 2026-02-26 | WHITEPAPER.md: Section 9 (On-Chain Transparency) + test count 276->330, sections 10-12 renumbered |
| 2026-02-26 | ONE-PAGER.md: Investor One-Pager (Key Numbers, Products, Technology, Pre-Mainnet Checklist) |
| 2026-02-26 | CHATGPT_AUDIT_PROMPT_V3.md: 8 areas (Transparency, LP Lock, Consistency, Ownership, One-Pager, Wiki, Scripts, Security Promises) |
| 2026-02-26 | Coverage Final: 98.89% Stmts, 84.65% Branch (unchanged, confirmed) |
| 2026-02-26 | FEE_DESIGN.md: Fee Design v1.0 (Why 3.5%, Fee-Exempt Addresses, CEX Strategy, MEV/Slippage) |
| 2026-02-26 | Landing Page FAQ: 3 new entries (Why 3.5%, CEX, Fee-Exempt) -- 27 FAQ total |
| 2026-02-26 | Wiki FAQ: 5 new fee questions (3.5% Why, Fee-Exempt, BuybackVault, DEX Compatibility, BPS) -- 35 Q&A total |
| 2026-02-26 | FAIR_LAUNCH.md: Fair Launch Statement (No Presale, No VC, Allocation Comparison, On-Chain Proofs) |
| 2026-02-26 | Landing Page: Fair Launch detail box (No Presale, No VC, No IDO + link to FAIR_LAUNCH.md) |
| 2026-02-26 | OFFCHAIN_SECURITY.md: Off-Chain Security (VoucherSigner Key Management, JWT, SIWE, Rate Limiting, Secrets) |
| 2026-02-26 | .gitignore extended: .env.local, .env*.local, *.pem, *.key |
| 2026-02-26 | Points Backend: Voucher Issuance Logging ([VOUCHER] wallet, issued, discount, nonce) |
| 2026-02-26 | AUDIT_SUBMISSION.md: Audit Prep (Code4rena/Sherlock, 9 Contracts, 1697 SLOC, Known Issues, Checklist) |
| 2026-02-26 | CHATGPT_AUDIT_V3_RESULTS.md: Audit results placeholder, Self-Check 8/8 PASS |
| 2026-02-26 | NatSpec: InfernoToken.sol (14 tags), Vesting.sol (19), BuybackVault.sol (19), PartnerVault.sol (61), BurnReserve.sol (12), LiquidityReserve.sol (19) |
| 2026-02-26 | Wiki fair-launch.html: Fair Launch Wiki (Allocation, Comparison, On-Chain Proof, Vesting Details) |
| 2026-02-26 | Wiki fee-design.html: Fee Design Wiki (Why 3.5%, Fee-Exempt, CEX, Slippage Guide) |
| 2026-02-26 | Wiki Sidebar: 13 pages (fair-launch + fee-design linked in all wiki pages) |
| 2026-02-26 | .github/ISSUE_TEMPLATE/: Bug Report, Feature Request, Security Templates |
| 2026-02-26 | .github/pull_request_template.md: PR Template with checklist |
| 2026-02-26 | CHANGELOG.md: Complete [Unreleased] entry (26.02.2026) with Added/Changed/Fixed/Security |
| 2026-02-26 | FeeRouterV1.sol: NatSpec comments for all public/external functions (contract, constructor, 8 functions) |
| 2026-02-26 | Governance Constitution v1.0 expanded (Articles 1-7, FeeRouterV1 parameters, Multisig structure, prohibited actions) |
| 2026-02-26 | Business Onboarding SOP expanded (6 steps, Hosted + Self-Hosted, Tier configuration, staff training, FAQ) |
| 2026-02-26 | YouTube Integration Guide: Hybrid Model B, Creator Gateway Setup, Entitlement Config, Monetization, Roadmap |
| 2026-02-26 | Lock-Mechanism Wiki: Lock Economics, Creator Rewards mechanism, isLocked() verification, Anti-Gaming section |
| 2026-02-26 | Creator Gateway App: Express + ethers v5 + googleapis + JWT, YouTube x IFR Lock Bridge (14 files, Port 3005) |
| 2026-02-26 | Governance Wiki: Phase 4 DAO Roadmap (Token-Voting, Quorum, Milestones) |
| 2026-02-26 | Landing Page: Builder Directory section (3 placeholder slots: Business, Creator, Developer) |
| 2026-02-26 | Builder Rewards Spec: Reward formula, Vesting, Anti-Gaming, 3 Builder Types, Onboarding Flow |
| 2026-02-26 | Hardhat Admin Tasks: lock-check, vault-status, feerouter-status, token-stats, gov-queue (tasks/admin.js) |
| 2026-02-26 | Security Policy: Responsible Disclosure, Bug Bounty Framework, Scope, Known Design Decisions |
| 2026-02-26 | Tokenomics Model: Deflation curve, Allocation, PartnerVault Emission, Lock Economics, FeeRouter Fee |
| 2026-02-26 | Integration Wiki: Creator Gateway, Points Backend API, FeeRouter Integration (Sections 15-17) |
| 2026-02-26 | Governance Wiki: Proposal #2 cancellation explanation added |
| 2026-02-26 | AI Copilot Deploy Guide corrected: Two-App approach (Vercel Frontend + Railway Backend) |
| 2026-02-25 | FeeRouterV1: EIP-712 Voucher, Protocol Fee Routing, Whitelisted Adapters, Pause, 13 Tests, Sepolia deployed + verified |
| 2026-02-25 | Points Backend: SIWE Auth, Points Events, EIP-712 Voucher Issuance, Anti-Sybil Rate Limiting, 20 Tests |
| 2026-02-24 | IFR AI Copilot: React 18 + Vite + TS + Tailwind, Express API Proxy, Claude Haiku 4.5, 3 modes (Customer/Partner/Developer), RAG Knowledge Base, Safety Guards |
| 2026-02-24 | Testnet E2E Guide: 8-step Sepolia walkthrough (MetaMask, Lock, Benefits Network QR flow, Governance Dashboard, PartnerVault Rewards) |
| 2026-02-24 | SDK Quickstart v1.0: ethers.js v5, wagmi v2, Python (web3.py), Tier System, Wallet Signature Verification, go-live checklist |
| 2026-02-24 | Creator Gateway Spec v0.1: YouTube Hybrid Model B, Docker Quickstart, Entitlement Rules Engine, API Endpoints |
| 2026-02-24 | WHITEPAPER.md v1.0: Completely rewritten as non-technical one-pager for builders & investors |
| 2026-02-24 | Mainnet preparation: MAINNET_CHECKLIST.md, AUDIT_BRIEF.md, MULTISIG_SETUP.md |
| 2026-02-24 | Builder Integration Spec: IFRLock + PartnerVault ABI, Reward Mechanics, Algo Throttle, AuthorizedCaller, Checklists |
| 2026-02-24 | Governance Constitution v1.0 + Business Onboarding Guide created |
| 2026-02-24 | Governance Dashboard: React 18 + Vite + TS + Tailwind (Overview, Builders, Timelock Queue, Calldata Generator) |
| 2026-02-23 | PartnerVault Upgrade: authorizedCaller Whitelist, Anti-Double-Count, Algo Emission Throttle (95 Tests) |
| 2026-02-23 | Benefits Network: Backend (Express + Prisma, 8 Tests) + Frontend (Next.js 14 PWA, wagmi v2) |
| 2026-02-23 | PartnerVault.sol implemented (549 LOC, 95 Tests): Milestone-Unlocking + Lock-triggered Creator Rewards, SafeERC20, Governance Parameters |
| 2026-02-23 | 6 doc inconsistencies fixed: PartnerVault, Creator Rewards, Bootstrap Pricing, Governance separation, old tier numbers replaced |
| 2026-02-22 | Governance Proposal #1 executed: setFeeExempt(IFRLock, true) -- Full Lock/Unlock Cycle verified (8/8) |
| 2026-02-20 | IFRLock Contract implemented (127 LOC, 29 Tests): Generic Token Lock, ReentrancyGuard, Pause, Multi-App lockType |
| 2026-02-20 | Governance Proposal #0 executed: setFeeExempt via 48h Timelock -- Full Governance Lifecycle verified |
| 2026-02-18 | Sepolia Smoke Test (11/11 PASS): Fee Transfer, Burn, Governance Proposal, Contract State |
| 2026-02-18 | Live Fee-on-Transfer Verification Script (test-transfer.js), ALL CHECKS PASSED |
| 2026-02-18 | Dashboard Phase 2: Complete Governance UI (Proposals, Create, Execute, Cancel) |
| 2026-02-16 | LP Pairing Script created (create-lp.js), Router Update integrated |
| 2026-02-15 | Slither Audit passed, 15 fixes applied, Deploy dry-run successful |
| 2026-02-15 | Governance.sol implemented (150 LOC, 36 Tests) |
| 2026-02-15 | CFLM Migration: LiquidityReserve new, Vesting formula fix, BuybackVault Activation Delay, Presale removed |
| 2026-02-15 | BurnReserve implemented (86 LOC, 21 Tests) |
| 2026-02-15 | Status report created and updated |
| 2025-09-25 | Documentation revised |
| 2025-09-24 | BuybackVault implemented |
| 2025-09-23 | Presale + Vesting implemented |
| 2025-09-23 | InfernoToken implemented |

---

## Deploy

### Preparation

```bash
cp .env.example .env
# Fill .env with real values (RPC URL, Private Key, Addresses)
```

### Dry-Run (local)

```bash
npx hardhat run scripts/deploy-testnet.js
```

### Testnet (Sepolia)

```bash
npx hardhat run scripts/deploy-testnet.js --network sepolia
```

### Mainnet -- Dry-Run (local)

```bash
npx hardhat run scripts/deploy-mainnet.js --network hardhat
```

### Mainnet -- Live

```bash
# Env vars MUST be set: TREASURY_ADDRESS, COMMUNITY_ADDRESS, TEAM_BENEFICIARY, VOUCHER_SIGNER_ADDRESS
npx hardhat run scripts/deploy-mainnet.js --network mainnet
```

### Deploy Flow (9 Steps)

```
Step 1/9  Deploy InfernoToken (1B IFR to Deployer)
Step 2/9  Deploy LiquidityReserve (6mo lock, 50M/quarter)
Step 3/9  Deploy Vesting (12mo cliff, 36mo linear, 150M)
Step 4/9  Deploy BurnReserve + BuybackVault (60d activation)
Step 5/9  (BurnReserve already in Step 4)
Step 6/9  Deploy Governance (48h Timelock)
Step 7/9  Set feeExempt (all contracts + deployer temporarily)
Step 8/9  Distribute tokens (200M+150M+150M+60M+40M, 400M stays with Deployer)
Step 9/9  Remove deployer feeExempt
```

### LP Pairing (Uniswap V2)

```bash
npx hardhat run scripts/create-lp.js --network sepolia
```

### Post-Deploy Checklist

| # | Step | Status |
|---|------|--------|
| 1 | Deploy contracts | **Done** (9/9) |
| 2 | Verify on Etherscan | **Done** (9/9) |
| 3 | Create LP | **Done** |
| 4 | Transfer ownership | **Done** |
| 5 | Execute Governance Proposal #0 | **Done** (setFeeExempt via 48h Timelock) |

---

## Open Items

| # | Task | Priority | Status |
|---|------|----------|--------|
| 1 | Testnet Deploy (Sepolia) | Next step | **Done** (9 Contracts live + LP Pair) |
| 2 | Etherscan Verification | Post-deploy | **Done** (9/9 verified) |
| 3 | Security Audit (Slither) | Recommended | **Done** (v0.11.5, 0 High/Critical) |
| 4 | Uniswap LP Pairing | Pre-launch | **Done** |
| 5 | Router/Addresses set | Pre-launch | **Done** (Uniswap V2 Router02) |
| 6 | Ownership -> Governance | Pre-launch | **Done** |
| 7 | Dashboard Phase 2 (Governance UI) | Post-deploy | **Done** |
| 8 | Live Fee Verification (Sepolia) | Post-deploy | **Done** (ALL CHECKS PASSED) |
| 9 | Sepolia Smoke Test (Full Protocol) | Post-deploy | **Done** (11/11 PASS) |
| 10 | Governance Lifecycle (Proposal #0) | Post-deploy | **Done** (setFeeExempt via Timelock) |
| 11 | Governance Proposal #1 (IFRLock feeExempt) | Post-deploy | **Done** (8/8 Lock/Unlock Tests) |
| 12 | Gas Optimization | Optional | Open |
| 13 | Doc Inconsistencies (6 tickets) | High | **Done** (PartnerVault, Creator Rewards, Bootstrap Pricing) |
| 14 | Mainnet Deployment | Critical | **Done** (2026-03-05, 9 contracts deployed + verified) |
