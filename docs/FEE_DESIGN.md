# IFR Fee Design -- Why 3.5%?

## Core Principle: Lock > Transfer

IFR is not a trading token. The model is based on:
1. Buy once
2. Lock once
3. Use benefits permanently

Transfers happen rarely -- when buying, when locking, when unlocking.
Not daily. Therefore 3.5% is bearable.

## Fee Breakdown

| Fee | Destination | Purpose |
|-----|-------------|---------|
| 2.5% | Burn (permanent) | Deflation -- supply decreases |
| 1.0% | BuybackVault | Strengthen liquidity |
| Total | 3.5% | Automatic, no governance required |

## Fee-Exempt Addresses

| Address | Why exempt? |
|---------|-------------|
| IFRLock | Lock/Unlock should not incur fees |
| LiquidityReserve | Internal protocol transfers |
| BuybackVault | Buyback logic without loss |
| BurnReserve | Burn mechanism |
| PartnerVault | Reward payouts (after Proposal #3) |
| DEX Router | Uniswap V2 swap without double-fee |

All exempt addresses: transparent on-chain, changeable only via Governance.

## CEX Listing Strategy

Fee-on-transfer tokens have increased CEX requirements:
- Transparency about fee mechanism (check)
- No "hidden fee" (check -- everything on-chain)
- Coordination with exchange about fee-exempt

Phase 0: DEX-only (Uniswap V2)
Phase 2+: CEX outreach after mainnet and audit

## MEV & Slippage

For Uniswap V2 swaps:
- Slippage setting at least 4% recommended (3.5% fee + AMM slippage)
- Alternatively: buy directly via IFR Governance Dashboard
- FeeRouter handles routing with correct parameters

---
## Fee Collector

Since 18.04.2026 (Governance Proposal #14), the `feeCollector` on FeeRouterV1 is set to the **BuybackController** (`0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c`). Protocol pool fees flow directly into the 50/50 buyback+burn / LP-deepening flywheel.

*Version 1.1 | April 2026 | Mainnet Live*
