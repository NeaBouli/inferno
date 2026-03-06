# IFR Project Status Report

**Date:** 5 March 2026
**Branch:** `main`
**Model:** Community Fair Launch (CFLM) -- no presale
**Ticker:** $IFR
**Status:** 10 On-Chain Components deployed + verified on Ethereum Mainnet | 444 Tests | 7 Apps

---

## On-Chain (Ethereum Mainnet)

10 on-chain components (9 repo contracts + 1 Uniswap V2 LP Pair). All verified on Etherscan. Ownership transferred to Governance (48h Timelock).

| # | Contract | Address | Status |
|---|----------|---------|--------|
| 1 | InfernoToken | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` | Verified |
| 2 | LiquidityReserve | `0xdc0309804803b3A105154f6073061E3185018f64` | Verified |
| 3 | Vesting | `0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271` | Verified |
| 4 | BuybackVault | `0x670D293e3D65f96171c10DdC8d88B96b0570F812` | Verified |
| 5 | BurnReserve | `0xaA1496133B6c274190A2113410B501C5802b6fCF` | Verified |
| 6 | Governance | `0xc43d48E7FDA576C5022d0670B652A622E8caD041` | Verified |
| 7 | IFRLock | `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` | Verified |
| 8 | PartnerVault | `0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D` | Verified |
| 9 | FeeRouterV1 | `0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a` | Verified |
| 10 | BootstrapVault | Deployed | Verified |

**Deployer:** `0x6b36687b0cd4386fb14cf565B67D7862110Fed67`
**Treasury:** `0xC8f4B45fA0C4727E9b27c13Af3d000C922a2ac9c`
**Community:** `0x61aF4E72C77b58F4b50964Ee93d420750Cd9857E`
**Gnosis Safe:** `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`
**Ownership:** Transferred to Governance (Timelock, 48h delay)

---

## Sepolia Testnet (Historical)

Sepolia deployment served as the full testnet validation phase. All contracts were deployed and verified on Sepolia before mainnet launch. See `docs/DEPLOYMENTS.md` for full Sepolia address list.

---

## Tests

| Area | Tests | Framework |
|------|-------|-----------|
| **Smart Contracts** | **367** | Hardhat + Chai + Waffle |
| Creator Gateway | 41 | Jest + ts-jest + supertest |
| Points Backend | 20 | tsx runner |
| Benefits Network | 16 | Jest |
| **Total** | **444** | |

### Contract Tests (367 -- 10 Suites)

| Suite | Tests | Description |
|-------|-------|-------------|
| InfernoToken | 22 | Deployment, fee math, exemptions, owner functions, edge cases |
| LiquidityReserve | 42 | Lock period, staged withdrawal, pause, period limits, transferOwnership, edge cases |
| Vesting | 27 | Cliff, linear release, access control, pause, constructor, edge cases |
| BuybackVault | 26 | Deposit, buyback split, cooldown, slippage, activation delay, transferOwnership, edge cases |
| BurnReserve | 27 | Deposit, burn, burnAll, tracking, guardian auth, transferOwnership |
| Governance | 36 | Propose, execute, cancel, self-governance, integration |
| IFRLock | 37 | Lock, unlock, re-lock, isLocked, lockType, fee-exempt, pause, edge cases |
| PartnerVault | 89 | Builders, milestones, rewards, vesting, claims, authorizedCaller, anti-double-count, algo throttle, integration |
| FeeRouterV1 | 33 | Fee charging, voucher discount, isVoucherValid (6 branches), replay protection, signer rotation, access control |
| BootstrapVault | 22 | Contribution limits, finalize, claim, LP lock, anti-whale, window expiry |

### Solidity Coverage (solidity-coverage)

| Metric | Value |
|--------|-------|
| Statements | 99.45% |
| Branches | 91% |
| Functions | 98.26% |
| Lines | 99% |

---

## Apps (7)

| # | App | Port | Stack |
|---|-----|------|-------|
| 1 | Token Dashboard | 5173 | React 18 + Vite + ethers v5 |
| 2 | Governance Dashboard | 5174 | React 18 + Vite + TypeScript + Tailwind + ethers v5 |
| 3 | AI Copilot | 5175 + 3003 | React 18 + Vite + TS + Tailwind + Express |
| 4 | Points Backend | 3004 | Express + Prisma + SQLite + SIWE + jose |
| 5 | Creator Gateway | 3005 | Express + ethers v5 + googleapis + JWT |
| 6 | Benefits Network Backend | 3001 | Express + Prisma + SQLite + ethers v5 |
| 7 | Benefits Network Frontend | 3000 | Next.js 14 + Tailwind + wagmi v2 (PWA) |

---

## Token Economics

| Parameter | Value |
|-----------|-------|
| Name / Symbol | Inferno / IFR |
| Decimals | 9 |
| Total Supply | 1,000,000,000 IFR |
| Sender Burn | 2.0% (200 bps) |
| Recipient Burn | 0.5% (50 bps) |
| Pool Fee | 1.0% (100 bps) |
| Total Fee | 3.5% (350 bps) |
| Max Fee Cap | 5.0% (500 bps) |
| Protocol Fee (FeeRouter) | 0.05% (5 bps) |

### Token Distribution (CFLM)

| Allocation | Amount | Share |
|-----------|--------|-------|
| DEX Liquidity | 400M IFR | 40% |
| Liquidity Reserve | 200M IFR | 20% |
| Team (Vested) | 150M IFR | 15% |
| Treasury | 150M IFR | 15% |
| Community & Grants | 60M IFR | 6% |
| Builder Ecosystem | 40M IFR | 4% |

---

## Governance (Mainnet)

| # | Action | Status |
|---|--------|--------|
| 0 | setFeeExempt (first proposal) | **Pending** (ETA 2026-03-07 20:12 CET) |

### Governance (Sepolia -- Historical)

| # | Action | Status |
|---|--------|--------|
| 0 | setFeeExempt(DEX Router) | **Executed** (2026-02-20) |
| 1 | setFeeExempt(IFRLock) | **Executed** (2026-02-22) |
| 2 | setFeeExempt(PartnerVault v1) | **Cancelled** (v1 deprecated) |
| 3 | setFeeExempt(PartnerVault v2) | **Executed** (2026-02-26) |
| 4 | transferOwnership(LiquidityReserve) | **Cancelled** (immutable owner) |
| 5 | transferOwnership(BuybackVault) | **Cancelled** (immutable owner) |
| 6 | transferOwnership(BurnReserve) | **Cancelled** (immutable owner) |
| 7 | setFeeExempt(LiquidityReserve v2) | **Executed** (2026-03-02) |
| 8 | setFeeExempt(BuybackVault v2) | **Executed** (2026-03-02) |
| 9 | setFeeExempt(BurnReserve v2) | **Executed** (2026-03-02) |

---

## Security

| Check | Status |
|-------|--------|
| Slither v0.11.5 | **PASS** -- 0 High/Critical, 15 fixes, 36 accepted |
| solidity-coverage | **99% Stmts, 91% Branch** |
| 367 Contract Tests | **PASS** -- 0 Failures |
| Governance Lifecycle | **PASS** -- Proposal #0 + #1 executed via 48h Timelock (Sepolia) |
| Third-party Audit | **Recommended** -- not yet conducted |

---

## CI/CD

| Workflow | Trigger | Steps |
|----------|---------|-------|
| Creator Gateway CI | Push/PR to `apps/creator-gateway/` | tsc + jest (41 tests) |
| Points Backend CI | Push/PR to `apps/points-backend/` | prisma generate + tsc + jest (20 tests) |
| AI Copilot CI | Push/PR to `apps/ai-copilot/` | tsc + build |
| Benefits Network CI | Push/PR to `apps/benefits-network/` | test-backend + test-frontend |

---

## Documentation

- **30+ Markdown files** in `docs/`
- **18 HTML pages** in `docs/wiki/`
- **Landing Page** (GitHub Pages): `docs/index.html`
- **Changelog:** `docs/CHANGELOG.md`

---

## Next Steps (Prioritized)

| # | Task | Status |
|---|------|--------|
| 1 | Mainnet Deployment (9 contracts + verify) | **Done** (2026-03-05) |
| 2 | Governance Proposal #0 (Mainnet) | **Pending** (ETA 2026-03-07 20:12 CET) |
| 3 | Create Uniswap V2 LP (400M IFR + ETH) | Open |
| 4 | Lock LP Tokens (min 12 months via Unicrypt) | Open |
| 5 | Transfer InfernoToken Ownership -> Governance | Open |
| 6 | Transfer Governance Owner -> Multisig | Open |
| 7 | Expand Gnosis Safe to 2-of-3 signers | Open |
| 8 | Professional Security Audit | Open |

---

## Tech Stack

| Component | Version |
|-----------|---------|
| Solidity | 0.8.20 |
| Hardhat | v2 |
| ethers.js | v5 |
| OpenZeppelin | v5 |
| Chai + Waffle | v4 |
| solidity-coverage | latest |
| Slither | v0.11.5 |
| React | 18 |
| Vite | latest |
| Next.js | 14 |
| Prisma | latest |

---
*Generated: 5 March 2026 | Inferno Protocol*
