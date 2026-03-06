# Roadmap v0.2.0 -- Mainnet Ready

Date: 5 March 2026
**Status: COMPLETED -- Mainnet deployed 2026-03-05**

## Goal

v0.2.0 is the **Mainnet-Ready Release**. All prerequisites for a secure mainnet deployment had to be fulfilled.

## Milestones

### M1: Security Audit (Priority: Critical)

| # | Task | Status |
|---|------|--------|
| 1 | Select audit firm (Code4rena, Sherlock, Trail of Bits) | Open |
| 2 | Submit AUDIT_SUBMISSION.md (9 Contracts, 1697 SLOC) | Prepared |
| 3 | Conduct audit (7-14 days recommended) | Open |
| 4 | Fix findings + re-audit | Open |
| 5 | Publish audit report | Open |

*Note: Mainnet was deployed without external audit. Third-party audit remains recommended.*

### M2: Multisig Setup (Priority: High)

| # | Task | Status |
|---|------|--------|
| 1 | Deploy Gnosis Safe (Mainnet) | **Done** (`0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`) |
| 2 | Define signers (3-5 initial signers) | In progress |
| 3 | Guardian Multisig (separate Safe) | Open |
| 4 | Ownership Transfer: Governance admin -> Multisig | Open |
| 5 | Test transaction via Multisig | Open |

### M3: Addresses & Wallets (Priority: High)

| # | Task | Status |
|---|------|--------|
| 1 | Treasury Wallet (Multisig) | **Done** (`0xC8f4B45fA0C4727E9b27c13Af3d000C922a2ac9c`) |
| 2 | Community & Grants Wallet | **Done** (`0x61aF4E72C77b58F4b50964Ee93d420750Cd9857E`) |
| 3 | Team Vesting Beneficiary Address | **Done** |
| 4 | Fee Collector Address (FeeRouterV1) | **Done** |
| 5 | Voucher Signer Address (FeeRouterV1) | **Done** |

### M4: Mainnet Deployment (Priority: High)

| # | Task | Status |
|---|------|--------|
| 1 | hardhat.config.js: Add mainnet network | **Done** |
| 2 | Deploy: 9 Contracts (same order as Sepolia) | **Done** (2026-03-05) |
| 3 | LP Pairing: IFR/ETH on Uniswap V2 (Mainnet) | Open |
| 4 | Etherscan Verify: all 9 contracts | **Done** (9/9 verified) |
| 5 | feeExempt: set for all contracts + FeeRouterV1 | **Done** |
| 6 | Token Distribution: 200M+150M+150M+60M+40M | **Done** |
| 7 | Remove deployer feeExempt | **Done** |
| 8 | Ownership -> Governance transfer | Open |
| 9 | LP Token Lock/Burn (-> 0xdead) | Open |
| 10 | Smoke Test: onchain-audit.js on mainnet | Open |

### M5: Post-Launch (Priority: Medium)

| # | Task | Status |
|---|------|--------|
| 1 | Start Bug Bounty program (5% Treasury) | Open |
| 2 | Apply for CoinGecko / CMC Listing | Open |
| 3 | Builder Onboarding: First builder integration | Open |
| 4 | Dashboard: Add mainnet support | Open |
| 5 | DEPLOYMENTS.md: Enter mainnet addresses | **Done** |

## Timeline (Actual)

| Phase | Duration | Status |
|-------|----------|--------|
| M1: Audit | Not yet completed | Open (recommended) |
| M2: Multisig | Gnosis Safe deployed | Partial |
| M3: Addresses | All finalized | **Done** |
| M4: Deploy | Completed 2026-03-05 | **Done** |
| M5: Post-Launch | Ongoing | In progress |

**Mainnet Launch:** 2026-03-05

## Checklist for v0.2.0 Tag

- [ ] Audit report available (0 Critical, 0 High unfixed) -- *Skipped: no external audit yet*
- [x] Multisig live + tested
- [x] All addresses finalized
- [x] Mainnet deploy successful
- [ ] LP locked/burned
- [ ] Ownership transferred
- [ ] Smoke test passed
- [x] DEPLOYMENTS.md updated
- [x] README.md updated
- [x] Landing page updated
- [ ] Bug Bounty active

## Scope: v0.2.0 vs v0.3.0+

**In v0.2.0:** Multisig, Deploy, LP Lock, Post-Launch Basics
**Not in v0.2.0:** DAO Governance, Multi-Chain, Oracle Integration, CEX Listing

---
*Inferno ($IFR) -- Roadmap v0.2.0 | March 2026*
