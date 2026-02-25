# Changelog

All notable changes to the Inferno ($IFR) project.

---

## [Unreleased] — 2026-02-26

### Added
- FeeRouterV1 Tests: 13 → 33 (isVoucherValid 6 branches, setVoucherSigner, setFeeCollector, receive(), access control, signer rotation)
- Creator Gateway: youtube-checker.test.ts (6 YouTube mock tests) + access.test.ts (6 Access-Route Tests) — 26 Tests gesamt
- Wiki security.html: solidity-coverage Tabelle (pro Contract), FeeRouterV1 Zeile in Test-Suite-Tabelle
- MAINNET_CHECKLIST.md v1.1: FeeRouter Deploy-Schritt, Sepolia Status Summary, korrekte Test-Zahlen
- Benefits Network CI: `.github/workflows/benefits-network.yml` (test-backend + test-frontend)
- COVERAGE_REPORT.md: vollstaendig neu mit aktuellen Coverage-Werten

### Changed
- Coverage aktualisiert: 95%/81% → 99%/85% (ueber 5 Dateien)
- Test-Counts synchronisiert: 276 Contract Tests, 330 Gesamt (ueber 10 Dateien)
- WHITEPAPER.md, AUDIT_BRIEF.md: 243 → 276 Tests
- CHATGPT_AUDIT_PROMPT_V2.md: alte Referenzen aktualisiert

### Fixed
- gov-queue Task: queryFilter → getProposal() Loop (Alchemy-kompatibel, zeigt Status)

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
