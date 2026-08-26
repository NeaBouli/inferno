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
| 1.0% | FeeRouterV1 | Route protocol pool fees to the governed fee collector |
| Total | 3.5% | Automatic, no governance required |

## Fee-Exempt Addresses

| Address | Why exempt? |
|---------|-------------|
| IFRLock | Lock/Unlock should not incur fees |
| LiquidityReserve | Internal protocol transfers |
| BuybackVault | Buyback logic without loss |
| BurnReserve | Burn mechanism |
| PartnerVault | Fee-exempt protocol vault; seller rewards remain separately governance-gated and inactive |
| IFR/WETH Pair | Uniswap V2 pair transfers without the token fee |

All exempt addresses: transparent on-chain, changeable only via Governance.

## CEX Fee-Exemption Policy

On 26 August 2026 at 00:17 MET, the five-member Core Developer and Keyholder
Council approved full fee exemption by a 4-1 vote for transfers to and from officially verified CEX
operational addresses. Once an exact exchange address is activated on-chain,
the complete 3.5% fee is bypassed: no sender burn, recipient burn or pool fee.

No CEX address is currently fee-exempt on-chain. Each activation requires:

1. official exchange contact and address-role disclosure;
2. cryptographic proof of address control;
3. a public TreasurySafe 3-of-5 Governance proposal;
4. the 48-hour timelock and execution; and
5. public registration and continuing monitoring.

Internal CEX trades are off-chain and never invoke the IFR token contract.
See [the full exchange policy](EXCHANGE_FEE_EXEMPTION_POLICY.md).

## MEV & Slippage

For Uniswap V2 swaps:
- The IFR/WETH pair is fee-exempt; the Uniswap V2 router is not.
- Pair buys and sells therefore bypass the 3.5% IFR token fee.
- Use a current quote and allow only the AMM price impact and execution
  tolerance appropriate for the trade; there is no fixed 4% token-fee minimum.

---
## Fee Collector

Since 18.04.2026 (Governance Proposal #14), the `feeCollector` on FeeRouterV1 is set to the **BuybackController** (`0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c`). Protocol pool fees flow directly into the 50/50 buyback+burn / LP-deepening flywheel.

*Version 1.2 | 26 August 2026 | Mainnet Live*
