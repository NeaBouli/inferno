<p align="center">
  <img src="https://raw.githubusercontent.com/NeaBouli/inferno/main/docs/assets/ifr_icon_256.png" alt="Inferno $IFR" width="200" />
</p>

# Inferno ($IFR)

**The Deflationary Utility Token — Deployed on Ethereum Mainnet**

[Website](https://ifrunit.tech/) · [Documentation](https://ifrunit.tech/wiki/) · [X / Twitter](https://x.com/IFRtoken) · [Etherscan](https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#code)

<!-- TODO: IFR_UPDATE — TEST_COUNT + CONTRACT_COUNT — update on each sprint -->
**14 on-chain components** | **578 tests** | **91% branch coverage** | **9 verified contracts + BootstrapVaultV3 + LP Pair + 3 upgrade deploys**

---

## What is Inferno?

Inferno (IFR) is a deflationary ERC-20 utility token on Ethereum. Every transfer burns 2.5% permanently, reducing total supply over time. Users lock IFR tokens on-chain to unlock lifetime premium access to builder products — no subscriptions, no recurring payments.

**Community Fair Launch Model** — No presale, no VC, no insider allocations.

> Inferno Protocol is fully open source and community-owned. No single entity controls the protocol. All contracts are verified on Ethereum Mainnet, governed by a 48-hour timelock, and protected by Gnosis Safe multisig. The protocol lives on-chain — permanently.

## Key Features

- **Deflationary**: 2.5% burned per transfer (2% sender + 0.5% recipient). 1% pool fee. Hard cap: 5% max.
- **Utility Lock**: Lock IFR → lifetime premium access across builder products → unlock anytime.
- **Timelock Governance**: 48-hour delay on all changes. Guardian cancel. No instant admin access.
- **No Mint Function**: Supply can only decrease, never increase.
- **Fair Launch**: No presale, no VC. Transparent allocation from day one.

## Token Allocation

| Allocation | Share | Amount | Note |
|-----------|-------|--------|------|
| DEX Liquidity | 40% | 400M IFR | Held by deployer. Paired on Uniswap V2 via BootstrapVaultV3.finalise() after Bootstrap completion. |
| Liquidity Reserve | 20% | 200M IFR | Smart-contract-locked until 01.09.2026. Phase 2 LP expansion. NOT used for Bootstrap. |
| Team Vesting | 15% | 150M IFR | 12-month cliff, 36-month linear vesting. 0 tokens available before March 2027. |
| Treasury | 15% | 150M IFR | Gnosis Safe multisig (0x5ad6193...). 150M committed to Bootstrap. Refills via protocol fees (Phase 3). |
| Community & Grants | 6% | 60M IFR | Community Safe (57.9M received after burn). 50M → Bootstrap. ~7.9M operational reserve. |
| Builder Ecosystem | 4% | 40M IFR | PartnerVault contract. Lock-triggered Creator Rewards, milestone vesting. |

BuybackVault and BurnReserve accumulate from the 1% protocol pool fee — not pre-funded genesis allocations.
Team tokens: 48-month vesting, 12-month cliff. Liquidity reserve: locked until 01.09.2026.

## Fair Launch

No presale, no VC, no IDO. Direct Uniswap V2 listing.
Team allocation (15%) is locked in a vesting contract for 4 years
with a 1-year cliff. See [Fair Launch Statement](docs/FAIR_LAUNCH.md).

## Smart Contracts (Ethereum Mainnet)

| Contract | Mainnet Address |
|----------|----------------|
| InfernoToken | [`0x77e99917Eca8539c62F509ED1193ac36580A6e7B`](https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#code) |
| Governance | [`0xc43d48E7FDA576C5022d0670B652A622E8caD041`](https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041#code) |
| IFRLock | [`0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb`](https://etherscan.io/address/0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb#code) |
| BurnReserve | [`0xaA1496133B6c274190A2113410B501C5802b6fCF`](https://etherscan.io/address/0xaA1496133B6c274190A2113410B501C5802b6fCF#code) |
| BuybackVault | [`0x670D293e3D65f96171c10DdC8d88B96b0570F812`](https://etherscan.io/address/0x670D293e3D65f96171c10DdC8d88B96b0570F812#code) |
| PartnerVault | [`0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D`](https://etherscan.io/address/0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D#code) |
| FeeRouterV1 | [`0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a`](https://etherscan.io/address/0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a#code) |
| Vesting | [`0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271`](https://etherscan.io/address/0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271#code) |
| LiquidityReserve | [`0xdc0309804803b3A105154f6073061E3185018f64`](https://etherscan.io/address/0xdc0309804803b3A105154f6073061E3185018f64#code) |
| BootstrapVaultV3 | [`0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141`](https://etherscan.io/address/0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141#code) **[ACTIVE]** |
| BootstrapVault V1 | [`0xA820540936d18e1377C39dd9445E5b36F3F1261a`](https://etherscan.io/address/0xA820540936d18e1377C39dd9445E5b36F3F1261a#code) **[DEPRECATED]** |

### Gnosis Safe (Mainnet)

| Role | Address |
|------|---------|
| Treasury Multisig | [`0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`](https://app.safe.global/home?safe=eth:0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b) |

Threshold: 3-of-5 (5 active signers: A.K., M.G., A.M., Y.K., A.P.).

## Builder Ecosystem

Lock-triggered Creator Rewards: when users lock IFR for a builder's product, the builder earns a percentage from the 40M Builder Ecosystem Pool.
- Hard bounds (contract): 5-25%
- Policy target: 10-20%
- Annual emission: default 4M IFR (bounds: 1-10M IFR)
- Vesting: 6-12 months
- Authorized caller whitelist for automated reward recording
- Anti-double-count: each wallet can only be rewarded once per builder
- Algorithmic emission throttle: reward rate scales down as more IFR is locked (1% → 50% lock ratio)

Token holdings grant future DAO voting rights.

The ecosystem is open and permissionless. Any product can integrate IFR Lock.

[Integration Guide →](https://ifrunit.tech/wiki/integration.html)

## Testing & Security

**578 tests** — all passing

### Protocol Tests — 521
| Suite | Count | Framework |
|---|---|---|
| Smart Contracts | 367 | Hardhat/Mocha |
| BuilderRegistry | 27 | Hardhat |
| App Backend | 77 | Mocha |
| Bootstrap Suite | 50 | Hardhat |

### Ecosystem Tests — 57
| Suite | Count | Framework |
|---|---|---|
| Wallet Verification + OnChain | 23 | Mocha |
| Vote Announcements | 12 | Mocha |
| Bot Announcements | 10 | Mocha |
| Browser / WalletConnect | 12 | Playwright |

- Branch coverage: 91% (99% statements)
- GitHub Actions CI: Creator Gateway, Points Backend, AI Copilot
- Slither security audit: 0 high/critical findings
- Internal security audit: 0 FAIL, 20 WARN (1 fixed), 81 PASS ([full report](docs/SECURITY_AUDIT_SKYWALKER.md))
- App security review: 12 findings (2 CRITICAL, 5 HIGH — all fixed) ([full report](docs/APP_SECURITY_REVIEW.md))
- **Bootstrap security review (13.03.2026):** BootstrapVaultV3 + InfernoToken + FeeRouterV1 + Governance — 11/14 secure, 3/14 low risk, 0 critical ([full report](audit/BOOTSTRAP_SECURITY_REVIEW_13032026.md))
- Full Sepolia testnet deployment with verified contracts
- Governance lifecycle tested: propose → 48h wait → execute

## Community Audit

All smart contracts are open source and community review is explicitly encouraged.

- **Internal Audit:** [docs/SECURITY_AUDIT_SKYWALKER.md](docs/SECURITY_AUDIT_SKYWALKER.md) — 0 FAIL, 20 WARN (1 fixed), 81 PASS
- **Submit a Finding:** [GitHub Issues → Security Audit Template](https://github.com/NeaBouli/inferno/issues/new?template=security-audit.md)
- **Security Policy:** [SECURITY.md](SECURITY.md)

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
| Telegram Bot | `apps/telegram/telegram-bot/` | — | Telegraf + Railway (16 commands, moderation, governance notifier) |

### Token Dashboard

Token dashboard for monitoring balances, transfers, lock management, and contract status.

**Start:** `cd apps/dashboard && npm install && npm run dev` → http://localhost:5173

### Benefits Network

The IFR Benefits Network lets any business verify on-chain IFR lock status to grant discounts and premium access. QR-based flow — no accounts, no subscriptions.

**Routes:** `/b/:businessId` (merchant console) · `/r/:sessionId` (customer verification)

### Governance Dashboard

Read-only governance dashboard for monitoring PartnerVault, proposals, and generating calldata.

**Tabs:** Overview · Builders · Timelock Queue · Calldata Generator

**Start:** `cd apps/governance-dashboard && npm run dev` → http://localhost:5174

### AI Copilot

Embedded chat widget with RAG knowledge base — helps users, builders, and developers understand IFR.

**Modes:** Customer · Builder · Developer

**Safety:** Automatic seed phrase / private key detection, instant warnings, source citation tags.

**Start:** `cd apps/ai-copilot && npm install && cp .env.example .env && npm run dev` → http://localhost:5175

### Points Backend

SIWE authentication, points tracking, and EIP-712 signed voucher issuance for protocol fee discounts.

**IFR Points are not a token** — no transfer value, no monetary promise. Points only reduce the protocol fee on a single swap (via EIP-712 discount voucher).

**Endpoints:** `/auth/siwe/*` (SIWE auth) · `/points/*` (events + balance) · `/voucher/issue` (EIP-712 voucher)

**Anti-Sybil:** Rate limiting per IP + per wallet + global daily caps.

**Start:** `cd apps/points-backend && npm install && npx prisma migrate dev --name init && npm run dev` → http://localhost:3004

## Documentation

- [Landing Page](https://ifrunit.tech/)
- [Technical Wiki](https://ifrunit.tech/wiki/)
- [Contracts Reference](https://ifrunit.tech/wiki/contracts.html)
- [Integration Guide](https://ifrunit.tech/wiki/integration.html)
- [Security Audit](https://ifrunit.tech/wiki/security.html)
- [Governance Constitution](docs/GOVERNANCE_CONSTITUTION.md) — Hard bounds, roles, upgrade path
- [Business Onboarding](docs/BUSINESS_ONBOARDING.md) — Benefits Network setup & go-live checklist
- [Builder Integration Spec](docs/PARTNER_INTEGRATION_SPEC.md) — Technical spec: IFRLock + PartnerVault ABI, Rewards, Algo Throttle
- [Mainnet Checklist](docs/MAINNET_CHECKLIST.md) — Deployment order, verification, post-deploy
- [Security Audit Brief](docs/AUDIT_BRIEF.md) — Scope, audit areas, auditor recommendations
- [Multisig Setup Guide](docs/MULTISIG_SETUP.md) — Gnosis Safe, signer structure, ownership transfer
- [Whitepaper / One-Pager](docs/WHITEPAPER.md) — Project overview for builders & investors
- [Creator Gateway Spec](docs/CREATOR_GATEWAY.md) — YouTube Hybrid Model, Docker Quickstart, Entitlement Engine
- [SDK / Developer Quickstart](docs/SDK_QUICKSTART.md) — ethers.js, wagmi, Python, Tier System, Wallet Verification
- [Testnet E2E Guide](docs/TESTNET_GUIDE.md) — Full Lock/Benefit/Governance/FeeRouter flow on Sepolia
- [Changelog](docs/CHANGELOG.md) — All changes chronologically
- [ChatGPT Audit Prompt V3](docs/CHATGPT_AUDIT_PROMPT_V3.md) — Independent audit checklist (12 audit areas)
- [ChatGPT Audit Prompt V4](docs/CHATGPT_AUDIT_PROMPT_V4.md) — Anti-Sybil, SIWE, Integration, number consistency (8 self-checks)
- [Investor One-Pager](docs/ONE-PAGER.md) — Key numbers, products, technology, pre-mainnet checklist
- [E2E Flow: Points → Voucher → FeeRouter](docs/E2E_FLOW.md) — Complete end-to-end flow
- [YouTube Integration Guide](docs/YOUTUBE_INTEGRATION.md) — Hybrid Model B, Creator Gateway, Entitlement Config
- [Security Policy](docs/SECURITY_POLICY.md) — Responsible Disclosure, Bug Bounty, Scope
- [Tokenomics Model](docs/TOKENOMICS_MODEL.md) — Deflation curve, emission model, lock economics
- [Builder Rewards Spec](docs/PARTNER_REWARDS_SPEC.md) — Reward formula, vesting, anti-gaming, builder types
- [Benefits Network Test Guide](docs/BENEFITS_NETWORK_TEST.md) — E2E test, API endpoints, lock tiers
- [Coverage Report](docs/COVERAGE_REPORT.md) — Solidity coverage (99% Stmts, 91% Branch)
- [Patch Guidelines](docs/PATCH-GUIDELINES.md) — Patch process, severity, versioning
- [Contributing Guide](docs/CONTRIBUTING.md) — Bug reports, code standards, git conventions
- [Transparency Report](docs/TRANSPARENCY.md) — On-chain audit (8 checks), supply distribution, vesting, LP status
- [Fair Launch Statement](docs/FAIR_LAUNCH.md) — No presale, no VC, team allocation comparison, on-chain evidence
- [Fee Design](docs/FEE_DESIGN.md) — Why 3.5%, fee-exempt addresses, CEX strategy, MEV/slippage
- [Off-Chain Security](docs/OFFCHAIN_SECURITY.md) — VoucherSigner key management, JWT, SIWE, rate limiting
- [Audit Submission](docs/AUDIT_SUBMISSION.md) — Code4rena/Sherlock prep (9 contracts, 1697 SLOC, scope, known issues)
- [Press Kit](docs/PRESS_KIT.md) — Key facts, token allocation, roadmap, links
- [GitHub Secrets Guide](docs/GITHUB_SECRETS.md) — Required secrets for GitHub Actions CI/CD
- [ChatGPT Audit V3 Results](docs/CHATGPT_AUDIT_V3_RESULTS.md) — Audit V3 results (12/12 self-check PASS)
- [Railway Env Guide](docs/RAILWAY_ENV.md) — Points Backend Railway deploy (env vars, CLI setup)
- [Vercel Env Guide](docs/VERCEL_ENV.md) — AI Copilot Vercel + Railway deploy (two-app, proxy config)
- [Roadmap](docs/ROADMAP.md) — 6-phase roadmap (Foundation → Governance → Ecosystem → Mainnet → Growth → DAO)
- [Page Update Checklist](docs/PAGE_UPDATE_CHECKLIST.md) — Which files to update for each event
- [Deployment Stats](docs/stats.json) — Auto-generated on-chain stats (via update-stats.js)
- [Project Summary](docs/PROJECT-SUMMARY.md) — Complete overview (9 mainnet contracts, 578 tests, 7 apps)
- [Release Notes v0.1.0](docs/RELEASE_NOTES_v0.1.0.md) — First tagged release (Sepolia testnet)
- [Lighthouse Report](docs/LIGHTHOUSE_REPORT.md) — SEO optimizations (OG, Twitter Card, meta tags, sitemap, robots.txt)
- [AI Copilot Test Results](docs/COPILOT_TEST_RESULTS.md) — RAG system test (6 questions, 3 modes, safety guards)
- [Roadmap v0.2.0](docs/ROADMAP_v0.2.0.md) — Mainnet-ready milestones (audit, multisig, deploy, post-launch)
- [ChatGPT Audit V4 Results](docs/CHATGPT_AUDIT_V4_RESULTS.md) — Audit V4 self-check (8/8 PASS)
- [ChatGPT Audit V5 Results](docs/CHATGPT_AUDIT_V5_RESULTS.md) — Cross-audit: W15-W21 (7 new findings, W16 fixed)
- [GitHub Setup](docs/GITHUB_SETUP.md) — Repository settings (Discussions, Topics, Pages)
- [App Security Review](docs/APP_SECURITY_REVIEW.md) — Full app review (12 findings, 7 fixed: CORS, JWT, ABI, wallet validation)

## Development

### Hardhat Admin Tasks

```bash
# Sepolia (historical/testing) — use --network mainnet for production
npx hardhat lock-check --wallet 0x... --network sepolia
npx hardhat vault-status --network sepolia
npx hardhat feerouter-status --network sepolia
npx hardhat token-stats --network sepolia
npx hardhat gov-queue --network sepolia
```

### Mainnet Preparation Scripts

```bash
# Mainnet deploy — DRY RUN (all 9 contracts, 12 steps)
npx hardhat run scripts/deploy-mainnet.js --network hardhat

# Mainnet deploy — LIVE (requires env vars: TREASURY_ADDRESS, COMMUNITY_ADDRESS, TEAM_BENEFICIARY, VOUCHER_SIGNER_ADDRESS)
npx hardhat run scripts/deploy-mainnet.js --network mainnet

# On-chain audit (8 checks) — use --network mainnet for production
npx hardhat run scripts/onchain-audit.js --network sepolia

# Propose ownership transfer (historical/testing)
npx hardhat run scripts/propose-ownership-transfer.js --network sepolia

# Execute ownership transfer (after 48h timelock, historical/testing)
PROP_RESERVE=4 PROP_BUYBACK=5 PROP_BURN=6 npx hardhat run scripts/execute-ownership-transfer.js --network sepolia

# Burn LP tokens (historical/testing)
npx hardhat run scripts/burn-lp-tokens.js --network sepolia

# Governance: set poolFeeReceiver to FeeRouterV1 (Proposal #6)
npx hardhat run scripts/propose-set-pool-fee-receiver.js --network mainnet
```

## License

© 2026 Inferno Protocol. All rights reserved.
