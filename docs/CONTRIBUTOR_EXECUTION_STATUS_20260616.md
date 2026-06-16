# Contributor Execution Status — 16.06.2026

## Summary
- Status time: 2026-06-16T19:43:31Z
- Bootstrap: finalised
- Contributors: claimed, not yet locked, no LendingVault offers
- Next dependency: contributors buy IFR on Uniswap, then run lock + lending flow
- Recommended split after buy: `LOCK_BPS=5000`, then `LENDING_BPS=5000`

## Uniswap Pool
- LP Token: `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`
- Pool ETH: `0.083261656128757442`
- Pool IFR: `36128594.451082089`
- Buy URL: `https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- Slippage: 15%+ for contributor buys

## Contributor Wallets
| Contributor | Address | ETH | IFR | Locked | Tranches | Commitment Allowance | Lending Allowance | Lending Offer |
|---|---|---:|---:|---:|---:|---:|---:|---|
| C1 | `0x4f632748460E5277bF8435259cADce440AbAC254` | `0.001055298994466727` | `33333333.333333333` | `0.0` | 0 | `0.0` | `0.0` | false |
| C2 | `0x80fF32c5441cBCbFa5c3ce0dC70359BDD05B6958` | `0.004243668025184632` | `33333333.333333333` | `0.0` | 0 | `0.0` | `0.0` | false |
| C3 | `0xf556cCe85128c93AC6A7e088cF334180F2D3905B` | `0.004617965521402287` | `33333333.333333333` | `0.0` | 0 | `0.0` | `0.0` | false |

## Dry-run Verification
All three contributors were checked with:

```bash
node scripts/check-contributors-execution.js
CONTRIBUTOR_ADDR=0x... LOCK_BPS=5000 DRY_RUN=true node scripts/contributors-lock.js
CONTRIBUTOR_ADDR=0x... DRY_RUN=true node scripts/contributors-lending-offer.js
```

Current dry-run result before additional buys:
- Lock amount per contributor at `LOCK_BPS=5000`: `16666666.666666666` IFR
- Lock tranches per contributor: 10
- Tranche 1-9: `1666666.666666666` IFR
- Tranche 10: `1666666.666666672` IFR
- Lending offer amount per contributor at `LENDING_BPS=5000`: `16666666.666666666` IFR
- LendingVault totalAvailable: `0.0` IFR
- LendingVault totalLent: `0.0` IFR
- LendingVault interest rate: `200` bps/month

After the Uniswap buys, rerun the dry-runs because balances and tranche amounts will change.

## Execution Order After Buys
1. Contributors buy IFR on Uniswap.
2. Verify each wallet balance:
   ```bash
   CONTRIBUTOR_ADDR=0x... LOCK_BPS=5000 DRY_RUN=true node scripts/contributors-lock.js
   CONTRIBUTOR_ADDR=0x... DRY_RUN=true node scripts/contributors-lending-offer.js
   ```
3. Lock 50%:
   ```bash
   CONTRIBUTOR_ADDR=0x... PRIVATE_KEY=0x... DRY_RUN=false MAINNET=true LOCK_BPS=5000 node scripts/contributors-lock.js
   ```
4. Create LendingVault offer with remaining 50%:
   ```bash
   CONTRIBUTOR_ADDR=0x... PRIVATE_KEY=0x... DRY_RUN=false MAINNET=true node scripts/contributors-lending-offer.js
   ```

## Important
Do not run `LOCK_BPS=10000` if the same wallet should also create a LendingVault offer.
