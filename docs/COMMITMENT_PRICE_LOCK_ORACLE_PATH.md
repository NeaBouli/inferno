# CommitmentVault Price-Lock Oracle Path

Status: design decision needed before enabling price-based locks.

## Current Mainnet Reality

The deployed `CommitmentVault` exposes:

- `setPriceOracle(address)`
- `priceOracle()`
- price-based condition types:
  - `PRICE_ONLY`
  - `TIME_OR_PRICE`
  - `TIME_AND_PRICE`

However, the deployed source still has `_getCurrentPrice()` returning `0`:

```solidity
function _getCurrentPrice() internal view returns (uint256) {
    if (priceOracle == address(0)) return 0;
    // Phase 2: call oracle interface
    // return IUniswapTWAP(priceOracle).consult(address(ifrToken), 1e9);
    return 0;
}
```

Therefore setting `priceOracle` to any address is not enough. Price conditions will continue to evaluate as false because the vault never calls the oracle.

## Safe Live Policy

- Keep using `TIME_ONLY` CommitmentVault locks on Mainnet.
- Benefits Network rules may read active, non-unlocked `TIME_ONLY` tranches as an access source.
  This does not activate any price-conditioned lock: `PRICE_ONLY`, `TIME_OR_PRICE` and
  `TIME_AND_PRICE` remain excluded from customer eligibility.
- Do not expose price-only, time-or-price, or time-and-price locks as executable Web3 defaults.
- Do not submit a governance proposal that only calls `setPriceOracle(address)` and claims price locks are live.

## Correct Activation Options

### Option A - CommitmentVaultV2

Deploy a new vault implementation with a real oracle interface:

```solidity
interface IIFRPriceOracle {
    function consult(address token, uint256 amountIn) external view returns (uint256 priceWei);
}
```

Then `_getCurrentPrice()` should call the oracle and return wei per `1e9` IFR base units. New price-condition locks would go to the new vault. Old time-only locks stay in the current vault.

Pros:

- Clean contract semantics.
- Existing locks are not disturbed.
- Web3 can route time-only locks to old vault and price locks to V2.

Cons:

- New deployment and governance documentation required.
- UX must show two vault contexts during migration.

### Option B - Dedicated PriceLockVault

Deploy a narrower contract only for price-conditioned locks. Keep the current `CommitmentVault` as the time-lock vault.

Pros:

- Smaller new code surface.
- Clear UX: "time lock" vs "price lock".

Cons:

- Another address and docs surface.
- Less elegant naming than a full V2.

### Option C - Do Nothing For Now

Keep price-locks deferred until IFR has deeper liquidity and a mature oracle/TWAP policy.

Pros:

- Lowest immediate risk.
- Avoids thin-pool price manipulation.

Cons:

- Web3 must keep price-lock UI disabled or hidden.

## Oracle Requirements

Before any price-lock activation:

1. Decide whether spot, TWAP, or manually governed price is acceptable.
2. Use a manipulation-resistant source. A very thin Uniswap V2 pool is not enough by itself.
3. Test edge cases:
   - zero reserves
   - stale observations
   - token order in pair
   - decimal scaling to wei per `1e9` IFR
   - price drops below target after `conditionMetAt`
4. Add dedicated tests for all condition types.
5. Document exact Governance proposal and verification flow.

## Recommended Next Step

Do not set `priceOracle` on the current vault as a final solution. Build a small `CommitmentVaultV2` or `PriceLockVault` proof with tests first, then decide whether Mainnet price-condition locks are worth activating before liquidity deepens.
