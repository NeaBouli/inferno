# Inferno ($IFR) — Mainnet Deployment Checklist

> **Status:** Mainnet Deployed (2026-03-05) | **Mainnet:** 9 Contracts deployed + verified | **Tests:** 367 Contract + 41 Creator Gateway + 20 Points + 16 Benefits = 444 Total | **Coverage:** 99% Stmts, 91% Branch

## CRITICAL — Before Any Public Launch

These items MUST be completed before public launch:

### LP Token Lock (HIGHEST PRIORITY)
- [ ] Lock LP Tokens via Unicrypt (https://app.unicrypt.network)
  - Minimum lock duration: 12 months
  - Or: Permanently burn LP tokens (0x000...dEaD)
- [ ] Verify LP lock transaction on Etherscan
- [ ] Record LP lock proof in TRANSPARENCY.md
- [ ] Add LP lock link to landing page + wiki

### Ownership Transfer → Governance (Done 2026-03-05)
- [x] InfernoToken.transferOwnership(Governance) — [TX](https://etherscan.io/tx/0x...)
- [x] LiquidityReserve.transferOwnership(Governance)
- [x] BuybackVault.transferOwnership(Governance)
- [x] BurnReserve.transferOwnership(Governance)

### Deployer Wallet
- [ ] Transfer deployer wallet treasury share to Governance Treasury
- [ ] Transfer community share to Community Multisig
- [ ] Reduce deployer wallet to minimum (gas only)

### Current Status (2026-03-05)
- Mainnet Deploy: 9/9 contracts deployed + verified
- Token Distribution: 1B IFR correctly distributed (CFLM)
- Fee Exemptions: 8 addresses set, deployer removed
- Ownership Transfer: Done (2026-03-05, 4 contracts → Governance)
- ~~BootstrapVault V1~~: Deployed + verified (`0xA820540936d18e1377C39dd9445E5b36F3F1261a`) — **DEPRECATED**, use V3: `0x16086d4f7F191047d8A4fFf2090126E12e865A7E`
- Governance Proposal #0: feeExempt(BootstrapVault V1), ETA 07.03.2026 — **cancelled, V1 deprecated**
- OPEN: LP Pairing, LP Lock, Multisig expansion

---

## Sepolia Testnet — Completed

| Milestone | Status |
|-----------|--------|
| 14 Contracts deployed + verified | Done |
| Uniswap V2 LP Pair live | Done |
| Ownership transferred to Governance | Done |
| Governance Proposals #0, #1 executed | Done |
| Governance Proposal #2 cancelled (v1 deprecated) | Done |
| Governance Proposal #3 executed (PartnerVault v2 feeExempt) + 1.4M Top-up | Done |
| Full Lock/Unlock cycle verified (8/8) | Done |
| Slither Audit: 0 high/critical | Done |
| solidity-coverage: 99% Stmts, 91% Branch | Done |
| LiquidityReserve/BuybackVault/BurnReserve v2 redeployed (transferOwnership) | Done |
| Ownership v2 → Governance (direct transfer) | Done |
| feeExempt Proposals #7-9 executed (2026-03-02) | Done |

---

## Phase 0: Pre-Deployment (Preparation)

### Security
- [x] Slither Audit completed (0 high/critical, 15 fixes applied)
- [x] solidity-coverage report generated (99% Stmts, 91% Branch)
- [ ] Third-party security audit completed (recommended: Code4rena, Sherlock, or Cyfrin)
- [ ] All audit findings resolved and re-verified
- [ ] Slither re-run on final code
- [ ] npx hardhat test — all tests passing
- [ ] Code freeze: no commit after audit completion without re-audit

### Multisig Setup (MUST be done before deployment)
- [x] Gnosis Safe created: https://safe.global
- [ ] Recommended: 2-of-4 signers (currently 1-of-2)
- [ ] All signers have hardware wallets (Ledger/Trezor)
- [x] Multisig address recorded: `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`
- [ ] Guardian multisig created (separate Safe, 2-of-4 recommended)
- [ ] Guardian address recorded: [GUARDIAN_ADDRESS]
- [ ] Test transaction on Sepolia with multisig successful

### Wallets & Keys
- [ ] Deployer wallet with sufficient ETH for gas (min. 0.5 ETH recommended)
- [ ] All private keys on hardware wallets, not on computer
- [ ] Backup phrases securely stored (offline, multiple copies)
- [ ] Team beneficiary address for vesting confirmed
- [ ] Treasury address confirmed

### Contract Parameters Finalized
- [ ] rewardBps = 1500 (15%)
- [ ] annualEmissionCap = 4,000,000 IFR
- [ ] Timelock delay = 172800 (48h)
- [ ] Team Vesting: 150M IFR, 48 months, 12-month cliff
- [ ] Liquidity Reserve: 200M IFR, 6-month lock
- [ ] FeeRouterV1: protocolFeeBps = 5, FEE_CAP_BPS = 25

---

## Phase 1: Deployment (Follow order!)

### Step 1 — Deploy Core Contracts
- [x] InfernoToken.sol deployed
  - Address: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
  - Etherscan verified
- [x] Governance (Timelock) deployed
  - admin = Deployer (temporary, will become Multisig)
  - delay = 172800 (48h)
  - Address: `0xc43d48E7FDA576C5022d0670B652A622E8caD041`
  - Etherscan verified

### Step 2 — Deploy Utility Contracts
- [x] IFRLock.sol deployed
  - Address: `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb`
  - Etherscan verified
- [x] BurnReserve.sol deployed
  - Address: `0xaA1496133B6c274190A2113410B501C5802b6fCF`
  - Etherscan verified
- [x] BuybackVault.sol deployed
  - Address: `0x670D293e3D65f96171c10DdC8d88B96b0570F812`
  - Etherscan verified
- [x] PartnerVault.sol deployed
  - admin = Governance
  - rewardBps = 1500
  - annualEmissionCap = 4_000_000 * 10**9
  - Address: `0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D`
  - Etherscan verified
- [x] FeeRouterV1.sol deployed
  - governance = Governance
  - feeCollector = Treasury
  - voucherSigner = `0x17F8DD6dECCb3ff5d95691982B85A87d7d9872d4`
  - Address: `0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a`
  - Etherscan verified

### Step 3 — Vesting & Reserve
- [x] Vesting.sol deployed (beneficiary = `0x04FABC52c51d1F8ced6974E7C25a34249b1E6239`)
  - Address: `0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271`
  - Etherscan verified
- [x] LiquidityReserve.sol deployed
  - Address: `0xdc0309804803b3A105154f6073061E3185018f64`
  - Etherscan verified

### Step 4 — Set Fee Exemptions (BEFORE token distribution!)
- [x] setFeeExempt(Vesting, true)
- [x] setFeeExempt(LiquidityReserve, true)
- [x] setFeeExempt(BuybackVault, true)
- [x] setFeeExempt(BurnReserve, true)
- [x] setFeeExempt(IFRLock, true)
- [x] setFeeExempt(PartnerVault, true)
- [x] setFeeExempt(Treasury, true)
- [x] CRITICAL: All exemptions set BEFORE token transfers (Sepolia lesson applied)

### Step 5 — Token Distribution (CRITICAL)
- [x] 400M IFR → Deployer (for LP pairing)
- [x] 200M IFR → LiquidityReserve contract
- [x] 150M IFR → Vesting contract
- [x] 150M IFR → Treasury (`0xC8f4B45fA0C4727E9b27c13Af3d000C922a2ac9c`)
- [x] 60M IFR → Community & Grants (`0x61aF4E72C77b58F4b50964Ee93d420750Cd9857E`)
- [x] 40M IFR → PartnerVault contract
- [x] Total check: 400+200+150+150+60+40 = 1,000,000,000
- [x] Deployer feeExempt removed

### Step 6 — Uniswap V2 LP
- [ ] DEX Liquidity wallet approves Router for 400M IFR
- [ ] LP created: IFR/ETH pair
- [ ] LP tokens locked (liquidity lock service, min. 6 months)
- [ ] LP Pair address recorded: [LP_PAIR_ADDRESS]

### Step 7 — FeeRouter Setup
- [ ] Deploy swap adapter and whitelist (setAdapter)
- [ ] Set voucher signer address (Points Backend key)
- [ ] Verify test swap with voucher discount

### Step 8 — Ownership Transfer to Multisig
- [x] InfernoToken Ownership → Governance (Done 2026-03-05)
- [x] LiquidityReserve Ownership → Governance (Done 2026-03-05)
- [x] BuybackVault Ownership → Governance (Done 2026-03-05)
- [x] BurnReserve Ownership → Governance (Done 2026-03-05)
- [ ] Governance Owner → MULTISIG_ADDRESS
- [ ] Guardian → GUARDIAN_ADDRESS
- [x] Remove deployer feeExempt (Done 2026-03-05)
- [ ] Deployer has no more admin rights (pending Governance owner → Multisig)
- [ ] Test proposal with multisig successful

---

## Phase 2: Post-Deployment Verification

- [ ] All 10 contract addresses updated in docs/wiki/deployment.html
- [ ] Landing page Etherscan links updated
- [ ] README contract addresses updated
- [ ] docs/DEPLOYMENTS.md mainnet section added
- [ ] End-to-end smoke test:
  - [ ] Transfer: Fees correctly deducted
  - [ ] Lock: IFR locking works
  - [ ] isLocked: returns true
  - [ ] Unlock: IFR unlocking works
  - [ ] Governance: Proposal → 48h → Execute
  - [ ] PartnerVault: claim() works
  - [ ] FeeRouter: swapWithFee with/without voucher works
- [ ] Benefits Network Backend: IFRLOCK_ADDRESS set to mainnet
- [ ] Governance Dashboard: all addresses set to mainnet
- [ ] Points Backend: voucherSigner + FeeRouter address set to mainnet

---
*Last updated: March 2026 | v1.2 — Mainnet Deployed*
