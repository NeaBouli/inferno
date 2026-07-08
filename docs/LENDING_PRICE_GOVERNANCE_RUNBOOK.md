# LendingVault ifrPriceWei Governance Runbook

Status: preparation only. Do not submit or execute on-chain transactions without multisig review.

## Why This Is Needed

Web3 and Wiki borrower flows are wired to `LendingVault.borrow(offerId, amount, durationDays)`.
The contract correctly blocks borrowing until `LendingVault.ifrPriceWei()` is greater than zero,
because ETH collateral is calculated from that value.

`ifrPriceWei` means wei per 1 full IFR token (`1e9` base units).
Example: if `1 IFR = 0.000001 ETH`, then `ifrPriceWei = 1000000000000`.

## Contracts

- IFR Token: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- LendingVault: `0x974305Ab0EC905172e697271C3d7d385194EB9DF`
- Governance: `0xc43d48E7FDA576C5022d0670B652A622E8caD041`
- TreasurySafe: `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`
- IFR/WETH Pair: `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`

## Dry Run

Run the script before creating any Safe transaction:

```bash
node scripts/prepare-lending-price-governance.js
```

The script:

- reads `LendingVault.owner()` and verifies it is Governance
- reads `Governance.owner()` and verifies it is TreasurySafe
- reads `Governance.delay()` and next `proposalCount()`
- reads current `ifrPriceWei`, LendingVault offers and liquidity totals
- reads IFR/WETH Uniswap V2 reserves
- derives a candidate `ifrPriceWei`
- previews 200% ETH collateral for sample IFR borrow amounts
- simulates `LendingVault.setIFRPrice(candidate)` as an `eth_call` from Governance
- simulates `Governance.propose(LendingVault, calldata)` as an `eth_call` from TreasurySafe
- prints Safe Transaction Builder JSON

No transaction is sent.

## Manual Price Override

Use a manually reviewed price when the Uniswap pool is too thin:

```bash
PRICE_SOURCE=manual IFR_PRICE_WEI=123456789 node scripts/prepare-lending-price-governance.js
```

The script defaults to the Uniswap V2 spot price. Because the IFR/WETH pool is still thin,
the printed spot value is an input for review, not an automatic final policy decision.

Optional haircut for spot-derived value:

```bash
PRICE_SOURCE=spot PRICE_HAIRCUT_BPS=9000 node scripts/prepare-lending-price-governance.js
```

## Safe JSON File

To write the Safe Transaction Builder payload locally:

```bash
node scripts/prepare-lending-price-governance.js --write-safe-json
```

Output:

```text
/tmp/inferno/lending-price-safe-tx.json
```

Import that JSON into the TreasurySafe Transaction Builder only after the printed checks pass
and the price policy has been reviewed.

## Governance Flow

1. Run dry run and review all output.
2. If accepted, submit the Safe transaction to call:
   - `Governance.propose(LendingVault, setIFRPrice(candidate))`
3. Collect required TreasurySafe signatures.
4. Wait for the Governance timelock.
5. Execute the queued proposal through TreasurySafe:
   - `Governance.execute(proposalId)`
6. Verify:
   - `LendingVault.ifrPriceWei() == candidate`
   - Web3 Borrow modal no longer shows `Price not set`
   - Wiki LendingVault Borrower tab enables borrow after offer/amount/duration selection

## Safety Notes

- Do not call `LendingVault.setIFRPrice` directly from an EOA. It must be executed by Governance.
- Do not use a stale or manipulated thin-pool spot price without review.
- Do not submit a Safe transaction if ownership checks fail.
- Borrower transactions remain disabled by design until this proposal executes.
