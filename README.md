<p align="center">
  <img src="docs/assets/ifr_logo.png" alt="Inferno $IFR" width="200" />
</p>

# Inferno ($IFR)

**The Deflationary Utility Token**

[Website](https://neabouli.github.io/inferno/) · [Documentation](https://neabouli.github.io/inferno/wiki/) · [X / Twitter](https://x.com/IFRtoken) · [Etherscan (Sepolia)](https://sepolia.etherscan.io/address/0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4#code)

---

## What is Inferno?

Inferno (IFR) is a deflationary ERC-20 utility token on Ethereum. Every transfer burns 2.5% permanently, reducing total supply over time. Users lock IFR tokens on-chain to unlock lifetime premium access to partner products — no subscriptions, no recurring payments.

**Community Fair Launch Model** — No presale, no VC, no insider allocations.

## Key Features

- **Deflationary**: 2.5% burned per transfer (2% sender + 0.5% recipient). 1% pool fee. Hard cap: 5% max.
- **Utility Lock**: Lock IFR → lifetime premium access across partner products → unlock anytime.
- **Timelock Governance**: 48-hour delay on all changes. Guardian cancel. No instant admin access.
- **No Mint Function**: Supply can only decrease, never increase.
- **Fair Launch**: No presale, no VC. Transparent allocation from day one.

## Token Allocation

| Allocation | Share | Amount |
|-----------|-------|--------|
| DEX Liquidity | 40% | 400M IFR |
| Liquidity Reserve | 20% | 200M IFR |
| Team (Vested) | 15% | 150M IFR |
| Treasury | 15% | 150M IFR |
| Community & Grants | 6% | 60M IFR |
| Partner Ecosystem | 4% | 40M IFR |

Team tokens: 48-month vesting, 12-month cliff. Liquidity reserve: 6-month lock.

## Fair Launch

No presale, no VC, no IDO. Direct Uniswap V2 listing.
Team allocation (15%) is locked in a vesting contract for 4 years
with a 1-year cliff. See [Fair Launch Statement](docs/FAIR_LAUNCH.md).

## Smart Contracts (10)

| Contract | Sepolia Address |
|----------|----------------|
| InfernoToken | `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` |
| LiquidityReserve | `0xF7E90D0d17f8232365186AA085D26eaEfAf011aF` |
| Vesting | `0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B` |
| BuybackVault | `0xC8ABb9039BEd24f4dBf5Cff09699877D81f0D63C` |
| BurnReserve | `0x6D4582FCac792FD3880e252fC0a585A0c1823e80` |
| Governance | `0x6050b22E4EAF3f414d1155fBaF30B868E0107017` |
| IFRLock | `0x0Cab0A9440643128540222acC6eF5028736675d3` |
| PartnerVault | `0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39` |
| FeeRouterV1 | `0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4` |
| LP Pair (IFR/WETH) | `0x2252e8bBDE0E50CD372748aC233A99C08627d9c7` |

## Partner Ecosystem

Lock-triggered Creator Rewards: when users lock IFR for a partner's product, the partner earns a percentage from the 40M Partner Ecosystem Pool.
- Hard bounds (contract): 5-25%
- Policy target: 10-20%
- Annual emission: default 4M IFR (bounds: 1-10M IFR)
- Vesting: 6-12 months
- Authorized caller whitelist for automated reward recording
- Anti-double-count: each wallet can only be rewarded once per partner
- Algorithmic emission throttle: reward rate scales down as more IFR is locked (1% → 50% lock ratio)

Token holdings grant future DAO voting rights.

**Launch Partner:** [SecureCall](https://neabouli.github.io/stealth/) — Privacy-first communication platform.

[Integration Guide →](https://neabouli.github.io/inferno/wiki/integration.html)

## Testing & Security

- 276 unit tests (contracts) + 26 unit tests (Creator Gateway) — all passing
- GitHub Actions CI: Creator Gateway, Points Backend, AI Copilot
- Slither security audit: 0 high/critical findings
- Full Sepolia testnet deployment with verified contracts
- Governance lifecycle tested: propose → 48h wait → execute

## Applications

| App | Path | Port | Stack |
|-----|------|------|-------|
| Token Dashboard | `apps/dashboard/` | 5173 | React 18 + Vite + ethers v5 |
| Governance Dashboard | `apps/governance-dashboard/` | 5174 | React 18 + Vite + TypeScript + Tailwind + ethers v5 |
| AI Copilot | `apps/ai-copilot/` | 5175 | React 18 + Vite + TypeScript + Tailwind + Express |
| Points Backend | `apps/points-backend/` | 3004 | Express + Prisma + SQLite + ethers v5 + siwe + jose |
| Creator Gateway | `apps/creator-gateway/` | 3005 | Express + ethers v5 + googleapis + JWT |
| Benefits Network Backend | `apps/benefits-network/backend/` | 3001 | Express + Prisma + SQLite + ethers v5 |
| Benefits Network Frontend | `apps/benefits-network/frontend/` | 3000 | Next.js 14 + Tailwind + wagmi v2 (PWA) |

### Token Dashboard

Read-only token dashboard for monitoring balances, transfers, and contract status.

**Start:** `cd apps/dashboard && npm install && npm run dev` → http://localhost:5173

### Benefits Network

The IFR Benefits Network lets any business verify on-chain IFR lock status to grant discounts and premium access. QR-based flow — no accounts, no subscriptions.

**Routes:** `/b/:businessId` (merchant console) · `/r/:sessionId` (customer verification)

### Governance Dashboard

Read-only governance dashboard for monitoring PartnerVault, proposals, and generating calldata.

**Tabs:** Overview · Partners · Timelock Queue · Calldata Generator

**Start:** `cd apps/governance-dashboard && npm run dev` → http://localhost:5174

### AI Copilot

Embedded chat widget with RAG knowledge base — helps users, partners, and developers understand IFR.

**Modes:** Customer · Partner · Developer

**Safety:** Automatic seed phrase / private key detection, instant warnings, source citation tags.

**Start:** `cd apps/ai-copilot && npm install && cp .env.example .env && npm run dev` → http://localhost:5175

### Points Backend

SIWE authentication, points tracking, and EIP-712 signed voucher issuance for protocol fee discounts.

**IFR Points are not a token** — no transfer value, no monetary promise. Points only reduce the protocol fee on a single swap (via EIP-712 discount voucher).

**Endpoints:** `/auth/siwe/*` (SIWE auth) · `/points/*` (events + balance) · `/voucher/issue` (EIP-712 voucher)

**Anti-Sybil:** Rate limiting per IP + per wallet + global daily caps.

**Start:** `cd apps/points-backend && npm install && npx prisma migrate dev --name init && npm run dev` → http://localhost:3004

## Documentation

- [Landing Page](https://neabouli.github.io/inferno/)
- [Technical Wiki](https://neabouli.github.io/inferno/wiki/)
- [Contracts Reference](https://neabouli.github.io/inferno/wiki/contracts.html)
- [Integration Guide](https://neabouli.github.io/inferno/wiki/integration.html)
- [Security Audit](https://neabouli.github.io/inferno/wiki/security.html)
- [Governance Constitution](docs/GOVERNANCE_CONSTITUTION.md) — Hard bounds, Rollen, Upgrade-Pfad
- [Business Onboarding](docs/BUSINESS_ONBOARDING.md) — Benefits Network Setup & Go-Live Checkliste
- [Partner Integration Spec](docs/PARTNER_INTEGRATION_SPEC.md) — Technische Spec: IFRLock + PartnerVault ABI, Rewards, Algo Throttle
- [Mainnet Checklist](docs/MAINNET_CHECKLIST.md) — Deployment-Reihenfolge, Verification, Post-Deploy
- [Security Audit Brief](docs/AUDIT_BRIEF.md) — Scope, Pruefbereiche, Auditor-Empfehlungen
- [Multisig Setup Guide](docs/MULTISIG_SETUP.md) — Gnosis Safe, Signer-Struktur, Ownership Transfer
- [Whitepaper / One-Pager](docs/WHITEPAPER.md) — Projekt-Uebersicht fuer Partner & Investoren
- [Creator Gateway Spec](docs/CREATOR_GATEWAY.md) — YouTube Hybrid Model, Docker Quickstart, Entitlement Engine
- [SDK / Developer Quickstart](docs/SDK_QUICKSTART.md) — ethers.js, wagmi, Python, Tier System, Wallet Verification
- [Testnet E2E Guide](docs/TESTNET_GUIDE.md) — Full Lock/Benefit/Governance/FeeRouter Flow auf Sepolia
- [Changelog](docs/CHANGELOG.md) — Alle Aenderungen chronologisch
- [ChatGPT Audit Prompt V3](docs/CHATGPT_AUDIT_PROMPT_V3.md) — Independent Audit Checklist (8 Pruefbereiche)
- [Investor One-Pager](docs/ONE-PAGER.md) — Key Numbers, Produkte, Technologie, Vor-Mainnet Checklist
- [E2E Flow: Points → Voucher → FeeRouter](docs/E2E_FLOW.md) — Vollstaendiger End-to-End Flow
- [YouTube Integration Guide](docs/YOUTUBE_INTEGRATION.md) — Hybrid Model B, Creator Gateway, Entitlement Config
- [Security Policy](docs/SECURITY_POLICY.md) — Responsible Disclosure, Bug Bounty, Scope
- [Tokenomics Model](docs/TOKENOMICS_MODEL.md) — Deflationskurve, Emission Model, Lock Economics
- [Partner Rewards Spec](docs/PARTNER_REWARDS_SPEC.md) — Reward-Formel, Vesting, Anti-Gaming, Partner-Typen
- [Benefits Network Test Guide](docs/BENEFITS_NETWORK_TEST.md) — E2E Test, API Endpoints, Lock Tiers
- [Coverage Report](docs/COVERAGE_REPORT.md) — Solidity Coverage (99% Stmts, 85% Branch)
- [Patch Guidelines](docs/PATCH-GUIDELINES.md) — Patch-Prozess, Severity, Versionierung
- [Contributing Guide](docs/CONTRIBUTING.md) — Bug Reports, Code Standards, Git Konventionen
- [Transparency Report](docs/TRANSPARENCY.md) — On-Chain Audit (8 Checks), Supply-Verteilung, Vesting, LP Status
- [Fair Launch Statement](docs/FAIR_LAUNCH.md) — No Presale, No VC, Team Allocation Vergleich, On-Chain Beweise
- [Fee Design](docs/FEE_DESIGN.md) — Warum 3.5%, Fee-Exempt Adressen, CEX-Strategie, MEV/Slippage
- [Off-Chain Security](docs/OFFCHAIN_SECURITY.md) — VoucherSigner Key Management, JWT, SIWE, Rate Limiting
- [Audit Submission](docs/AUDIT_SUBMISSION.md) — Code4rena/Sherlock Prep (9 Contracts, 1520 SLOC, Scope, Known Issues)
- [ChatGPT Audit V3 Results](docs/CHATGPT_AUDIT_V3_RESULTS.md) — Audit V3 Ergebnisse (8/8 Self-Check PASS)
- [Railway Env Guide](docs/RAILWAY_ENV.md) — Points Backend Railway Deploy (Env Vars, CLI Setup)
- [Vercel Env Guide](docs/VERCEL_ENV.md) — AI Copilot Vercel + Railway Deploy (Two-App, Proxy Config)
- [Page Update Checklist](docs/PAGE_UPDATE_CHECKLIST.md) — Welche Dateien bei welchem Event aktualisiert werden muessen
- [Project Summary](docs/PROJECT-SUMMARY.md) — Komplett-Uebersicht (10 Contracts, 330 Tests, 7 Apps)

## Development

### Hardhat Admin Tasks

```bash
npx hardhat lock-check --wallet 0x... --network sepolia
npx hardhat vault-status --network sepolia
npx hardhat feerouter-status --network sepolia
npx hardhat token-stats --network sepolia
npx hardhat gov-queue --network sepolia
```

### Mainnet Preparation Scripts

```bash
# On-chain audit (8 checks)
npx hardhat run scripts/onchain-audit.js --network sepolia

# Propose ownership transfer (dry run)
npx hardhat run scripts/propose-ownership-transfer.js --network sepolia

# Execute ownership transfer (after 48h timelock)
PROP_RESERVE=4 PROP_BUYBACK=5 PROP_BURN=6 npx hardhat run scripts/execute-ownership-transfer.js --network sepolia

# Burn LP tokens (dry run)
npx hardhat run scripts/burn-lp-tokens.js --network sepolia
```

## License

© 2026 Inferno Protocol. All rights reserved.
