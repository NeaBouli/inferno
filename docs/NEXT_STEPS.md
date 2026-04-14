# BuybackController — Next Steps

> Created: 2026-04-14 | Status: Proposal A in Timelock

---

## 1. Execute Proposal A: setFeeExempt(BuybackController, true)

**When:** ~16.04.2026, 07:30 UTC+2 (48h after submission)
**Who:** Any TreasurySafe signer (3-of-5 already signed)

### Steps:
1. Go to [Safe Transaction Queue](https://app.safe.global/home?safe=eth:0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b)
2. Find the pending `execute()` transaction for Proposal A
3. Execute the transaction (any signer can trigger after timelock expires)
4. Verify on-chain:
   ```
   InfernoToken.feeExempt(0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c) == true
   ```

### What this does:
- Exempts BuybackController from the 2.5% burn + 1% pool fee
- Without this, every buyback operation would lose 3.5% to fees
- **MUST be executed BEFORE Proposal B**

### Safe TX Builder JSON:
See `docs/safe-proposal-a.json` for the pre-built calldata.

---

## 2. Submit Proposal B: setFeeCollector(BuybackController) on FeeRouterV1

**When:** Immediately after Proposal A is executed
**Who:** TreasurySafe 3-of-5

### Calldata:
```
Target:   0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a  (FeeRouterV1)
Function: setFeeCollector(address)
Argument: 0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c  (BuybackController)
```

### How to submit:
1. Go to Safe Transaction Queue
2. Use Governance.propose():
   - `target`: `0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a` (FeeRouterV1)
   - `data`: `0xa0ee4e69` + `0000000000000000000000001e0547d50005a4af66abd5e6915ebfaa2d711f7c`
   (selector for `setFeeCollector(address)` = `0xa0ee4e69`)
3. Collect 3-of-5 signatures
4. Wait 48h timelock

### What this does:
- Routes all protocol fees (1% pool fee from FeeRouterV1) to BuybackController
- Currently fees go to deployer address — this redirects to the automated controller

---

## 3. Execute Proposal B

**When:** ~48h after Proposal B submission (~18.04.2026 if submitted on 16.04)
**Who:** Any TreasurySafe signer

### Verify on-chain:
```
FeeRouterV1.feeCollector() == 0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c
```

---

## 4. After Both Proposals Executed — Buyback is LIVE

Once both proposals are executed:

1. **BuybackController receives fees** automatically from FeeRouterV1
2. **Anyone can call `execute()`** — permissionless, 24h cooldown between calls
3. **50/50 split:**
   - 50% → Buy IFR from Uniswap → Send to BurnReserve (permanent burn)
   - 50% → Add IFR+ETH liquidity to Uniswap LP (deepening)
4. **Slippage protection:** `minIFR` / `minETH` parameters prevent sandwich attacks

### Contract Details:
| Property | Value |
|----------|-------|
| Address | [`0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c`](https://etherscan.io/address/0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c#code) |
| Network | Ethereum Mainnet |
| Deploy TX | [`0x761ee37c...`](https://etherscan.io/tx/0x761ee37c87d528317c5f7da13a2581e037f2fe39c71bfc58ce83a32930391677) |
| Deploy Date | 2026-04-14 |
| Sepolia | [`0xaA1496133B6c274190A2113410B501C5802b6fCF`](https://sepolia.etherscan.io/address/0xaA1496133B6c274190A2113410B501C5802b6fCF#code) |
| Owner | Deployer (`0x6b36687b0cd4386fb14cf565B67D7862110Fed67`) |
| Cooldown | 24 hours |
| Split | 50% buyback+burn / 50% LP deepening |
| Security | BC-1 Slippage Protection, BC-2 Exact approve |

---

## Timeline Summary

| Date | Action | Status |
|------|--------|--------|
| 13.04.2026 | BuybackController deployed Sepolia | Done |
| 14.04.2026 | BuybackController deployed Mainnet | Done |
| 14.04.2026 | Proposal A submitted (3/5 signed) | Done |
| ~16.04.2026 | Execute Proposal A (48h timelock) | Pending |
| ~16.04.2026 | Submit Proposal B | Pending |
| ~18.04.2026 | Execute Proposal B | Pending |
| ~18.04.2026 | Buyback system fully live | Pending |
