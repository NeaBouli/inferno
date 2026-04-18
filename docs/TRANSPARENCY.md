# Inferno ($IFR) — On-Chain Transparency Report

Last updated: April 2026 | Network: Ethereum Mainnet

All data is verifiable on-chain via Etherscan. No hidden wallets, no insider deals.

---

## CHECK 1: Contract Ownership

| Contract | Owner | Status |
|----------|-------|--------|
| InfernoToken | [`0xc43d...d041`](https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041) (Governance) | OK |
| IFRLock | admin-pattern (no Ownable) | OK |
| PartnerVault | admin-pattern (Governance) | OK |
| FeeRouterV1 | admin-pattern (Governance) | OK |
| LiquidityReserve | [`0xc43d...d041`](https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041) (Governance) | OK |
| BuybackVault | [`0xc43d...d041`](https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041) (Governance) | OK |
| BurnReserve | [`0xc43d...d041`](https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041) (Governance) | OK |

> All contracts are under Governance (Timelock) control. No single person can make instant changes — all modifications require a 48-hour delay.

**Verify:** https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#readContract

---

## CHECK 2: LP Token Ownership

| Metric | Value |
|--------|-------|
| LP Total Supply | TBD (after LP pairing) |
| Deployer LP Balance | TBD |
| Burned LP (0xdead) | 0 |

> LP tokens will be permanently burned (sent to `0x000...dEaD`) or locked via Unicrypt after LP pairing. This locks liquidity permanently.

---

## CHECK 3: Vesting Contract

| Parameter | Value |
|-----------|-------|
| Address | [`0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271`](https://etherscan.io/address/0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271) |
| IFR Balance | 150,000,000 IFR (15% of supply) |
| Beneficiary | Team |
| Cliff | 365 days from deploy |
| Duration | 1,460 days (4 years) |
| Released | 0 IFR |
| Releasable | 0 IFR (cliff not reached) |

150M IFR are locked in the contract. No tokens have been released early. Cliff runs until approximately March 2027.

---

## CHECK 4: LiquidityReserve

| Parameter | Value |
|-----------|-------|
| Address | [`0xdc0309804803b3A105154f6073061E3185018f64`](https://etherscan.io/address/0xdc0309804803b3A105154f6073061E3185018f64) |
| IFR Balance | 200,000,000 IFR (20% of supply) |
| Lock Period | 180 days (6 months) |
| Release Rate | 50M IFR per quarter |

200M IFR (20%) held in reserve for future liquidity needs.

---

## CHECK 5: BuybackVault

| Parameter | Value |
|-----------|-------|
| Address | [`0x670D293e3D65f96171c10DdC8d88B96b0570F812`](https://etherscan.io/address/0x670D293e3D65f96171c10DdC8d88B96b0570F812) |
| IFR Balance | 0 IFR (initial state) |
| Router | Uniswap V2 Router02 |
| Slippage | 5% |
| Burn Share | 50% |
| Activation | 60 days after deploy |

BuybackVault is initially empty — it collects 1% pool fees from transfers. Activation delay ensures no premature buyback.

---

## CHECK 6: FeeExempt Status

| Contract | feeExempt |
|----------|-----------|
| InfernoToken | true |
| IFRLock | true |
| LiquidityReserve | true |
| BuybackVault | true |
| BurnReserve | true |
| PartnerVault | true |
| Treasury | true |
| Governance | false (no IFR held) |
| FeeRouterV1 | true |
| LP Pair | false (fee applies to swaps) |

---

## CHECK 7: PartnerVault

| Parameter | Value |
|-----------|-------|
| Address | [`0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D`](https://etherscan.io/address/0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D) |
| IFR Balance | 40,000,000 IFR (4%) |
| Admin | Governance (Timelock) |
| Reward Rate | 1,500 bps (15%) |
| Annual Emission Cap | 4,000,000 IFR |
| Total Rewarded | 0 IFR |
| Algo Throttle | OFF (activates with first builder) |

Admin is Governance — no deployer access possible.

---

## CHECK 8: Token Supply Distribution

| Wallet | IFR | % |
|--------|-----|---|
| Total Supply | ~998,000,000 IFR | 100% |
| LP (DEX Liquidity) | 400,000,000 IFR | ~40% |
| LiquidityReserve | 200,000,000 IFR | ~20% |
| Vesting (Team) | 150,000,000 IFR | ~15% |
| Treasury | 150,000,000 IFR | ~15% |
| Community & Grants | 60,000,000 IFR | ~6% |
| PartnerVault | 40,000,000 IFR | ~4% |
| Burned (since deploy) | ~2,000,000 IFR | ~0.2% |

Deflation is verified on-chain. Supply can only decrease — there is no mint function.

---

## Gnosis Safe Multisig

| Detail | Value |
|--------|-------|
| Address | [`0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`](https://etherscan.io/address/0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b) |
| Network | Ethereum Mainnet |
| Threshold | 3-of-5 (5 active signers: A.K., M.G., A.M., Y.K., A.P.) |
| Safe URL | [app.safe.global](https://app.safe.global/home?safe=eth:0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b) |
| Status | Active |
| Deployed | 2026-03-04 |

---

## How to Verify

```bash
git clone https://github.com/NeaBouli/inferno
cd inferno
npm install
# All contracts are verified on Etherscan — read state directly
# Or run tests locally:
npx hardhat test
```

Or verify directly on Etherscan:
- [InfernoToken — Read Contract](https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#readContract)
- [Vesting Contract](https://etherscan.io/address/0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271)
- [Governance (Timelock)](https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041)
- [PartnerVault](https://etherscan.io/address/0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D)

*All data from Ethereum Mainnet. Last updated: April 2026 | Version 2.1*
