# Inferno ($IFR) — Deployments

## Sepolia Testnet

**Datum:** 2026-02-16
**Deployer:** `0x5Ecc668eab04C5bee81b5c7242e1077c946dE406`
**Network:** Sepolia (Chain ID: 11155111)

### Contract Addresses

| # | Contract | Address | Verified |
|---|----------|---------|----------|
| 1 | **InfernoToken** | [`0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4`](https://sepolia.etherscan.io/address/0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4#code) | Verified |
| 2 | **LiquidityReserve** | [`0xF7E90D0d17f8232365186AA085D26eaEfAf011aF`](https://sepolia.etherscan.io/address/0xF7E90D0d17f8232365186AA085D26eaEfAf011aF#code) | Verified |
| 3 | **Vesting** | [`0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B`](https://sepolia.etherscan.io/address/0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B#code) | Verified |
| 4 | **BuybackVault** | [`0xC8ABb9039BEd24f4dBf5Cff09699877D81f0D63C`](https://sepolia.etherscan.io/address/0xC8ABb9039BEd24f4dBf5Cff09699877D81f0D63C#code) | Verified |
| 5 | **BurnReserve** | [`0x6D4582FCac792FD3880e252fC0a585A0c1823e80`](https://sepolia.etherscan.io/address/0x6D4582FCac792FD3880e252fC0a585A0c1823e80#code) | Verified |
| 6 | **Governance** | [`0x6050b22E4EAF3f414d1155fBaF30B868E0107017`](https://sepolia.etherscan.io/address/0x6050b22E4EAF3f414d1155fBaF30B868E0107017#code) | Verified |
| 7 | **IFRLock** | [`0x0Cab0A9440643128540222acC6eF5028736675d3`](https://sepolia.etherscan.io/address/0x0Cab0A9440643128540222acC6eF5028736675d3#code) | Verified |

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

### Token Distribution

| Recipient | Amount | Address |
|-----------|--------|---------|
| DEX Liquidity | 400,000,000 IFR (40%) | LP Pair [`0x2252e8bBDE0E50CD372748aC233A99C08627d9c7`](https://sepolia.etherscan.io/address/0x2252e8bBDE0E50CD372748aC233A99C08627d9c7) |
| Liquidity Reserve | 200,000,000 IFR (20%) | `0xF7E90D0d17f8232365186AA085D26eaEfAf011aF` |
| Team Vesting | 150,000,000 IFR (15%) | `0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B` |
| Treasury | 150,000,000 IFR (15%) | Deployer (placeholder) |
| Community | 100,000,000 IFR (10%) | Deployer (placeholder) |

### Configuration

| Setting | Value |
|---------|-------|
| FeeExempt | Vesting, LiquidityReserve, Treasury, BuybackVault, BurnReserve, IFRLock (Proposal #1 pending) |
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
| 1 | `setFeeExempt(IFRLock, true)` | InfernoToken | 2026-02-22 21:15 CET | — | Pending (ETA 22.02.) |

### Post-Deploy Status

| Step | Status |
|------|--------|
| Contract Deploy | Done |
| feeExempt Wiring | Done |
| Token Distribution | Done |
| Deployer Exemption Removed | Done |
| Etherscan Verification | **Done** (7/7 verified) |
| Uniswap LP Pairing | **Done** — [`0x2252e8bBDE0E50CD372748aC233A99C08627d9c7`](https://sepolia.etherscan.io/address/0x2252e8bBDE0E50CD372748aC233A99C08627d9c7) |
| Router on BuybackVault | **Done** — `0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008` |
| Ownership to Governance | **Done** — TX `0xa69bf285...d5762e1b` |
| Governance Proposal #0 Executed | **Done** — TX [`0x13ff46d8...cbbe982d`](https://sepolia.etherscan.io/tx/0x13ff46d8a113f25b9ab0037ee06d6108c62d0f16e25d28799e4f45a8cbbe982d) |
| IFRLock Deployed + Verified | **Done** — [`0x0Cab0A94...`](https://sepolia.etherscan.io/address/0x0Cab0A9440643128540222acC6eF5028736675d3) |
| IFRLock Live Test | **Done** — 5/5 passed (unlock pending feeExempt) |
| Governance Proposal #1 | **Pending** — setFeeExempt(IFRLock, true), ETA 2026-02-22 21:15 CET |
