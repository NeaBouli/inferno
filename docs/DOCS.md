<p align="center">
  <img src="assets/ifr_logo.png" alt="Inferno $IFR" width="200" />
</p>

# Inferno – Projektstatus & Struktur

## Legende
- [x] erledigt — Code + Tests abgeschlossen, stabil
- [ ] offen — noch nicht implementiert oder in Arbeit

---

## Repository-Struktur

```
inferno/
├── contracts/
│   ├── token/InfernoToken.sol          [x] 93 LOC, 22 Tests
│   ├── liquidity/LiquidityReserve.sol  [x] 151 LOC, 36 Tests
│   ├── vesting/Vesting.sol             [x] 132 LOC, 21 Tests
│   ├── buyback/BuybackVault.sol        [x] 175 LOC, 20 Tests
│   ├── burnreserve/BurnReserve.sol     [x] 92 LOC, 21 Tests
│   ├── governance/Governance.sol       [x] 150 LOC, 36 Tests
│   ├── lock/IFRLock.sol               [x] 127 LOC, 37 Tests
│   ├── partner/PartnerVault.sol       [x] 549 LOC, 95 Tests
│   ├── FeeRouterV1.sol               [x] 228 LOC, 33 Tests
│   └── mocks/                          MockToken, MockRouter, MockInfernoToken, MockAdapter
├── test/
│   ├── InfernoToken.test.js            [x] 258 LOC
│   ├── LiquidityReserve.test.js        [x] 283 LOC
│   ├── Vesting.test.js                 [x] 112 LOC
│   ├── BuybackVault.test.js            [x] 149 LOC
│   ├── BurnReserve.test.js             [x] 212 LOC
│   ├── Governance.test.js              [x] 320 LOC
│   ├── IFRLock.test.js                [x] 363 LOC
│   ├── PartnerVault.test.js           [x] 480 LOC
│   └── FeeRouterV1.test.js           [x] 500 LOC
├── scripts/
│   ├── deploy-testnet.js               [x] 232 LOC (9-Step CFLM Deploy)
│   ├── create-lp.js                    [x] 4-Step LP Pairing + Router Update
│   ├── test-transfer.js               [x] Live Fee-on-Transfer Verification
│   ├── sepolia-smoke-test.js          [x] Full Protocol Smoke Test (11 Checks)
│   ├── execute-proposal.js           [x] Governance Proposal Executor (Status/ETA/Execute/Verify)
│   ├── deploy-lock.js                [x] IFRLock Deploy + Governance Proposal
│   ├── test-lock.js                  [x] IFRLock Live Test (Lock/Unlock/isLocked)
│   ├── deploy-feerouter.js           [x] FeeRouterV1 Deploy + Verify
│   ├── update-stats.js              [x] Auto-Update On-Chain Stats → docs/stats.json + TRANSPARENCY.md + index.html
│   ├── onchain-audit.js             [x] 8-Check On-Chain Audit (Ownership, LP, Vesting, Supply, FeeExempt)
│   ├── propose-ownership-transfer.js [x] Ownership Transfer Proposals (3 Contracts, DRY RUN Schutz)
│   ├── execute-ownership-transfer.js [x] Ownership Transfer Executor (nach 48h Timelock)
│   ├── burn-lp-tokens.js            [x] LP Token Burn → 0xdead (DRY RUN Schutz, irreversibel)
│   └── check-links.js              [x] Dead Link Checker (interne Links in docs/)
├── tasks/
│   └── admin.js                       [x] Hardhat CLI Tasks (lock-check, vault-status, feerouter-status, token-stats, gov-queue)
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md             [x] Bug Report Template
│   │   ├── feature_request.md        [x] Feature Request Template
│   │   └── security.md              [x] Security Advisory Redirect
│   ├── pull_request_template.md      [x] PR Template mit Checkliste
│   └── workflows/
│       ├── creator-gateway.yml       [x] CI: tsc + jest
│       ├── points-backend.yml        [x] CI: prisma generate + tsc + jest
│       ├── ai-copilot.yml           [x] CI: tsc + build
│       ├── update-stats.yml         [x] Cron: taeglich 06:00 UTC On-Chain Stats Update
│       └── post-deploy.yml          [x] Trigger: nach deploy/execute Script Push
├── apps/
│   ├── dashboard/                      [x] React + Vite Frontend (Phase 1 + Phase 2 + LockPanel)
│   ├── governance-dashboard/          [x] React + Vite + TS + Tailwind (Overview, Partners, Timelock, Calldata, ProposalAlert)
│   ├── partner-directory/             [x] Static HTML (Partner Cards, Filter, CTA)
│   ├── ai-copilot/                   [x] React + Vite + TS + Tailwind + Express (3 Modi, RAG, Safety Guards)
│   ├── points-backend/               [x] Express + Prisma + SQLite + siwe + jose (SIWE Auth, Points, EIP-712 Voucher, 35 Tests)
│   ├── creator-gateway/              [x] Express + ethers v5 + googleapis + JWT (YouTube x IFR Lock Bridge, Port 3005, 32 Tests)
│   └── benefits-network/
│       ├── backend/                   [x] Express + Prisma + SQLite (8 Tests)
│       └── frontend/                  [x] Next.js 14 + Tailwind + wagmi v2 (PWA)
├── docs/
│   ├── DOCS.md                         Dieses Dokument
│   ├── FAIR-LAUNCH-MIGRATION.md        CFLM Migrationsplan
│   ├── WHITEPAPER.md                   Project Whitepaper v1.0 (Partner & Investoren, non-technical)
│   ├── WHITEPAPER_EN.md                Whitepaper (EN, veraltet)
│   ├── CHANGELOG.md                    Aenderungsprotokoll
│   ├── KNOWN-ISSUES.md                 Bekannte Probleme
│   ├── SECURITY-AUDIT.md               Slither Audit Report
│   ├── DEPLOYMENTS.md                  Sepolia Contract-Adressen
│   ├── GOVERNANCE_CONSTITUTION.md     Governance Constitution v1.0 (Hard Bounds, Rollen, Upgrade-Pfad)
│   ├── BUSINESS_ONBOARDING.md         Business Onboarding Guide (Benefits Network Setup & Go-Live)
│   ├── PARTNER_INTEGRATION_SPEC.md    Technische Partner-Integration Spec (IFRLock + PartnerVault ABI, Rewards, Algo Throttle)
│   ├── MAINNET_CHECKLIST.md           Deployment Checkliste (3 Phasen)
│   ├── AUDIT_BRIEF.md                 Security Audit Brief + Scope
│   ├── MULTISIG_SETUP.md              Gnosis Safe 4-of-7 Setup Guide
│   ├── CREATOR_GATEWAY.md             Creator Gateway Spec v0.1 (YouTube Hybrid, Docker, Entitlement Engine)
│   ├── SDK_QUICKSTART.md              Developer Quickstart v1.0 (ethers.js, wagmi, Python, Tier System)
│   ├── TESTNET_GUIDE.md               Sepolia E2E Guide (Lock, Benefits Network, Governance, PartnerVault, FeeRouter)
│   ├── CHATGPT_AUDIT_PROMPT_V2.md    Independent Audit Checklist (7 Pruefbereiche A-G)
│   ├── E2E_FLOW.md                    Points → Voucher → FeeRouter End-to-End Flow
│   ├── YOUTUBE_INTEGRATION.md         YouTube × IFR Hybrid Model B, Creator Gateway, Entitlement Config
│   ├── SECURITY_POLICY.md             Responsible Disclosure, Bug Bounty, Scope, Known Design Decisions
│   ├── TOKENOMICS_MODEL.md            Deflationskurve, Allocation, PartnerVault Emission, Lock Economics, FeeRouter Fee
│   ├── PARTNER_REWARDS_SPEC.md        Reward-Formel, Vesting, Anti-Gaming, Partner-Typen (A/B/C), Onboarding
│   ├── PATCH-GUIDELINES.md             Patch-Richtlinien v1.0 (6 Schritte, Versionierung, Notfall-Patches)
│   ├── COVERAGE_REPORT.md             Solidity Coverage Report (99% Stmts, 91% Branch, 98% Funcs, 99% Lines, Final Run)
│   ├── BENEFITS_NETWORK_TEST.md       Benefits Network E2E Test Guide (Test-Flow, API, Lock Tiers, Fehler)
│   ├── PROJECT-SUMMARY.md             Komplett-Uebersicht (10 Contracts, 396 Tests, 7 Apps, CI/CD)
│   ├── CONTRIBUTING.md                Contributing Guide v1.0 (Bug Reports, Code Standards, Git Konventionen)
│   ├── TRANSPARENCY.md               On-Chain Transparency Report (8 Checks, Supply, Vesting, LP, Mainnet TODOs)
│   ├── ONE-PAGER.md                  Investor One-Pager (Key Numbers, Produkte, Technologie, Vor-Mainnet)
│   ├── CHATGPT_AUDIT_PROMPT_V3.md   Independent Audit V3 (8 Pruefbereiche: Transparency, LP Lock, Konsistenz, Scripts)
│   ├── FEE_DESIGN.md                Fee Design v1.0 (Warum 3.5%, Fee-Exempt, CEX-Strategie, MEV/Slippage)
│   ├── FAIR_LAUNCH.md               Fair Launch Statement (No Presale, No VC, Allocation Vergleich, On-Chain Beweise)
│   ├── OFFCHAIN_SECURITY.md         Off-Chain Security (VoucherSigner, JWT, SIWE, Rate Limiting, Secrets Checkliste)
│   ├── AUDIT_SUBMISSION.md          Audit Submission Prep (Code4rena/Sherlock, 9 Contracts, 1697 SLOC, Known Issues)
│   ├── CHATGPT_AUDIT_V3_RESULTS.md Audit V3 Ergebnisse (12/12 PASS, Methodik, Findings)
│   ├── CHATGPT_AUDIT_PROMPT_V4.md Independent Audit V4 (8 Self-Checks: Anti-Sybil, SIWE, Integration, Zahlen, RAG, Voucher, CHANGELOG, Deployment)
│   ├── RAILWAY_ENV.md               Points Backend Railway Deploy (Env Vars, CLI Setup, Health Check)
│   ├── VERCEL_ENV.md                AI Copilot Vercel + Railway Deploy (Two-App, Proxy, Env Vars)
│   ├── PAGE_UPDATE_CHECKLIST.md    Welche Dateien bei welchem Event aktualisiert werden muessen
│   ├── DASHBOARD_TEST_RESULTS.md   Dashboard Build-Ergebnisse (0 Errors, 198 Modules)
│   ├── BENEFITS_E2E_RESULTS.md     Benefits Network E2E Checkliste (Backend, API, Sepolia)
│   ├── PRESS_KIT.md                 Press Kit (Key Facts, Token-Allokation, Roadmap, Links)
│   ├── GITHUB_SECRETS.md            GitHub Actions Secrets Dokumentation
│   ├── ROADMAP.md                   6-Phasen Roadmap (Foundation → DAO)
│   ├── stats.json                   Auto-generierte On-Chain Stats (via update-stats.js)
│   ├── RELEASE_NOTES_v0.1.0.md        Erster getaggter Release (Sepolia Testnet)
│   ├── LIGHTHOUSE_REPORT.md           SEO-Optimierungen (OG, Twitter Card, Meta Tags, Sitemap, robots.txt)
│   ├── COPILOT_TEST_RESULTS.md        AI Copilot RAG Test (6 Fragen, 3 Modi, Safety Guards)
│   ├── ROADMAP_v0.2.0.md             Mainnet-Ready Milestones (Audit, Multisig, Deploy, Post-Launch)
│   ├── CHATGPT_AUDIT_V4_RESULTS.md    Audit V4 Ergebnisse (8/8 PASS)
│   ├── GITHUB_SETUP.md               Repository Setup (Discussions, Topics, Pages)
│   ├── robots.txt                     Crawler-Steuerung (Allow: /, Sitemap-Link)
│   ├── sitemap.xml                    15 URLs (Landing + 14 Wiki-Seiten)
│   └── wiki/                          [x] 14 HTML-Seiten (index, contracts, tokenomics, lock, governance, security, deployment, integration, agent, faq, transparency, fair-launch, fee-design, roadmap)
├── STATUS-REPORT.md                    Vollstaendiger Statusbericht
└── README.md                           Projekt-Uebersicht
```

---

## Module

### 1. InfernoToken — [x] FERTIG
- **Pfad:** `contracts/token/InfernoToken.sol`
- **Tests:** 22 (InfernoToken.test.js)
- **Beschreibung:** ERC20 + ERC20Burnable + Ownable, 9 Decimals, 1B Supply
- **Features:** Fee-on-Transfer (2% Sender Burn, 0.5% Recipient Burn, 1% Pool Fee), Fee Exemption, Owner-Functions (setFeeRates, setFeeExempt, setPoolFeeReceiver), Max 5% Fee Cap

### 2. LiquidityReserve — [x] FERTIG
- **Pfad:** `contracts/liquidity/LiquidityReserve.sol`
- **Tests:** 36 (LiquidityReserve.test.js)
- **Beschreibung:** Strategic Reserve fuer 200M IFR
- **Features:** 6-Monats-Lock, gestaffelte Freigabe (50M pro Quartal), Perioden-Tracking, Guardian Pause, Owner-Withdraw nach Lock

### 3. Vesting — [x] FERTIG
- **Pfad:** `contracts/vesting/Vesting.sol`
- **Tests:** 21 (Vesting.test.js)
- **Beschreibung:** Team Vesting fuer 150M IFR
- **Features:** Post-Cliff-Formel (12mo Cliff, 36mo linear), Guardian Pause, Beneficiary Release
- **Formel:** `(totalAllocation * (elapsed - cliff)) / (duration - cliff)`

### 4. BuybackVault — [x] FERTIG
- **Pfad:** `contracts/buyback/BuybackVault.sol`
- **Tests:** 20 (BuybackVault.test.js)
- **Beschreibung:** ETH-zu-IFR Buyback mit automatischem Split
- **Features:** 50/50 Split (BurnReserve + Treasury), Cooldown (1h), Slippage Protection (5%), 60-Tage-Aktivierungssperre, Guardian Pause

### 5. BurnReserve — [x] FERTIG
- **Pfad:** `contracts/burnreserve/BurnReserve.sol`
- **Tests:** 21 (BurnReserve.test.js)
- **Beschreibung:** Permanentes Token-Burning mit Tracking
- **Features:** deposit(), burn(), burnAll(), totalBurned-Zaehler, ERC20Burnable (totalSupply sinkt), Owner + Guardian Auth

### 6. Governance — [x] FERTIG
- **Pfad:** `contracts/governance/Governance.sol`
- **Tests:** 36 (Governance.test.js)
- **Beschreibung:** Timelock Governor fuer alle Protokoll-Parameter
- **Features:** propose/execute/cancel, Delay 1h–30d (default 48h), Guardian Emergency Cancel, Self-Governance (setDelay via eigenen Timelock), Integration mit InfernoToken (transferOwnership)

### 7. IFRLock — [x] FERTIG
- **Pfad:** `contracts/lock/IFRLock.sol`
- **Tests:** 37 (IFRLock.test.js)
- **Beschreibung:** Generic IFR Token Lock ohne Rewards/Vesting
- **Features:** lock(amount), lockWithType(amount, lockType), unlock(), isLocked(user, minAmount), lockInfo(), ReentrancyGuard, Emergency Pause (nur lock), Guardian Auth, Multi-App lockType Tag

### 8. PartnerVault — [x] FERTIG
- **Pfad:** `contracts/partner/PartnerVault.sol`
- **Tests:** 95 (PartnerVault.test.js)
- **Beschreibung:** Partner Ecosystem Pool (40M IFR) mit Milestone-Unlocking + Lock-triggered Creator Rewards
- **Features:** createPartner, activatePartner, recordMilestone, recordLockReward (lockAmount × effectiveBps, wallet), claim (linear Vesting mit Cliff), finalizeMilestones, SafeERC20, ReentrancyGuard, Pausable, Guardian Auth, Governance-kontrollierte Parameter (rewardBps 5-25%, annualEmissionCap, partnerCap) mit min/max Bounds, Annual Cap Reset, authorizedCaller Whitelist, Anti-Double-Count (wallet→partner), Algo Emission Throttle (lockRatio-basierte BPS-Skalierung via IIFRLock)
- **Sepolia:** rewardBps=1500 (15%), annualCap=4M IFR, Adresse: `0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39`
- **Mainnet-Empfehlung:** rewardBps=1000 (10%), annualCap=4M IFR, partnerCap=100K IFR/Partner (skalierbar fuer 500-1000+ Partner)
- **KRITISCH:** feeExempt MUSS VOR dem 40M Transfer gesetzt werden (Sepolia-Lesson: 1.4M IFR Fee-Verlust)

### 9. FeeRouterV1 (`contracts/FeeRouterV1.sol`) — 228 LOC, 33 Tests
- **Zweck:** Protocol fee routing mit EIP-712 signierte Discount-Voucher
- **Features:** swapWithFee (adapter-basiert), DiscountVoucher (EIP-712 signiert), Replay-Protection (nonce), Whitelisted Adapters, Governance-steuerbare Fee (0-25 bps), Pause
- **Sepolia:** protocolFeeBps=5 (0.05%), FEE_CAP_BPS=25 (0.25%), Adresse: `0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4`
- **Integration:** Points Backend signiert Voucher via EIP-712, FeeRouterV1 validiert on-chain

### Entfernt
- ~~Presale.sol~~ — Entfernt bei CFLM-Migration (kein Presale im Fair Launch Modell)

---

## Zusammenfassung

| Metrik | Wert |
|--------|------|
| Contracts | 10 (+ 4 Mocks) |
| Solidity LOC | 1,697 |
| Tests | 321 (alle bestanden) |
| Branch Coverage | 91% |
| Test LOC | 2,402 |
| Deploy Script | 232 LOC, 9 Steps |
| Modell | CFLM (Community Fair Launch) |
| Compiler | 0 Errors, 0 Warnings |

---

## Changelog

| Datum | Aenderung |
|-------|-----------|
| 2026-02-26 | PRESS_KIT.md: Press Kit (112 Zeilen, Key Facts, Token-Allokation, Roadmap, Links, Medien) |
| 2026-02-26 | GITHUB_SECRETS.md: GitHub Actions Secrets Dokumentation (Pflicht + Optional, Workflows, Environments) |
| 2026-02-26 | CHANGELOG v0.1.0: [Unreleased] → [v0.1.0], git tag v0.1.0 erstellt |
| 2026-02-26 | Benefits Network E2E Test v2: Health OK, Business + Session erstellt, Route-Korrekturen dokumentiert |
| 2026-02-26 | Points Backend: .dockerignore erstellt, Dockerfile + railway.json verifiziert |
| 2026-02-26 | AI Copilot: server/Dockerfile erstellt, VERCEL_ENV.md Deploy Steps hinzugefuegt |
| 2026-02-26 | Consistency Check: 7/7 bestanden (Test-Zahlen, 40M, Proposal #3, Wiki 13, .env, keine Keys) |
| 2026-02-26 | ChatGPT Audit V3: 8 → 12 Checks erweitert (PRESS_KIT, ROADMAP, v0.1.0, GitHub Templates), 12/12 PASS |
| 2026-02-26 | LockPanel.jsx: Lock/Unlock UI im Token Dashboard (Approve, Lock, Unlock, Tier-Anzeige, Balance, TX-Links) |
| 2026-02-26 | Partner Directory: apps/partner-directory/index.html (4 Integration Slots, Filter, CTA, Landing Page Nav-Link) |
| 2026-02-26 | ProposalAlert.tsx: Notification-Banner im Governance Dashboard (Pending/Ready Proposals, Countdown, Dismiss) |
| 2026-02-26 | ROADMAP.md: 6-Phasen Roadmap (Foundation → Governance → Ecosystem → Mainnet → Growth → DAO) |
| 2026-02-26 | Landing Page: Roadmap Phase 3/5 korrigiert (Multi-Chain entfernt, Full Roadmap Link) |
| 2026-02-26 | IFRLock ABI: lock() + unlock() Write-Functions hinzugefuegt (Dashboard) |
| 2026-02-25 | .env.example: Deployed Contract Addresses hinzugefuegt (TOKEN, GOVERNANCE, IFRLOCK, PARTNERVAULT, FEEROUTER) |
| 2026-02-25 | token-stats Task Fix: burnFeeBps → senderBurnBps + recipientBurnBps + totalFeeBps |
| 2026-02-25 | Benefits Network E2E Test: Script + Test Guide (docs/BENEFITS_NETWORK_TEST.md) |
| 2026-02-25 | Governance Wiki: Proposal Details erweitert (Targets, Reasons, Proposer) + Governance Learnings Sektion |
| 2026-02-25 | Solidity Coverage: solidity-coverage installiert, Report generiert (99% Stmts, 85% Branch) |
| 2026-02-25 | PROJECT-SUMMARY.md: Komplett neu geschrieben (10 Contracts, 324 Tests, 7 Apps, Coverage, CI/CD, Token-Metriken) |
| 2026-02-25 | Creator Gateway Tests: 14 Tests (lock-checker, entitlement OR/AND, auth routes) mit Jest + ts-jest + supertest |
| 2026-02-25 | Dashboard: ProtocolStats Komponente (IFRLock totalLocked, PartnerVault Balance, FeeRouter Fee, Reward Rate, Auto-refresh 30s) |
| 2026-02-25 | PATCH-GUIDELINES.md v1.0: 6-Schritt Prozess, Severity-Matrix, Smart Contract Patch Rules, Versionierung, Notfall-Patches |
| 2026-02-25 | GitHub Actions CI: Creator Gateway (tsc+jest), Points Backend (prisma+tsc+jest), AI Copilot (tsc+build) |
| 2026-02-25 | Deployment Wiki: Proposal #3 Info-Box mit Scripts + 1.4M IFR Top-up Step |
| 2026-02-26 | update-stats.js: Auto-Update Script (Sepolia → stats.json + TRANSPARENCY.md + STATUS-REPORT.md + index.html) |
| 2026-02-26 | GitHub Actions: update-stats.yml (daily cron 06:00 UTC) + post-deploy.yml (trigger nach deploy/execute push) |
| 2026-02-26 | Wiki index.html: Stats Cards erweitert (330 Tests, 99% Coverage, 2M+ Burned, 13 Wiki Pages, 48h Timelock) |
| 2026-02-26 | MULTISIG_SETUP.md v2.0: 3 Phasen (2-of-3 → 3-of-5 → 4-of-7), Guardian Multisig, Wallet-Anforderungen, Kosten, Checkliste |
| 2026-02-26 | Coverage Final: 98.89% Stmts, 84.65% Branch, 97.39% Funcs, 98.60% Lines (unveraendert) |
| 2026-02-26 | PROJECT-SUMMARY.md: FeeRouterV1 Coverage 100%/96% erledigt, Proposals #4-#6 aktualisiert |
| 2026-02-26 | CHATGPT_AUDIT_V3_RESULTS.md: Vollstaendige Ergebnisse mit Methodik (8/8 PASS, 1 Finding) |
| 2026-02-26 | WHITEPAPER.md: CFLM Section (Vergleich UNI/AAVE/COMP), Fee Design erweitert (Lock>Transfer, Fee-Exempt, CEX) |
| 2026-02-26 | RAILWAY_ENV.md: Points Backend Railway Deploy Guide (Env Vars, CLI, Health Check) |
| 2026-02-26 | VERCEL_ENV.md: AI Copilot Vercel + Railway Deploy (Two-App, Proxy Config, Env Vars) |
| 2026-02-26 | PAGE_UPDATE_CHECKLIST.md: Comprehensive Update-Matrix (7 Event-Typen, alle betroffenen Dateien) |
| 2026-02-26 | DASHBOARD_TEST_RESULTS.md: Build OK (0 Errors, 198 Modules, Bundle Sizes) |
| 2026-02-26 | BENEFITS_E2E_RESULTS.md: E2E Checkliste (Backend Health, API, Sepolia Integration) |
| 2026-02-26 | Governance Proposals #4-#6 scheduled: LiquidityReserve/BuybackVault/BurnReserve Ownership → Governance (ETA 28.02.) |
| 2026-02-26 | Wiki RAG: wiki-rag.ts, mode-spezifische System Prompts, 14 Wiki-Seiten als RAG-Kontext |
| 2026-02-26 | Voucher validate endpoint: GET /voucher/validate/:nonce (Status, Expiry, Usage) |
| 2026-02-26 | Anti-Sybil: lockProof.ts + captcha.ts Middleware, Voucher braucht Lock, Points braucht Captcha |
| 2026-02-26 | Creator Gateway SIWE: siwe-Paket, Nonce/Verify Flow, JWT-Ausgabe nach SIWE-Verifikation |
| 2026-02-26 | Branch Coverage: 85% → 91% (BuybackVault 62→94%, Vesting 69→97%, LiquidityReserve 87→97%) |
| 2026-02-26 | IFRLock Edge Case Tests: +8 Tests (1-wei, max balance, boundary, cycle, lockInfo reset) |
| 2026-02-26 | Release Notes v0.1.0: docs/RELEASE_NOTES_v0.1.0.md |
| 2026-02-26 | Wiki roadmap.html: 14. Wiki-Seite, Sidebar in allen 14 Seiten aktualisiert |
| 2026-02-26 | Dead Link Check: scripts/check-links.js (283 Links, 3 gefixt, 0 broken) |
| 2026-02-26 | Lighthouse Meta Tags: OG + Twitter Card + robots + theme-color + canonical auf Landing Page |
| 2026-02-26 | Test-Counts: 276 → 315 Contract Tests (BuybackVault +11, Vesting +14, LiquidityReserve +6, IFRLock +8) |
| 2026-02-26 | AI Copilot TS Fix: IFRCopilot.tsx window cast (as unknown as Record) — Build 0 Errors |
| 2026-02-26 | FeeRouterV1 Tests: 13 → 33 (isVoucherValid, setVoucherSigner, setFeeCollector, receive(), access control, signer rotation) |
| 2026-02-26 | Creator Gateway YouTube Mock Tests: 6 Tests (isMember mock, fail-closed, API errors) — Gesamt: 26 Tests |
| 2026-02-26 | Wiki Security: solidity-coverage Tabelle hinzugefuegt (pro Contract), FeeRouterV1 Test-Suite Zeile |
| 2026-02-26 | Mainnet Checklist v1.1: FeeRouter Schritt, Status-Summary, Sepolia-Meilensteine, korrekte Test-Zahlen |
| 2026-02-26 | Test-Counts synchronisiert: 276 Contract Tests (InfernoToken 22, LiquidityReserve 30, FeeRouterV1 33), 330 Gesamt |
| 2026-02-26 | Coverage aktualisiert: 95%/81% → 99%/85% Stmts/Branch (FeeRouterV1 100%/96%), alle Docs synchronisiert |
| 2026-02-26 | Benefits Network CI Workflow: .github/workflows/benefits-network.yml (test-backend + test-frontend) |
| 2026-02-26 | Creator Gateway access.test.ts: 6 Access-Route Tests (auth 401, granted/denied, YouTube detect, no-wallet) — 26 Tests gesamt |
| 2026-02-26 | gov-queue Task Fix: queryFilter → getProposal() Loop (zeigt Status PENDING/READY/EXECUTED/CANCELLED) |
| 2026-02-26 | Landing Page FAQ: 5 neue Eintraege (FeeRouter, Points, Creator Gateway, Security, Mainnet Launch) — 24 FAQ gesamt |
| 2026-02-26 | Wiki FAQ Seite: docs/wiki/faq.html — 30 Q&A in 6 Sektionen, Sidebar in allen 10 Wiki-Seiten aktualisiert |
| 2026-02-26 | CONTRIBUTING.md: Contributing Guide v1.0 (Bug Reports, Code Standards, Git Konventionen, Review Prozess) |
| 2026-02-26 | TRANSPARENCY.md: On-Chain Transparency Report (8 Checks, Supply, Vesting, LP, FeeExempt, Mainnet TODOs) |
| 2026-02-26 | MAINNET_CHECKLIST.md: Kritische LP Lock + Ownership Transfer Sektion, Deployer Wallet Reduktion |
| 2026-02-26 | Wiki Security: On-Chain Audit Sektion (Ownership-Tabelle, Supply-Verteilung, Vesting, Deflation) |
| 2026-02-26 | Landing Page: On-Chain Transparency Sektion (4 Stat-Cards: Vesting, Burned, Governance, Tests) |
| 2026-02-26 | propose-ownership-transfer.js: 3 Ownership Transfer Proposals (Reserve, Buyback, Burn → Governance) mit DRY RUN |
| 2026-02-26 | execute-ownership-transfer.js: Ownership Transfer Executor (nach 48h Timelock, Status-Check) |
| 2026-02-26 | burn-lp-tokens.js: LP Token Burn → 0xdead (DRY RUN Schutz, 3s Countdown, irreversibel) |
| 2026-02-26 | Wiki transparency.html: On-Chain Transparency Report (8 Checks, Etherscan Links, TODOs, Verify-Anleitung) |
| 2026-02-26 | Sidebar: transparency.html in allen 11 Wiki-Seiten verlinkt |
| 2026-02-26 | WHITEPAPER.md: Sektion 9 (On-Chain Transparency) + Test-Count 276→330, Sektionen 10-12 renummeriert |
| 2026-02-26 | ONE-PAGER.md: Investor One-Pager (Key Numbers, Produkte, Technologie, Vor-Mainnet Checklist) |
| 2026-02-26 | CHATGPT_AUDIT_PROMPT_V3.md: 8 Pruefbereiche (Transparency, LP Lock, Konsistenz, Ownership, One-Pager, Wiki, Scripts, Sicherheitsversprechen) |
| 2026-02-26 | Coverage Final: 98.89% Stmts, 84.65% Branch (unveraendert, bestaetigt) |
| 2026-02-26 | FEE_DESIGN.md: Fee Design v1.0 (Warum 3.5%, Fee-Exempt Adressen, CEX-Strategie, MEV/Slippage) |
| 2026-02-26 | Landing Page FAQ: 3 neue Eintraege (Why 3.5%, CEX, Fee-Exempt) — 27 FAQ gesamt |
| 2026-02-26 | Wiki FAQ: 5 neue Fee-Fragen (3.5% Why, Fee-Exempt, BuybackVault, DEX-Kompatibilitaet, BPS) — 35 Q&A gesamt |
| 2026-02-26 | FAIR_LAUNCH.md: Fair Launch Statement (No Presale, No VC, Allocation Vergleich, On-Chain Beweise) |
| 2026-02-26 | Landing Page: Fair Launch Detail Box (No Presale, No VC, No IDO + Link zu FAIR_LAUNCH.md) |
| 2026-02-26 | OFFCHAIN_SECURITY.md: Off-Chain Security (VoucherSigner Key Management, JWT, SIWE, Rate Limiting, Secrets) |
| 2026-02-26 | .gitignore erweitert: .env.local, .env*.local, *.pem, *.key |
| 2026-02-26 | Points Backend: Voucher Issuance Logging ([VOUCHER] wallet, issued, discount, nonce) |
| 2026-02-26 | AUDIT_SUBMISSION.md: Audit Prep (Code4rena/Sherlock, 9 Contracts, 1697 SLOC, Known Issues, Checklist) |
| 2026-02-26 | CHATGPT_AUDIT_V3_RESULTS.md: Audit Ergebnisse Platzhalter, Self-Check 8/8 PASS |
| 2026-02-26 | NatSpec: InfernoToken.sol (14 Tags), Vesting.sol (19), BuybackVault.sol (19), PartnerVault.sol (61), BurnReserve.sol (12), LiquidityReserve.sol (19) |
| 2026-02-26 | Wiki fair-launch.html: Fair Launch Wiki (Allocation, Vergleich, On-Chain Proof, Vesting Details) |
| 2026-02-26 | Wiki fee-design.html: Fee Design Wiki (Warum 3.5%, Fee-Exempt, CEX, Slippage Guide) |
| 2026-02-26 | Wiki Sidebar: 13 Seiten (fair-launch + fee-design in allen Wiki-Seiten verlinkt) |
| 2026-02-26 | .github/ISSUE_TEMPLATE/: Bug Report, Feature Request, Security Templates |
| 2026-02-26 | .github/pull_request_template.md: PR Template mit Checkliste |
| 2026-02-26 | CHANGELOG.md: Vollstaendiger [Unreleased] Eintrag (26.02.2026) mit Added/Changed/Fixed/Security |
| 2026-02-26 | FeeRouterV1.sol: NatSpec Kommentare fuer alle public/external Functions (contract, constructor, 8 Functions) |
| 2026-02-26 | Governance Constitution v1.0 erweitert (Artikel 1-7, FeeRouterV1 Parameter, Multisig Struktur, Verbotene Aktionen) |
| 2026-02-26 | Business Onboarding SOP erweitert (6 Schritte, Hosted + Self-Hosted, Tier-Konfiguration, Kassenpersonal Training, FAQ) |
| 2026-02-26 | YouTube Integration Guide: Hybrid Model B, Creator Gateway Setup, Entitlement Config, Monetarisierung, Roadmap |
| 2026-02-26 | Lock-Mechanism Wiki: Lock Economics, Creator Rewards Mechanismus, isLocked() Verification, Anti-Gaming Sektion |
| 2026-02-26 | Creator Gateway App: Express + ethers v5 + googleapis + JWT, YouTube x IFR Lock Bridge (14 files, Port 3005) |
| 2026-02-26 | Governance Wiki: Phase 4 DAO Roadmap (Token-Voting, Quorum, Milestones) |
| 2026-02-26 | Landing Page: Partner Directory Sektion (3 Placeholder-Slots: Business, Creator, Developer) |
| 2026-02-26 | Partner Rewards Spec: Reward-Formel, Vesting, Anti-Gaming, 3 Partner-Typen, Onboarding Flow |
| 2026-02-26 | Hardhat Admin Tasks: lock-check, vault-status, feerouter-status, token-stats, gov-queue (tasks/admin.js) |
| 2026-02-26 | Security Policy: Responsible Disclosure, Bug Bounty Framework, Scope, Known Design Decisions |
| 2026-02-26 | Tokenomics Model: Deflationskurve, Allocation, PartnerVault Emission, Lock Economics, FeeRouter Fee |
| 2026-02-26 | Integration Wiki: Creator Gateway, Points Backend API, FeeRouter Integration (Sektionen 15-17) |
| 2026-02-26 | Governance Wiki: Proposal #2 Cancellation Erklärung hinzugefügt |
| 2026-02-26 | AI Copilot Deploy Guide korrigiert: Two-App Approach (Vercel Frontend + Railway Backend) |
| 2026-02-25 | FeeRouterV1: EIP-712 Voucher, Protocol Fee Routing, Whitelisted Adapters, Pause, 13 Tests, Sepolia deployed + verified |
| 2026-02-25 | Points Backend: SIWE Auth, Points Events, EIP-712 Voucher Issuance, Anti-Sybil Rate Limiting, 20 Tests |
| 2026-02-24 | IFR AI Copilot: React 18 + Vite + TS + Tailwind, Express API Proxy, Claude Haiku 4.5, 3 Modi (Customer/Partner/Developer), RAG Knowledge Base, Safety Guards |
| 2026-02-24 | Testnet E2E Guide: 8-Schritt Sepolia-Walkthrough (MetaMask, Lock, Benefits Network QR-Flow, Governance Dashboard, PartnerVault Rewards) |
| 2026-02-24 | SDK Quickstart v1.0: ethers.js v5, wagmi v2, Python (web3.py), Tier System, Wallet Signature Verification, Go-Live Checkliste |
| 2026-02-24 | Creator Gateway Spec v0.1: YouTube Hybrid Model B, Docker Quickstart, Entitlement Rules Engine, API Endpoints |
| 2026-02-24 | WHITEPAPER.md v1.0: Komplett neu geschrieben als non-technical One-Pager fuer Partner & Investoren |
| 2026-02-24 | Mainnet-Vorbereitung: MAINNET_CHECKLIST.md, AUDIT_BRIEF.md, MULTISIG_SETUP.md |
| 2026-02-24 | Partner Integration Spec: IFRLock + PartnerVault ABI, Reward Mechanics, Algo Throttle, AuthorizedCaller, Checklisten |
| 2026-02-24 | Governance Constitution v1.0 + Business Onboarding Guide erstellt |
| 2026-02-24 | Governance Dashboard: React 18 + Vite + TS + Tailwind (Overview, Partners, Timelock Queue, Calldata Generator) |
| 2026-02-23 | PartnerVault Upgrade: authorizedCaller Whitelist, Anti-Double-Count, Algo Emission Throttle (95 Tests) |
| 2026-02-23 | Benefits Network: Backend (Express + Prisma, 8 Tests) + Frontend (Next.js 14 PWA, wagmi v2) |
| 2026-02-23 | PartnerVault.sol implementiert (549 LOC, 95 Tests): Milestone-Unlocking + Lock-triggered Creator Rewards, SafeERC20, Governance-Parameter |
| 2026-02-23 | 6 Doku-Inkonsistenzen gefixt: PartnerVault, Creator Rewards, Bootstrap Pricing, Governance Trennung, alte Tier-Zahlen ersetzt |
| 2026-02-22 | Governance Proposal #1 executed: setFeeExempt(IFRLock, true) — Full Lock/Unlock Cycle verified (8/8) |
| 2026-02-20 | IFRLock Contract implementiert (127 LOC, 29 Tests): Generic Token Lock, ReentrancyGuard, Pause, Multi-App lockType |
| 2026-02-20 | Governance Proposal #0 executed: setFeeExempt via 48h Timelock — Full Governance Lifecycle verified |
| 2026-02-18 | Sepolia Smoke Test (11/11 PASS): Fee Transfer, Burn, Governance Proposal, Contract State |
| 2026-02-18 | Live Fee-on-Transfer Verification Script (test-transfer.js), ALL CHECKS PASSED |
| 2026-02-18 | Dashboard Phase 2: Vollstaendige Governance UI (Proposals, Create, Execute, Cancel) |
| 2026-02-16 | LP Pairing Script erstellt (create-lp.js), Router-Update integriert |
| 2026-02-15 | Slither Audit bestanden, 15 Fixes applied, Deploy Dry-Run erfolgreich |
| 2026-02-15 | Governance.sol implementiert (150 LOC, 36 Tests) |
| 2026-02-15 | CFLM-Migration: LiquidityReserve neu, Vesting-Formel fix, BuybackVault Activation Delay, Presale entfernt |
| 2026-02-15 | BurnReserve implementiert (86 LOC, 21 Tests) |
| 2026-02-15 | Statusbericht erstellt und aktualisiert |
| 2025-09-25 | Dokumentation ueberarbeitet |
| 2025-09-24 | BuybackVault implementiert |
| 2025-09-23 | Presale + Vesting implementiert |
| 2025-09-23 | InfernoToken implementiert |

---

## Deploy

### Vorbereitung

```bash
cp .env.example .env
# .env mit echten Werten fuellen (RPC URL, Private Key, Adressen)
```

### Dry-Run (lokal)

```bash
npx hardhat run scripts/deploy-testnet.js
```

### Testnet (Sepolia)

```bash
npx hardhat run scripts/deploy-testnet.js --network sepolia
```

### Deploy-Ablauf (9 Steps)

```
Step 1/9  InfernoToken deployen (1B IFR an Deployer)
Step 2/9  LiquidityReserve deployen (6mo Lock, 50M/Quartal)
Step 3/9  Vesting deployen (12mo Cliff, 36mo linear, 150M)
Step 4/9  BurnReserve + BuybackVault deployen (60d Aktivierung)
Step 5/9  (BurnReserve bereits in Step 4)
Step 6/9  Governance deployen (48h Timelock)
Step 7/9  feeExempt setzen (alle Contracts + Deployer temporaer)
Step 8/9  Tokens verteilen (200M+150M+150M+60M+40M, 400M bei Deployer)
Step 9/9  Deployer feeExempt entfernen
```

### LP Pairing (Uniswap V2)

```bash
npx hardhat run scripts/create-lp.js --network sepolia
```

### Post-Deploy Checklist

| # | Schritt | Status |
|---|---------|--------|
| 1 | Contracts deployen | **Erledigt** (9/9) |
| 2 | Etherscan verifizieren | **Erledigt** (9/9) |
| 3 | LP erstellen | **Erledigt** (`0x2252e8bBDE0E50CD372748aC233A99C08627d9c7`) |
| 4 | Ownership transferieren | **Erledigt** |
| 5 | Governance Proposal #0 ausfuehren | **Erledigt** (setFeeExempt via 48h Timelock) |

---

## Offene Punkte

| # | Aufgabe | Prioritaet | Status |
|---|---------|------------|--------|
| 1 | Testnet Deploy (Sepolia) | Naechster Schritt | **Erledigt** (9 Contracts live + LP Pair) |
| 2 | Etherscan Verifikation | Nach Deploy | **Erledigt** (9/9 verified) |
| 3 | Security Audit (Slither) | Empfohlen | **Erledigt** (v0.11.5, 0 High/Critical) |
| 4 | Uniswap LP Pairing | Vor Launch | **Erledigt** (`0x2252e8bB...`) |
| 5 | Router/Adressen setzen | Vor Launch | **Erledigt** (Uniswap V2 Router02) |
| 6 | Ownership → Governance | Vor Launch | **Erledigt** |
| 7 | Dashboard Phase 2 (Governance UI) | Nach Deploy | **Erledigt** |
| 8 | Live Fee Verification (Sepolia) | Nach Deploy | **Erledigt** (ALL CHECKS PASSED) |
| 9 | Sepolia Smoke Test (Full Protocol) | Nach Deploy | **Erledigt** (11/11 PASS) |
| 10 | Governance Lifecycle (Proposal #0) | Nach Deploy | **Erledigt** (setFeeExempt via Timelock) |
| 11 | Governance Proposal #1 (IFRLock feeExempt) | Nach Deploy | **Erledigt** (8/8 Lock/Unlock Tests) |
| 12 | Gas-Optimierung | Optional | Offen |
| 13 | Doku-Inkonsistenzen (6 Tickets) | Hoch | **Erledigt** (PartnerVault, Creator Rewards, Bootstrap Pricing) |
