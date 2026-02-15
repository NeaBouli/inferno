# Inferno ($IFR)

Deflationary ERC20 token with fee-on-transfer burn mechanics and buyback system.

## Contracts

| Contract | Path | Description |
|---|---|---|
| **InfernoToken** | `contracts/token/InfernoToken.sol` | ERC20 (9 decimals), 1 Mrd supply, fee-on-transfer: 2% sender burn + 0.5% recipient burn + 1% pool fee |
| **Presale** | `contracts/presale/Presale.sol` | ETH-to-IFR presale with TOKEN_PRICE, hardCap, perWalletCap, time window |
| **BuybackVault** | `contracts/buyback/BuybackVault.sol` | ETH deposit + automated buyback via DEX router, split to burn reserve + treasury |
| **Vesting** | `contracts/vesting/Vesting.sol` | Linear vesting with cliff, guardian pause, beneficiary release |

## Token Economics

- **Name:** Inferno | **Symbol:** IFR | **Decimals:** 9
- **Total Supply:** 1,000,000,000 IFR
- **Fee-on-Transfer:** 3.5% total (2% sender burn, 0.5% recipient burn, 1% pool fee)
- **Fee Exempt:** Presale, Vesting, Treasury, BurnReserve (configurable via `setFeeExempt`)
- **Max Fee:** 5% (enforced on-chain)

## Setup

```bash
npm install
npx hardhat compile
npx hardhat test
```

## Test Suite

57 tests across 4 test files:

- **BuybackVault** (6) — deposit, buyback split, cooldown, slippage, pause, params
- **InfernoToken** (22) — deployment, fee math, exemptions, owner functions, edge cases
- **Presale** (24) — TOKEN_PRICE with 9 decimals, buy flow, guards, finalize, withdraw
- **Vesting** (5) — cliff, linear release, beneficiary access, guardian pause

## Architecture

```
                 InfernoToken (IFR)
                 ERC20 + Fee-on-Transfer
                        |
         +--------------+--------------+
         |              |              |
      Presale        Vesting     BuybackVault
      ETH->IFR     Cliff+Linear   ETH->Swap
      feeExempt    feeExempt      BurnReserve
                                  + Treasury
```

## Tech Stack

- Solidity 0.8.20
- Hardhat v2
- OpenZeppelin Contracts v5
- Ethers.js v5 / Waffle / Chai
