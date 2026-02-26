# Changelog

All notable changes to the Inferno ($IFR) project.

---

## [Unreleased] — 2026-02-26

### Added
- docs/TRANSPARENCY.md — vollstaendiger On-Chain Audit Report (8 Checks)
- docs/FAIR_LAUNCH.md — Fair Launch Statement mit Allocation-Vergleich
- docs/FEE_DESIGN.md — Fee-Mechanismus Erklaerung + CEX-Strategie
- docs/OFFCHAIN_SECURITY.md — Off-chain Security Hardening Guide
- docs/AUDIT_SUBMISSION.md — Code4rena/Sherlock Submission Prep (1520 SLOC)
- docs/ONE-PAGER.md — Investor One-Pager
- docs/CONTRIBUTING.md — Contribution Guide
- docs/SECURITY_POLICY.md — Responsible Disclosure + Bug Bounty
- docs/TOKENOMICS_MODEL.md — Deflationskurve + Emission Simulation
- docs/GOVERNANCE_CONSTITUTION.md — Governance Constitution v1.0
- docs/BUSINESS_ONBOARDING.md — Business Onboarding SOP
- docs/YOUTUBE_INTEGRATION.md — YouTube Hybrid Model B Guide
- docs/PARTNER_REWARDS_SPEC.md — Partner Rewards Specification
- docs/CHATGPT_AUDIT_PROMPT_V3.md — Audit V3 Prompt (8 Bereiche)
- docs/CHATGPT_AUDIT_V3_RESULTS.md — Audit V3 Ergebnisse (Platzhalter)
- docs/wiki/faq.html — FAQ Wiki (30 Q&A, 6 Sektionen)
- docs/wiki/transparency.html — On-Chain Transparency Wiki
- docs/wiki/fair-launch.html — Fair Launch Wiki
- docs/wiki/fee-design.html — Fee Design Wiki
- apps/creator-gateway/ — Creator Gateway App (OAuth + IFRLock Bridge)
- scripts/onchain-audit.js — On-Chain Audit Script (8 Checks)
- scripts/propose-ownership-transfer.js — Governance Proposal Script
- scripts/burn-lp-tokens.js — LP Token Burn Script (DRY RUN Schutz)
- scripts/topup-partnervault.js — PartnerVault Top-up Script
- .github/ISSUE_TEMPLATE/ — Bug Report, Feature Request, Security Templates
- .github/pull_request_template.md — PR Template
- .github/workflows/benefits-network.yml — Benefits Network CI
- FeeRouterV1 Tests: 13 → 33 (isVoucherValid 6 branches, setVoucherSigner, setFeeCollector, receive(), access control, signer rotation)
- Creator Gateway: youtube-checker.test.ts (6 YouTube mock tests) + access.test.ts (6 Access-Route Tests) — 26 Tests gesamt
- Wiki security.html: solidity-coverage Tabelle (pro Contract), FeeRouterV1 Zeile in Test-Suite-Tabelle
- MAINNET_CHECKLIST.md v1.1: FeeRouter Deploy-Schritt, Sepolia Status Summary, korrekte Test-Zahlen
- COVERAGE_REPORT.md: vollstaendig neu mit aktuellen Coverage-Werten
- Landing Page FAQ: 5 + 3 neue Eintraege (FeeRouter, Points, Creator Gateway, Security, Mainnet, Fee 3.5%, CEX, Fee-Exempt)

### Changed
- 256 → 276 Contract Tests (FeeRouterV1 Branch Coverage: 13 → 33 Tests)
- 298 → 330 Gesamt-Tests (Creator Gateway: 20 → 26 Tests)
- Coverage: 95%/81% → 99%/85% Statements/Branch
- Wiki: 9 → 13 Seiten (faq, transparency, fair-launch, fee-design)
- MAINNET_CHECKLIST.md: LP Lock + Ownership Transfer als KRITISCH
- README.md: Fair Launch Sektion, Apps Tabelle, alle neuen Docs
- FeeRouterV1.sol: NatSpec fuer alle public Functions
- InfernoToken.sol, IFRLock.sol, PartnerVault.sol, Vesting.sol, BuybackVault.sol, BurnReserve.sol, LiquidityReserve.sol: NatSpec ergaenzt
- WHITEPAPER.md, AUDIT_BRIEF.md: Test-Zahlen 243 → 276 aktualisiert
- CHATGPT_AUDIT_PROMPT_V2.md: alte Referenzen aktualisiert

### Fixed
- STATUS-REPORT.md: vollstaendig neu (125 → 330 Tests, 6 → 10 Contracts)
- WHITEPAPER.md: Test-Zahlen 276 → 330 aktualisiert
- contracts.html: "8th protocol component" → "10th on-chain component"
- deployment.html: FeeRouterV1 in Deployment-Tabelle ergaenzt
- gov-queue Task: queryFilter → getProposal() Loop (Alchemy-kompatibel, zeigt Status)

### Security
- OFFCHAIN_SECURITY.md: VoucherSigner Key Management dokumentiert
- .gitignore: erweitert (*.pem, *.key, .env*.local)
- Points Backend: Voucher Logging hinzugefuegt
- FeeRouterV1: NatSpec + isVoucherValid Branch Coverage verbessert

---

## [0.9.0] — 2026-02-24/25

### Added
- PartnerVault v2 deployed auf Sepolia (`0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39`)
  - authorizedCaller Modell (Whitelist fuer recordLockReward)
  - Anti-double-count Mapping (wallet → partnerId → bool)
  - Algorithmic Emission Throttle (lockRatio → emissionFactor)
- Governance Dashboard (`apps/governance-dashboard/`)
  - 4 Tabs: Overview, Partners, Timelock Queue, Calldata Generator
  - React 18 + Vite + TypeScript + Tailwind + ethers v5
  - FeeRouter Funktionen im Calldata Generator
- IFR AI Copilot (`apps/ai-copilot/`)
  - 3 Modi: Customer, Partner, Developer
  - RAG ueber IFR_KNOWLEDGE (Canon-Parameter)
  - Safety Guards: kein Seed Phrase, Source-Quoting
  - Eingebettet in Landing Page + 9 Wiki-Seiten
- Points Backend (`apps/points-backend/`)
  - SIWE Authentication (Sign-In with Ethereum)
  - 5 Event-Types mit Daily Limits
  - EIP-712 Voucher Issuance
  - Anti-Sybil: Rate Limiting, Daily Caps
  - 20 Tests passing
- FeeRouterV1 deployed auf Sepolia (`0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4`)
  - EIP-712 Voucher Verification
  - Protocol Fee (5 bps default, 25 bps hard cap)
  - Whitelisted Adapters
  - Replay Protection + Pause
  - 13 Tests passing
- Wiki: `agent.html` (AI Copilot, Punkte-System, Safety)
- Docs: WHITEPAPER.md, SDK_QUICKSTART.md, TESTNET_GUIDE.md
- Docs: CREATOR_GATEWAY.md, GOVERNANCE_CONSTITUTION.md
- Docs: BUSINESS_ONBOARDING.md, PARTNER_INTEGRATION_SPEC.md
- Docs: MAINNET_CHECKLIST.md, AUDIT_BRIEF.md, MULTISIG_SETUP.md

### Changed
- PartnerVault Adresse aktualisiert (v1 → v2)
- Docs: 243 → 256 Tests, 9 → 10 on-chain components
- Landing Page: 5 neue FAQ-Eintraege
- Landing Page: Tokenomics Donut Chart + Deflation Visualizer
- Audit-Wording praezisiert (Slither static analysis, nicht "audited")
- rewardBps deployment.html: 1000 → 1500 korrigiert

### Fixed
- Wiki Quick Stats: 221 → 243 → 256 Tests
- LP Pair Label: "8 repo contracts + 1 Uniswap V2 LP Pair"
- Alchemy Free Tier getLogs Fix (DEPLOY_BLOCK + graceful fallback)

### Security
- AuthorizedCaller Pattern in PartnerVault (kein public recordLockReward)
- FeeRouter: Replay Protection via usedNonces mapping
- FeeRouter: Pause-Mechanismus fuer Notfaelle
- Points Backend: Rate Limiting + Daily Issuance Cap
