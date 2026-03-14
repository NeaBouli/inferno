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
- [x] 14 on-chain components deployed on Sepolia (9 repo + 3 v2 + LP Pair + BootstrapVault)

### Testing & Security
- [x] 578 total tests (521 protocol + 57 ecosystem)
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

## Phase 2: Mainnet Launch (Q1 2026) — IN PROGRESS

### Must Have
- [x] Gnosis Safe Multisig deployed (1-of-2) — `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`
- [x] Mainnet deploy (9 contracts, all verified on Etherscan)
- [x] Token distribution complete (1B IFR, CFLM)
- [x] Mainnet feeExempt configuration (8 addresses set, deployer removed)
- [x] Etherscan verification (mainnet, all 9 contracts)
- [x] Ownership transfer to Governance (InfernoToken, LiquidityReserve, BuybackVault, BurnReserve)
- [x] ~~BootstrapVault V1~~ deployed + verified (`0xA820540936d18e1377C39dd9445E5b36F3F1261a`) — **DEPRECATED**, use V3: `0x16086d4f7F191047d8A4fFf2090126E12e865A7E`
- [x] Governance Proposal #0 submitted (feeExempt BootstrapVault, ETA 07.03.2026)
- [ ] Mainnet Uniswap V2 LP pairing (IFR/WETH)
- [ ] LP Token lock/burn (Unicrypt, 12 months minimum)
- [ ] Governance owner → Multisig (expand 1-of-2 → 2-of-4)
- [ ] Community wallet + team beneficiary addresses finalized

### Should Have
- [ ] Apps deployed (Railway / Vercel)
- [ ] Dashboard + Governance Dashboard switched to mainnet
- [ ] First real builder integration live
- [ ] Community announcement (X/Twitter, Discord)
- [ ] CoinGecko / CoinMarketCap listing application

---

## Phase 3: Growth (Q2-Q3 2026)

- [ ] Builder Ecosystem expansion (permissionless integration)
- [ ] Creator Gateway live (YouTube monetization bridge)
- [ ] Benefits Network live (merchant onboarding)
- [ ] Guarded buyback automation (BuybackVault activation after 60 days)
- [ ] Developer SDK + documentation (ethers.js, wagmi, Python)
- [ ] Bug bounty program (Immunefi)
- [ ] FeeRouter adapter ecosystem (DEX aggregators)
- [ ] Mobile-optimized dashboard

---

## Phase 4: Decentralization (Q3 2026 - Q1 2027)

- [ ] Multisig upgrade (2-of-4 → 3-of-5 → 4-of-7)
- [ ] Guardian multisig (2-of-4, cancel-only)
- [ ] DAO governance framework (token-weighted voting)
- [ ] Community proposals enabled
- [ ] Builder token voting rights
- [ ] Protocol revenue sharing model
- [ ] Full DAO transition: Admin → Multisig → DAO

---

## Phase 5: Scale (Q2 2027+)

- [ ] Advanced lock types (tiered, time-based, NFT-gated)
- [ ] Builder self-service portal
- [ ] Cross-protocol integrations
- [ ] Advanced analytics dashboard
- [ ] Community grants program
- [ ] CEX integration support (fee-exempt listings)
- [ ] Ecosystem fund

---

## Current Focus

**Phase 2 completion** — mainnet contracts deployed, verified, and ownership transferred to Governance (March 2026). Next: LP pairing, LP lock, Governance owner → Multisig.
See [Mainnet Checklist](MAINNET_CHECKLIST.md) for detailed progress.

---
*Last updated: 05 March 2026*
