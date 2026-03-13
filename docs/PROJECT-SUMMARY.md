# Inferno ($IFR) — Project Summary

Last updated: March 2026

## Project Status: MAINNET DEPLOYED

All 14 on-chain components deployed, verified, and operational on Ethereum Mainnet (2026-03-05). BootstrapVault deployed on Sepolia. Landing page, wiki (16 pages), dashboard, and 7 apps live.

## On-Chain Contracts (10)

### Mainnet (9)

| # | Contract | Address | Status |
|---|----------|---------|--------|
| 1 | InfernoToken | [`0x77e99917Eca8539c62F509ED1193ac36580A6e7B`](https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#code) | Verified |
| 2 | Governance | [`0xc43d48E7FDA576C5022d0670B652A622E8caD041`](https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041#code) | Verified |
| 3 | IFRLock | [`0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb`](https://etherscan.io/address/0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb#code) | Verified |
| 4 | BurnReserve | [`0xaA1496133B6c274190A2113410B501C5802b6fCF`](https://etherscan.io/address/0xaA1496133B6c274190A2113410B501C5802b6fCF#code) | Verified |
| 5 | BuybackVault | [`0x670D293e3D65f96171c10DdC8d88B96b0570F812`](https://etherscan.io/address/0x670D293e3D65f96171c10DdC8d88B96b0570F812#code) | Verified |
| 6 | PartnerVault | [`0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D`](https://etherscan.io/address/0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D#code) | Verified |
| 7 | FeeRouterV1 | [`0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a`](https://etherscan.io/address/0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a#code) | Verified |
| 8 | Vesting | [`0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271`](https://etherscan.io/address/0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271#code) | Verified |
| 9 | LiquidityReserve | [`0xdc0309804803b3A105154f6073061E3185018f64`](https://etherscan.io/address/0xdc0309804803b3A105154f6073061E3185018f64#code) | Verified |

### Sepolia (Testnet)

| # | Contract | Address | Status |
|---|----------|---------|--------|
| 10 | BootstrapVaultV3 | [`0x16086d4f7F191047d8A4fFf2090126E12e865A7E`](https://sepolia.etherscan.io/address/0x16086d4f7F191047d8A4fFf2090126E12e865A7E#code) | Verified |

### Gnosis Safe (Mainnet)

| Role | Address |
|------|---------|
| Treasury Multisig | [`0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`](https://app.safe.global/home?safe=eth:0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b) |

Threshold: 1-of-2 (Deployer + Signer2). Expanding to 2-of-4.

## Test Coverage

| Area | Tests | Framework |
|------|-------|-----------|
| Smart Contracts | 367 | Hardhat + Chai + Waffle |
| Creator Gateway | 41 | Jest + ts-jest + supertest |
| Points Backend | 20 | tsx runner |
| Benefits Network | 16 | Jest |
| **Total** | **444** | |

### Solidity Coverage (solidity-coverage)

| Metric | Value |
|--------|-------|
| Statements | 99.45% |
| Branches | 91% |
| Functions | 98.26% |
| Lines | 99% |

### Contract Test Breakdown

| Contract | Tests |
|----------|-------|
| InfernoToken | 22 |
| LiquidityReserve | 42 |
| Vesting | 27 |
| BuybackVault | 26 |
| BurnReserve | 27 |
| Governance | 36 |
| IFRLock | 37 |
| PartnerVault | 95 |
| FeeRouterV1 | 33 |
| BootstrapVault | 22 |
| **Total** | **367** |

## Applications (7)

| # | App | Port | Stack | Status |
|---|-----|------|-------|--------|
| 1 | Token Dashboard | 5173 | React 18 + Vite + ethers v5 | Live |
| 2 | Governance Dashboard | 5174 | React 18 + Vite + TS + Tailwind | Live |
| 3 | AI Copilot | 5175 | React 18 + Vite + TS + Express | Live |
| 4 | Points Backend | 3004 | Express + Prisma + SQLite + SIWE | Live |
| 5 | Creator Gateway | 3005 | Express + ethers v5 + googleapis | Live |
| 6 | Benefits Network Backend | 3001 | Express + Prisma + SQLite | Live |
| 7 | Benefits Network Frontend | 3000 | Next.js 14 + Tailwind + wagmi v2 | Live |

## CI/CD

| Workflow | Trigger | Steps |
|----------|---------|-------|
| Creator Gateway CI | Push/PR to `apps/creator-gateway/` | tsc + jest |
| Points Backend CI | Push/PR to `apps/points-backend/` | prisma generate + tsc + jest |
| AI Copilot CI | Push/PR to `apps/ai-copilot/` | tsc + build |

## Documentation

- **16 wiki pages** (HTML, `docs/wiki/`)
- **40+ technical docs** (Markdown, `docs/*.md`)
- Landing page (GitHub Pages): `docs/index.html`
- Domain: [ifrunit.tech](https://ifrunit.tech)

## Token Metrics (Mainnet)

| Metric | Value |
|--------|-------|
| Total Supply | ~998,000,000 IFR (from 1,000,000,000) |
| Burned | ~2,000,000 IFR (~0.2%) |
| Sender Burn Fee | 2.0% (200 bps) |
| Recipient Burn Fee | 0.5% (50 bps) |
| Pool Fee | 1.0% (100 bps) |
| Total Fee | 3.5% (350 bps) |
| Protocol Fee (FeeRouter) | 0.05% (5 bps) |
| PartnerVault Reward Rate | 15% (1500 bps) |
| PartnerVault Annual Cap | 4,000,000 IFR |

## Remaining Steps

1. **LP Pairing** — Create Uniswap V2 LP (400M IFR + ETH)
2. **LP Token Lock/Burn** — Lock via Unicrypt or burn to 0xdead
3. **Ownership Transfer** — InfernoToken → Governance → Multisig
4. **Multisig Expansion** — 1-of-2 → 2-of-4
5. **Third-party Security Audit** — Code4rena, Sherlock, or Cyfrin
6. **FeeRouter Setup** — Deploy swap adapter, set voucher signer

---
*Inferno Protocol | March 2026*
