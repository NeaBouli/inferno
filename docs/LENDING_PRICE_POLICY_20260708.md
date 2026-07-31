# LendingVault Price Policy - 2026-07-08

Status: safety review completed 2026-07-31. Keep V1 borrowing disabled; do
not submit the prepared Governance package.

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

Read-only recheck 2026-07-31 11:34 EEST:

- `ifrPriceWei`: `0`
- Active offers: `3`
- Total available: `52,155,440.952845656 IFR`
- Total lent: `0 IFR`
- WETH reserve: `0.185153585219916653 ETH`
- IFR reserve: `16,282,990.808786243 IFR`
- Spot-derived `ifrPriceWei`: `11370981375`
- Spot change from the previous documented read: approximately `+22.51%`
- Collateral required to borrow all currently available IFR at 200%:
  approximately `1.1861 ETH`

Ownership, 48-hour timelock, `setIFRPrice` simulation and Governance
`propose` simulation all passed. No transaction was sent.

## What `ifrPriceWei` Controls

`ifrPriceWei` is wei per 1 full IFR token (`1e9` base units).

The vault uses it to calculate ETH collateral for borrowers:

```text
requiredCollateral = ifrAmount * ifrPriceWei * 200% / 1e9
```

If `ifrPriceWei` is too low, borrowers can borrow IFR with too little ETH collateral. That is bad for lenders.

If `ifrPriceWei` is too high, borrowers need more ETH collateral. That is conservative for lenders, but can make borrowing unattractive and can affect health/liquidation math after loans exist.

## V1 Safety Findings

The deployed V1 cannot support a genuinely bounded pilot:

1. `setIFRPrice(0)` reverts, so borrowing cannot be disabled again through the
   price after the first non-zero activation.
2. One global mutable price applies immediately to all active loans. A price
   increase can reduce every collateral ratio and trigger liquidation.
3. The contract has no oracle timestamp or stale-price check.
4. The contract has no protocol-wide borrow cap, per-offer pilot cap,
   borrower allowlist or emergency pause.
5. The current spot source is a thin Uniswap V2 pool. Its WETH reserve remains
   far below the existing `1 ETH` minimum-depth recommendation.

## Recommended Policy

Keep deployed V1 borrowing disabled with `ifrPriceWei = 0`. Do not import or
submit `/tmp/inferno/lending-price-safe-tx.json`.

Before production borrowing, build and audit a V2 lending path with:

- an explicit pause/disable mechanism;
- a manipulation-resistant oracle or TWAP with freshness bounds;
- protocol-wide and per-borrower pilot caps;
- price-change safeguards for active loans;
- monitored liquidation discovery and alerting;
- deeper market liquidity, preferably at least `1 ETH` WETH reserve before a
  production price is considered.

Current read-only collateral preview at the spot-derived candidate:

```text
1,000 IFR      -> 0.00002274196275 ETH
10,000 IFR     -> 0.0002274196275 ETH
1,000,000 IFR  -> 0.02274196275 ETH
```

## Safe/Governance Flow

The current script, calldata and Safe JSON target deployed V1. They are
reference material only and must not be submitted or reused for V2.

Any V2 activation needs a separate reviewed runbook and dedicated tooling
that use the audited V2 address and interface. That future flow must include:

1. completed V2 implementation, audit and contract tests;
2. a reviewed price and oracle policy;
3. action-specific Governance authorization;
4. newly generated V2 calldata and independent simulation;
5. the full timelock, execution and postcondition checks for the V2 contract.

## Current Decision

Deployed V1 borrowing remains disabled. The current Safe JSON is not approved
for submission. Reconsider only after a bounded, pausable and oracle-safe V2
path is implemented and audited.
