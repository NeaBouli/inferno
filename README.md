<p align="center">
  <img src="docs/assets/ifr_logo_400x400.jpg" alt="Inferno $IFR" width="200" />
</p>

# Inferno ($IFR)

Deflationary ERC20 token with fee-on-transfer burn mechanics, buyback system, and timelock governance.
Built on the **Community Fair Launch Model (CFLM)** — no presale, fair distribution from day one.

## Contracts

| # | Contract | Path | Description |
|---|----------|------|-------------|
| 1 | **InfernoToken** | `contracts/token/InfernoToken.sol` | ERC20 (9 decimals), 1B supply, fee-on-transfer: 2% sender burn + 0.5% recipient burn + 1% pool fee |
| 2 | **LiquidityReserve** | `contracts/liquidity/LiquidityReserve.sol` | Strategic reserve with 6-month lock and staged withdrawal (50M IFR per quarter) |
| 3 | **Vesting** | `contracts/vesting/Vesting.sol` | Post-cliff linear vesting (12mo cliff, 36mo linear), guardian pause |
| 4 | **BuybackVault** | `contracts/buyback/BuybackVault.sol` | ETH deposit + automated DEX buyback, 50/50 split to burn reserve + treasury, 60-day activation delay |
| 5 | **BurnReserve** | `contracts/burnreserve/BurnReserve.sol` | Permanent token burn with totalBurned tracking, owner + guardian auth |
| 6 | **Governance** | `contracts/governance/Governance.sol` | Timelock governor (propose/execute/cancel), 48h default delay, guardian emergency cancel |

## Token Economics

| Parameter | Value |
|-----------|-------|
| Name / Symbol | Inferno / IFR |
| Decimals | 9 |
| Total Supply | 1,000,000,000 IFR |
| Sender Burn | 2.0% (200 bps) |
| Recipient Burn | 0.5% (50 bps) |
| Pool Fee | 1.0% (100 bps) |
| Max Fee Cap | 5.0% (500 bps) |

### Token Distribution (CFLM)

| Recipient | Amount | Share | Mechanism |
|-----------|--------|-------|-----------|
| DEX Liquidity | 400,000,000 IFR | 40% | Deployer pairs with ETH on Uniswap |
| Liquidity Reserve | 200,000,000 IFR | 20% | LiquidityReserve.sol (6mo lock, 50M/quarter) |
| Team Vesting | 150,000,000 IFR | 15% | Vesting.sol (12mo cliff + 36mo linear) |
| Treasury | 150,000,000 IFR | 15% | Direct to multisig address |
| Community/Ecosystem | 100,000,000 IFR | 10% | Direct to community wallet |

### Fee Exempt

Vesting, LiquidityReserve, Treasury, BuybackVault, BurnReserve — deployer exemption is removed after distribution.

## Setup

```bash
npm install
npx hardhat compile
npx hardhat test
```

## Test Suite

125 tests across 6 test files:

| Suite | Tests | Covers |
|-------|-------|--------|
| **InfernoToken** | 21 | Deployment, fee math, exemptions, owner functions, edge cases |
| **LiquidityReserve** | 28 | Lock period, staged withdrawal, pause, period limits |
| **Vesting** | 7 | Cliff, post-cliff linear release, beneficiary access, guardian pause |
| **BuybackVault** | 9 | Deposit, buyback split, cooldown, slippage, 60-day activation |
| **BurnReserve** | 21 | Deposit, burn, burnAll, totalBurned tracking, guardian auth |
| **Governance** | 36 | Propose, execute, cancel, self-governance delay, integration with InfernoToken |

## Architecture

```
    [Deployer] -- 1B IFR minted
         |
         +-- 400M --> DEX Liquidity (paired with ETH)
         +-- 200M --> [LiquidityReserve] (6mo lock, 50M/quarter)
         +-- 150M --> [Vesting] (12mo cliff, 36mo linear)
         +-- 150M --> [Treasury Multisig]
         +-- 100M --> [Community Wallet]

    [Governance] (48h Timelock)
         |
    Owner of InfernoToken (after transferOwnership)
         |
    propose() --> 48h delay --> execute()
         |
    setFeeRates(), setFeeExempt(), setPoolFeeReceiver()
    Guardian can cancel proposals

    [BuybackVault] (active after 60 days)
         |
    ETH deposit --> DEX swap --> IFR
         |                        |
    50% --> [BurnReserve]    50% --> [Treasury]
         |
    burn() --> totalSupply decreases

    [InfernoToken] -- every transfer:
       2.0% sender burn (totalSupply decreases)
       0.5% recipient burn (totalSupply decreases)
       1.0% pool fee --> poolFeeReceiver
```

## Deploy

### Prerequisites

1. Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

2. Required `.env` variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `SEPOLIA_RPC_URL` | Yes | Alchemy/Infura Sepolia endpoint |
| `DEPLOYER_PRIVATE_KEY` | Yes | Wallet private key (needs ~0.1 ETH for gas) |
| `TREASURY_ADDRESS` | No | Treasury multisig (defaults to deployer) |
| `COMMUNITY_ADDRESS` | No | Community wallet (defaults to deployer) |
| `TEAM_BENEFICIARY` | No | Vesting beneficiary (defaults to deployer) |

### Dry Run (local)

```bash
npx hardhat run scripts/deploy-testnet.js
```

### Testnet (Sepolia)

```bash
npx hardhat run scripts/deploy-testnet.js --network sepolia
```

### Deploy Script (9 Steps)

```
Step 1/9  Deploy InfernoToken (1B IFR minted to deployer)
Step 2/9  Deploy LiquidityReserve (6mo lock, 50M/quarter)
Step 3/9  Deploy Vesting (12mo cliff, 36mo linear, 150M IFR)
Step 4/9  Deploy BurnReserve + BuybackVault (60-day activation)
Step 5/9  (BurnReserve already deployed in step 4)
Step 6/9  Deploy Governance (48h timelock delay)
Step 7/9  Set feeExempt for all contracts + deployer (temporary)
Step 8/9  Distribute tokens (200M+150M+150M+100M, 400M stays with deployer)
Step 9/9  Remove deployer feeExempt
```

### LP Pairing (Uniswap V2)

After deployment, create the IFR/ETH liquidity pool:

```bash
npx hardhat run scripts/create-lp.js --network sepolia
```

The script performs 4 steps:
1. Pre-flight checks (ETH balance, IFR balance, Router reachable)
2. Set deployer feeExempt + approve Router
3. `addLiquidityETH` (400M IFR + ETH, 2% slippage tolerance)
4. Update BuybackVault router via `setParams()`

Configure via `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `UNISWAP_V2_ROUTER` | `0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008` | Uniswap V2 Router02 (Sepolia) |
| `LP_IFR_AMOUNT` | `400000000` | IFR amount for LP (400M) |
| `LP_ETH_AMOUNT` | `0.01` | ETH amount for LP |

### Post-Deploy Checklist

| # | Step | Status |
|---|------|--------|
| 1 | Deploy 6 contracts | Done |
| 2 | Verify on Etherscan | Done (6/6) |
| 3 | Pair LP (Uniswap V2) | **Done** — [`0x2252e8b...`](https://sepolia.etherscan.io/address/0x2252e8bBDE0E50CD372748aC233A99C08627d9c7) |
| 4 | Update BuybackVault Router | **Done** — Uniswap V2 Router02 |
| 5 | Set Addresses — Update treasury if placeholder was used | Pending |
| 6 | Transfer Ownership — `InfernoToken.transferOwnership(governance.address)` | Pending |

## Tech Stack

| Component | Version |
|-----------|---------|
| Solidity | 0.8.20 |
| Hardhat | ^2.x |
| OpenZeppelin Contracts | v5 |
| ethers.js | ^5.x (Waffle/Chai) |
| Network | Sepolia (configured) |

## Documentation

| File | Description |
|------|-------------|
| `STATUS-REPORT.md` | Full project status with all contract details |
| `docs/FAIR-LAUNCH-MIGRATION.md` | CFLM migration plan and architecture analysis |
| `docs/README.md` | Project structure and module status |
| `docs/SECURITY-AUDIT.md` | Slither audit report (0 high/critical) |
| `docs/DEPLOYMENTS.md` | Deployed contract addresses (Sepolia) |
