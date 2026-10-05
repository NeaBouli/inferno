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
| --- | --- | --- |
| 2.5% | Burn (permanent) | Deflation -- supply decreases |
| 1.0% | BuybackController (since Proposal #21, 5 October 2026) | IFR pool fee; recoverable by Governance through `withdrawIFR`. Until #21 it went to FeeRouterV1, which has no IFR withdrawal path (CWA-02, permanently lost) |
| Total | 3.5% | Automatic, no governance required |

## Fee-Exempt Addresses

| Address | Why exempt? |
|---------|-------------|
| IFRLock | Lock/Unlock should not incur fees |
| LiquidityReserve | Internal protocol transfers |
| BuybackVault | Buyback logic without loss |
| BurnReserve | Burn mechanism |
| PartnerVault | Fee-exempt protocol vault; seller rewards remain separately governance-gated and inactive |
| CommitmentVault V2 | CV-01 repair vault for time-only locks; exempt since Proposal #17 (executed 04.10.2026, block 26121846) |
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

Since 18.04.2026 (Governance Proposal #14), the `feeCollector` on FeeRouterV1 is set to the **BuybackController** (`0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c`). This setting applies to native ETH fees charged by `FeeRouterV1.swapWithFee()`. It does not forward IFR transfer-pool fees already held by FeeRouterV1. Controller execution remains subject to its ETH trigger, cooldown, pause state and available IFR balance; there is no PartnerVault refill path.

## Pool Fee Receiver (CWA-02, Decision 3 October 2026)

- From Proposal #6 (13.03.2026) until Proposal #21 (5 October 2026) `InfernoToken.poolFeeReceiver` was FeeRouterV1. FeeRouterV1 has no IFR withdrawal or forwarding function, so every IFR pool fee it received is permanently lost. It is not burned and stays in `totalSupply()`.
- At block 26,108,134 FeeRouterV1 held 724,992.668043224 IFR; as of block 26,124,660 (Proposal #21 executed) it holds 734,545.074097347 IFR.
- Owner decision (Lane 3, option B): future pool fees go to BuybackController `0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c` via `InfernoToken.setPoolFeeReceiver`, a Governance proposal with the 48-hour timelock. There the IFR stays recoverable by Governance through `withdrawIFR`. The deployed controller is dormant (JUL-08), so the IFR is not used automatically until Governance decides how.
- Status: executed. The Treasury Safe executed Proposal #21 on 5 October 2026, 07:25:23 UTC, block 26,124,660, TX `0x8de48b47dfa8f17b631fb744bc4deef9bbb68271f8b700b422cdd3abb739ca26`; `poolFeeReceiver()` = BuybackController. IFR already in FeeRouterV1 stays lost.

27,153,013.07 IFR are permanently lost (not burned; still counted in totalSupply): 26,418,467.99 IFR in CommitmentVault V1 price-conditioned tranches (CV-01) and 734,545.07 IFR of pool fees in FeeRouterV1 (CWA-02), as of block 26,124,660 on 5 October 2026. In that block Proposal #21 stopped the pool-fee inflow to FeeRouterV1; direct transfers to that address remain possible, so its part is read live.

*Version 1.4 | 5 October 2026 | Mainnet Live*
