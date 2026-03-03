# Inferno ($IFR) — Roadmap

## Phase 1: Foundation & Testnet (Q4 2025 - Q1 2026) — DONE

### Smart Contracts
- [x] InfernoToken (ERC-20, 9 decimals, fee-on-transfer, 2.5% burn + 1% pool)
- [x] LiquidityReserve (6-month lock, 50M/quarter staged release)
- [x] Vesting (12-month cliff, 36-month linear)
- [x] BuybackVault (50/50 split, 60-day activation)
- [x] BurnReserve (permanent burn + totalBurned tracking)
- [x] Governance (48h timelock, propose/execute/cancel, guardian)
- [x] IFRLock (lock/unlock, isLocked(), multi-app lockType)
- [x] PartnerVault (549 LOC, 95 tests, milestone unlocking + creator rewards)
- [x] FeeRouterV1 (EIP-712 vouchers, protocol fee routing)
- [x] v2 upgrades: LiquidityReserve, BuybackVault, BurnReserve (transferOwnership)
- [x] 13 on-chain components deployed on Sepolia (9 repo + 3 v2 + LP Pair)

### Testing & Security
- [x] 339 contract tests, 414 total (+ 32 Creator Gateway + 35 Points + 8 Benefits)
- [x] 91% branch coverage, 99% statement coverage
- [x] Slither static analysis: 0 high/critical findings
- [x] Claude Security Audit: 0 FAIL, 12 WARN, 78 PASS
- [x] Community Audit open via GitHub Issues

### Governance (Sepolia)
- [x] 10 Governance Proposals (#0-#9): 7 executed, 3 cancelled
- [x] Ownership of all contracts transferred to Governance
- [x] feeExempt set for IFRLock, PartnerVault, LR v2, BV v2, BR v2

### Applications
- [x] Token Dashboard (React 18 + Vite, lock/unlock UI)
- [x] Governance Dashboard (React 18 + TS + Tailwind, calldata generator)
- [x] AI Copilot (Claude-powered, 3 modes, safety guards)
- [x] Points Backend (SIWE auth, EIP-712 voucher issuance)
- [x] Creator Gateway (YouTube x IFR Lock Bridge)
- [x] Benefits Network (QR-based lock verification, Next.js PWA)

### Documentation & Release
- [x] 14 wiki pages (GitHub Pages)
- [x] Landing page with tokenomics, FAQ, roadmap
- [x] 30+ doc files (specs, guides, checklists)
- [x] v0.1.0 tagged release
- [x] GitHub Discussions, Topics, Issue Templates
- [x] SECURITY.md + Community Audit policy

---

## Phase 2: Mainnet Launch (Q2 2026) — NEXT

### Must Have
- [ ] LP Token lock/burn (Unicrypt, 12 months minimum)
- [ ] Gnosis Safe Multisig (2-of-3 initial signers)
- [ ] Governance owner → Multisig
- [ ] Community wallet + team beneficiary addresses finalized
- [ ] Professional security audit (Code4rena / Sherlock)
- [ ] Mainnet deploy (all 13 contracts)
- [ ] Mainnet Uniswap V2 LP pairing (IFR/WETH)
- [ ] Etherscan verification (mainnet)
- [ ] Mainnet ownership transfer to Governance
- [ ] Mainnet feeExempt configuration

### Should Have
- [ ] Apps deployed (Railway / Vercel)
- [ ] Dashboard + Governance Dashboard switched to mainnet
- [ ] First real partner integration live
- [ ] Community announcement (X/Twitter, Discord)
- [ ] CoinGecko / CoinMarketCap listing application

---

## Phase 3: Growth (Q2-Q3 2026)

- [ ] Partner Ecosystem expansion (Tier 1-3 onboarding open)
- [ ] Creator Gateway live (YouTube monetization bridge)
- [ ] Benefits Network live (merchant onboarding)
- [ ] Guarded buyback automation (BuybackVault activation after 60 days)
- [ ] Developer SDK + documentation (ethers.js, wagmi, Python)
- [ ] Bug bounty program (Immunefi)
- [ ] FeeRouter adapter ecosystem (DEX aggregators)
- [ ] Mobile-optimized dashboard

---

## Phase 4: Decentralization (Q3 2026 - Q1 2027)

- [ ] Multisig upgrade (2-of-3 → 3-of-5 → 4-of-7)
- [ ] Guardian multisig (2-of-3, cancel-only)
- [ ] DAO governance framework (token-weighted voting)
- [ ] Community proposals enabled
- [ ] Partner token voting rights
- [ ] Protocol revenue sharing model
- [ ] Full DAO transition: Admin → Multisig → DAO

---

## Phase 5: Scale (Q2 2027+)

- [ ] Advanced lock types (tiered, time-based, NFT-gated)
- [ ] Partner self-service portal
- [ ] Cross-protocol integrations
- [ ] Advanced analytics dashboard
- [ ] Community grants program
- [ ] CEX integration support (fee-exempt listings)
- [ ] Ecosystem fund

---

## Current Focus

**Phase 2 preparation** — LP token lock, multisig setup, professional audit, mainnet deployment.
See [Mainnet Checklist](MAINNET_CHECKLIST.md) for detailed steps.

---
*Last updated: 03 March 2026*
