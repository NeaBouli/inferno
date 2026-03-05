# Inferno ($IFR) — Deployments

## Sepolia Testnet (Historical)

**Datum:** 2026-02-16
**Deployer:** `0x5Ecc668eab04C5bee81b5c7242e1077c946dE406`
**Network:** Sepolia (Chain ID: 11155111)

### Contract Addresses

| # | Contract | Address | Verified |
|---|----------|---------|----------|
| 1 | **InfernoToken** | [`0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4`](https://sepolia.etherscan.io/address/0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4#code) | Verified |
| 2 | **LiquidityReserve** | [`0x344720eA0cd1654e2bDB41ecC1cCb11eD60f1957`](https://sepolia.etherscan.io/address/0x344720eA0cd1654e2bDB41ecC1cCb11eD60f1957#code) | Verified |
| 3 | **Vesting** | [`0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B`](https://sepolia.etherscan.io/address/0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B#code) | Verified |
| 4 | **BuybackVault** | [`0x2E61b720c220ce85dA24b05a476903Ec709Cb68c`](https://sepolia.etherscan.io/address/0x2E61b720c220ce85dA24b05a476903Ec709Cb68c#code) | Verified |
| 5 | **BurnReserve** | [`0xB9FbE5dB44EEce77A69C8F09e9E0eE2E4F745D75`](https://sepolia.etherscan.io/address/0xB9FbE5dB44EEce77A69C8F09e9E0eE2E4F745D75#code) | Verified |
| 6 | **Governance** | [`0x6050b22E4EAF3f414d1155fBaF30B868E0107017`](https://sepolia.etherscan.io/address/0x6050b22E4EAF3f414d1155fBaF30B868E0107017#code) | Verified |
| 7 | **IFRLock** | [`0x0Cab0A9440643128540222acC6eF5028736675d3`](https://sepolia.etherscan.io/address/0x0Cab0A9440643128540222acC6eF5028736675d3#code) | Verified |
| 8 | **PartnerVault** | [`0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39`](https://sepolia.etherscan.io/address/0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39#code) | Verified |
| 9 | **FeeRouterV1** | [`0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4`](https://sepolia.etherscan.io/address/0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4#code) | Verified |
| 10 | **BootstrapVault** | [`0xE0E8F76e4fb38B2e367Aee043a2C02b8D1c7c037`](https://sepolia.etherscan.io/address/0xE0E8F76e4fb38B2e367Aee043a2C02b8D1c7c037#code) | Verified |

### Constructor Arguments

| Contract | Arguments |
|----------|-----------|
| InfernoToken | `deployer` (poolFeeReceiver) |
| LiquidityReserve | `token, 15552000 (180d), 50000000000000000 (50M*1e9), 7776000 (90d), deployer (guardian)` |
| Vesting | `token, deployer (beneficiary), 31536000 (365d), 126144000 (4*365d), 150000000000000000 (150M*1e9), deployer (guardian)` |
| BurnReserve | `token, deployer (guardian)` |
| BuybackVault | `token, burnReserve, deployer (treasury), deployer (router), deployer (guardian), 5184000 (60d)` |
| Governance | `172800 (48h), deployer (guardian)` |
| IFRLock | `token, deployer (guardian)` |
| PartnerVault | `token, governance (admin), deployer (guardian), 1500 (rewardBps), 4000000000000000 (4M*1e9 annualCap)` |
| FeeRouterV1 | `governance, deployer (feeCollector), deployer (voucherSigner)` |
| BootstrapVault | `token, LiquidityReserve v2 (ifrSource), router, address(0) (TF locker disabled), 1772604468 (startTime), 7776000 (90d), 400000000000000000 (400M*1e9), 10000000000000000 (0.01 ETH), 2000000000000000000 (2 ETH), 31536000 (365d)` |

### Token Distribution

| Recipient | Amount | Address |
|-----------|--------|---------|
| DEX Liquidity | 400,000,000 IFR (40%) | LP Pair [`0x2252e8bBDE0E50CD372748aC233A99C08627d9c7`](https://sepolia.etherscan.io/address/0x2252e8bBDE0E50CD372748aC233A99C08627d9c7) |
| Liquidity Reserve | 200,000,000 IFR (20%) | `0x344720eA0cd1654e2bDB41ecC1cCb11eD60f1957` (v2) |
| Team Vesting | 150,000,000 IFR (15%) | `0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B` |
| Treasury | 150,000,000 IFR (15%) | Deployer (placeholder) |
| Community & Grants | 60,000,000 IFR (6%) | Deployer (placeholder) |
| Partner Ecosystem | 40,000,000 IFR (4%) | [`0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39`](https://sepolia.etherscan.io/address/0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39) (PartnerVault) |

### Configuration

| Setting | Value |
|---------|-------|
| FeeExempt | Vesting, LiquidityReserve, Treasury, BuybackVault, BurnReserve, IFRLock, PartnerVault |
| Deployer FeeExempt | Removed |
| LiquidityReserve Lock | 180 days |
| Vesting Cliff | 12 months |
| Vesting Duration | 48 months (12mo cliff + 36mo linear) |
| BuybackVault Activation | 60 days |
| Governance Delay | 48 hours |
| BuybackVault Router | [`0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008`](https://sepolia.etherscan.io/address/0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008) (Uniswap V2 Router02) |

### Uniswap V2 LP Pair

| Detail | Value |
|--------|-------|
| LP Pair | [`0x2252e8bBDE0E50CD372748aC233A99C08627d9c7`](https://sepolia.etherscan.io/address/0x2252e8bBDE0E50CD372748aC233A99C08627d9c7) |
| Router | [`0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008`](https://sepolia.etherscan.io/address/0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008) |
| Factory | `0x7E0987E5b3a30e3f2828572Bb659A548460a3003` |
| WETH | `0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9` |
| IFR in Pool | 400,000,000 IFR |
| ETH in Pool | 0.01 ETH |
| LP Tokens | 0.0632 |
| Initial Price | 1 ETH = 40,000,000,000 IFR |
| TX | `0xa664857d32598cf971c8ea69174615b6ed0444ebab770c3a6c928d3ac6139685` |

### Governance Proposals

| # | Action | Target | ETA | TX | Status |
|---|--------|--------|-----|-----|--------|
| 0 | `setFeeExempt(0xA4A1ea...6A36f90, true)` | InfernoToken | 2026-02-20 10:14 CET | [`0x13ff46d8...cbbe982d`](https://sepolia.etherscan.io/tx/0x13ff46d8a113f25b9ab0037ee06d6108c62d0f16e25d28799e4f45a8cbbe982d) | Executed |
| 1 | `setFeeExempt(IFRLock, true)` | InfernoToken | 2026-02-22 21:15 CET | [`0x211b7949...4253a909`](https://sepolia.etherscan.io/tx/0x211b794970abe147b3ab2f3c92bb79b3b3c5a72bc8be8cfb7e1d00fd4253a909) | Executed |
| 2 | `setFeeExempt(PartnerVault v1, true)` | InfernoToken | — | — | Cancelled (v1 deprecated) |
| 3 | `setFeeExempt(PartnerVault v2, true)` | InfernoToken | 2026-02-26 | [`0x3f28690a...57de6e8`](https://sepolia.etherscan.io/tx/0x3f28690a57de6e8) | Executed |
| 4 | `transferOwnership(Governance)` | LiquidityReserve | 2026-02-28 | — | Cancelled (contract upgraded, re-deploy needed) |
| 5 | `transferOwnership(Governance)` | BuybackVault | 2026-02-28 | — | Cancelled (contract upgraded, re-deploy needed) |
| 6 | `transferOwnership(Governance)` | BurnReserve | 2026-02-28 | — | Cancelled (contract upgraded, re-deploy needed) |
| 7 | `setFeeExempt(LiquidityReserve v2, true)` | InfernoToken | 2026-03-02 | [`0x7b54a775...37c8a25`](https://sepolia.etherscan.io/tx/0x7b54a77571fdcdd0961f100e45cc53621360cfacc80d8fdb8fe161e7937c8a25) | Executed |
| 8 | `setFeeExempt(BuybackVault v2, true)` | InfernoToken | 2026-03-02 | [`0xd43d40aa...7e686e`](https://sepolia.etherscan.io/tx/0xd43d40aa9dd88c3277c0272fc823fcc7445e2b7204d11e49f58c3bda997e686e) | Executed |
| 9 | `setFeeExempt(BurnReserve v2, true)` | InfernoToken | 2026-03-02 | [`0x9d51bf49...48bc18`](https://sepolia.etherscan.io/tx/0x9d51bf49d8727c46db0491cedcb60a98979d94f4699623798189454dfb48bc18) | Executed |

### Post-Deploy Status

| Step | Status |
|------|--------|
| Contract Deploy | Done |
| feeExempt Wiring | Done |
| Token Distribution | Done |
| Deployer Exemption Removed | Done |
| Etherscan Verification | **Done** (10/10 verified) |
| Uniswap LP Pairing | **Done** — [`0x2252e8bBDE0E50CD372748aC233A99C08627d9c7`](https://sepolia.etherscan.io/address/0x2252e8bBDE0E50CD372748aC233A99C08627d9c7) |
| Router on BuybackVault | **Done** — `0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008` |
| InfernoToken Ownership to Governance | **Done** — TX `0xa69bf285...d5762e1b` |
| LiquidityReserve/BuybackVault/BurnReserve v2 Deployed | **Done** — Redeployed with `transferOwnership()`. Ownership transferred to Governance. |
| feeExempt Proposals #7-9 Executed | **Done** — LiquidityReserve v2, BuybackVault v2, BurnReserve v2 |
| Governance Proposal #0 Executed | **Done** — TX [`0x13ff46d8...cbbe982d`](https://sepolia.etherscan.io/tx/0x13ff46d8a113f25b9ab0037ee06d6108c62d0f16e25d28799e4f45a8cbbe982d) |
| IFRLock Deployed + Verified | **Done** — [`0x0Cab0A94...`](https://sepolia.etherscan.io/address/0x0Cab0A9440643128540222acC6eF5028736675d3) |
| IFRLock Live Test | **Done** — 8/8 passed (full lock/unlock cycle) |
| Governance Proposal #1 | **Done** — setFeeExempt(IFRLock, true), TX [`0x211b7949...`](https://sepolia.etherscan.io/tx/0x211b794970abe147b3ab2f3c92bb79b3b3c5a72bc8be8cfb7e1d00fd4253a909) |
| PartnerVault Deployed + Verified | **Done** — [`0x5F12C0bC...`](https://sepolia.etherscan.io/address/0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39) |
| PartnerVault Funded | **Done** — 40M IFR (38.6M initial + 1.4M top-up after Proposal #3) |
| Governance Proposal #3 | **Executed** — setFeeExempt(PartnerVault v2, true), TX 0x3f28690a...57de6e8 |
| BootstrapVault Deployed + Verified | **Done** — [`0xE0E8F76e...`](https://sepolia.etherscan.io/address/0xE0E8F76e4fb38B2e367Aee043a2C02b8D1c7c037) — 2026-03-04 |

---

## Ethereum Mainnet

**Datum:** 2026-03-05
**Deployer:** `0x6b36687b0cd4386fb14cf565B67D7862110Fed67`
**Network:** Ethereum Mainnet (Chain ID: 1)

### Contract Addresses

| # | Contract | Address | Verified |
|---|----------|---------|----------|
| 1 | **InfernoToken** | [`0x77e99917Eca8539c62F509ED1193ac36580A6e7B`](https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#code) | Verified |
| 2 | **Governance** | [`0xc43d48E7FDA576C5022d0670B652A622E8caD041`](https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041#code) | Verified |
| 3 | **IFRLock** | [`0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb`](https://etherscan.io/address/0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb#code) | Verified |
| 4 | **BurnReserve** | [`0xaA1496133B6c274190A2113410B501C5802b6fCF`](https://etherscan.io/address/0xaA1496133B6c274190A2113410B501C5802b6fCF#code) | Verified |
| 5 | **BuybackVault** | [`0x670D293e3D65f96171c10DdC8d88B96b0570F812`](https://etherscan.io/address/0x670D293e3D65f96171c10DdC8d88B96b0570F812#code) | Verified |
| 6 | **PartnerVault** | [`0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D`](https://etherscan.io/address/0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D#code) | Verified |
| 7 | **FeeRouterV1** | [`0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a`](https://etherscan.io/address/0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a#code) | Verified |
| 8 | **Vesting** | [`0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271`](https://etherscan.io/address/0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271#code) | Verified |
| 9 | **LiquidityReserve** | [`0xdc0309804803b3A105154f6073061E3185018f64`](https://etherscan.io/address/0xdc0309804803b3A105154f6073061E3185018f64#code) | Verified |

### Token Distribution (CFLM)

| Recipient | Amount | Address |
|-----------|--------|---------|
| DEX Liquidity | 400,000,000 IFR (40%) | Deployer (for LP pairing) |
| Liquidity Reserve | 200,000,000 IFR (20%) | [`0xdc0309804803b3A105154f6073061E3185018f64`](https://etherscan.io/address/0xdc0309804803b3A105154f6073061E3185018f64) |
| Team Vesting | 150,000,000 IFR (15%) | [`0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271`](https://etherscan.io/address/0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271) |
| Treasury | 150,000,000 IFR (15%) | [`0xC8f4B45fA0C4727E9b27c13Af3d000C922a2ac9c`](https://etherscan.io/address/0xC8f4B45fA0C4727E9b27c13Af3d000C922a2ac9c) |
| Community & Grants | 60,000,000 IFR (6%) | [`0x61aF4E72C77b58F4b50964Ee93d420750Cd9857E`](https://etherscan.io/address/0x61aF4E72C77b58F4b50964Ee93d420750Cd9857E) |
| Partner Ecosystem | 40,000,000 IFR (4%) | [`0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D`](https://etherscan.io/address/0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D) (PartnerVault) |

### Configuration

| Setting | Value |
|---------|-------|
| FeeExempt | Vesting, LiquidityReserve, BuybackVault, BurnReserve, IFRLock, PartnerVault, Treasury |
| Deployer FeeExempt | Removed |
| LiquidityReserve Lock | 180 days |
| Vesting Cliff | 12 months |
| Vesting Duration | 48 months (12mo cliff + 36mo linear) |
| BuybackVault Activation | 60 days |
| Governance Delay | 48 hours |
| Uniswap V2 Router | [`0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D`](https://etherscan.io/address/0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D) |

### Post-Deploy Status

| Step | Status |
|------|--------|
| 9 Contracts Deployed | Done (2026-03-05) |
| Etherscan Verification | Done (9/9 verified) |
| feeExempt Wiring | Done |
| Token Distribution (CFLM) | Done |
| Deployer Exemption Removed | Done |

### Ownership Transfer (2026-03-05)

All ownable contracts transferred to Governance (48h Timelock). Parameter changes now require `propose()` + 48h wait + `execute()`.

| Contract | Method | TX Hash | Gas |
|----------|--------|---------|-----|
| InfernoToken | `transferOwnership()` | [`0x0fc4684c...16ed5e76`](https://etherscan.io/tx/0x0fc4684cfec94ecd3573344f892928c8d52c2074d5833b01e6e1c83616ed5e76) | 29,108 |
| LiquidityReserve | `transferOwnership()` | [`0x34650ee4...6d12c7d4`](https://etherscan.io/tx/0x34650ee45d111dc3b8ea5eb72b0b7753aada03977f0d17e37d05c07f6d12c7d4) | 28,916 |
| BurnReserve | `transferOwnership()` | [`0x757d519b...0ca5b1a`](https://etherscan.io/tx/0x757d519b303f1e775ada75fcdfcaa1b86218e76e13d2750e224e448ab0ca5b1a) | 28,916 |
| BuybackVault | `transferOwnership()` | [`0xcd037869...afea3971`](https://etherscan.io/tx/0xcd03786978f402c768d3b270770211019918b5a232eb9884ab0f2bcdafea3971) | 28,894 |
| PartnerVault | `setAdmin()` | Already Governance at deploy | — |
| FeeRouterV1 | `governance()` | Immutable at deploy | — |

**Total Gas Used:** 115,834

### Ownership Status (Post-Transfer)

| Contract | Role | Controller |
|----------|------|------------|
| InfernoToken | `owner()` | Governance |
| LiquidityReserve | `owner()` | Governance |
| BurnReserve | `owner()` | Governance |
| BuybackVault | `owner()` | Governance |
| PartnerVault | `admin()` | Governance |
| FeeRouterV1 | `governance()` | Governance (immutable) |
| IFRLock | `guardian()` | Deployer (emergency pause only) |
| Vesting | `guardian()` | Deployer (emergency pause only) |
| Governance | `owner()` | Deployer (pending transfer to Gnosis Safe) |

### NEXT STEPS (Mainnet)

| Step | Status |
|------|--------|
| Create Uniswap V2 LP (400M IFR + ETH) | Pending |
| Lock LP Tokens (min 12 months) | Pending |
| Transfer InfernoToken Ownership to Governance | **Done** (2026-03-05) |
| Transfer LiquidityReserve Ownership to Governance | **Done** (2026-03-05) |
| Transfer BurnReserve Ownership to Governance | **Done** (2026-03-05) |
| Transfer BuybackVault Ownership to Governance | **Done** (2026-03-05) |
| Transfer Governance Owner to Multisig | Pending |

---

## Gnosis Safe (Mainnet)

| Detail | Value |
|--------|------|
| Address | [`0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`](https://etherscan.io/address/0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b) |
| Network | Ethereum Mainnet |
| Threshold | 1-of-1 (Phase 0 — expand to 2-of-3 before mainnet) |
| Deployed | 2026-03-04 |
| Safe URL | [app.safe.global](https://app.safe.global/home?safe=eth:0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b) |
