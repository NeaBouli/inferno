# LendingVault Price Policy - 2026-07-08

Status: policy decision pending. Governance package is technically prepared, but should not be submitted blindly.

## Current Mainnet State

- LendingVault: `0x974305Ab0EC905172e697271C3d7d385194EB9DF`
- `ifrPriceWei`: `0`
- Borrowing: disabled by contract until `ifrPriceWei > 0`
- Active offers: `3`
- Total available: `52,155,440.952845656 IFR`
- Total lent: `0 IFR`
- Current dry-run proposal ID: `17`
- Safe Transaction Builder JSON: `/tmp/inferno/lending-price-safe-tx.json`

Latest Uniswap V2 spot read:

- Pair: `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`
- IFR reserve: `18,020,208.679814493 IFR`
- WETH reserve: `0.16725454417891158 ETH`
- Spot-derived `ifrPriceWei`: `9281498741`

## What `ifrPriceWei` Controls

`ifrPriceWei` is wei per 1 full IFR token (`1e9` base units).

The vault uses it to calculate ETH collateral for borrowers:

```text
requiredCollateral = ifrAmount * ifrPriceWei * 200% / 1e9
```

If `ifrPriceWei` is too low, borrowers can borrow IFR with too little ETH collateral. That is bad for lenders.

If `ifrPriceWei` is too high, borrowers need more ETH collateral. That is conservative for lenders, but can make borrowing unattractive and can affect health/liquidation math after loans exist.

## Recommended Policy

Do not activate borrowing from the current thin-pool spot price as an automatic production policy.

Recommended gate before Safe submission:

1. WETH reserve should be materially deeper than today, preferably at least `1 ETH`.
2. Governance should explicitly choose either:
   - a manually reviewed price, or
   - a TWAP/oracle-based price path.
3. No haircut below spot should be used for initial borrowing, because a lower price reduces required borrower collateral.

## If A Small Pilot Is Explicitly Approved

If governance wants to run a controlled pilot before deeper liquidity, use the existing Safe JSON only as a reviewed governance action.

Pilot guidance:

- Use no haircut below spot.
- Prefer a manually reviewed value at or above the current spot-derived value.
- Keep borrower UX warnings visible until liquidity is deeper.
- Monitor every loan after activation.
- Be ready to update `ifrPriceWei` again through Governance if liquidity or price changes materially.

Current generated value:

```text
ifrPriceWei = 9281498741
```

Collateral preview at 200%:

```text
1,000 IFR      -> 0.000018562997482 ETH
10,000 IFR     -> 0.00018562997482 ETH
1,000,000 IFR  -> 0.018562997482 ETH
```

## Safe/Governance Flow

1. Review and approve final price policy.
2. Generate Safe JSON:

```bash
node scripts/prepare-lending-price-governance.js --write-safe-json
```

3. Import `/tmp/inferno/lending-price-safe-tx.json` into TreasurySafe.
4. Submit `Governance.propose(LendingVault, setIFRPrice(candidate))`.
5. Wait 48 hours.
6. Execute proposal.
7. Verify:

```text
LendingVault.ifrPriceWei() == selected price
```

## Current Decision

The safe default is to keep borrowing disabled until liquidity is deeper or governance explicitly accepts a pilot price.
