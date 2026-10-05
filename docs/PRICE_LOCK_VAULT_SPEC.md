# PriceLockVault Specification (Lane 2)

**Status:** built, tested and independently reviewed (second review T-256; its LOW finding, the concurrent lock cap,
is fixed in `main`). Not deployed and not active. Price locks stay disabled until a Sepolia rehearsal is done, the
on-chain readiness scope is met and Governance activates them.

## Purpose

PriceLockVault lets a wallet lock IFR until a price target is reached. It is a separate contract.
CommitmentVault V1 and V2 are not changed.

It applies the lessons from CV-01:

- A price condition is evaluated from a time-weighted average price (TWAP), never from the spot price.
- Every lock has a mandatory rescue time (`maxUnlockTime`, at most 4 years after locking). After it the locker
  can always unlock, whatever the price.
- No one, including Governance, can withdraw user funds. Tokens always return to the wallet that locked them.

## Module and Hop

- **Module:** `contracts/vault/PriceLockVault.sol` (new). It reads the IFR/WETH Uniswap V2 pair
  `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0` and does not write to it.
- **Pair identity.** The pair is never passed in. The constructor takes the canonical WETH and the Uniswap V2
  factory, reads `factory.getPair(IFR, WETH)` and requires the pair's two tokens to be exactly IFR and WETH.
  On Mainnet the deploy script pins WETH9 `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`, the factory
  `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` and the expected pair, and refuses any override. Other
  networks must name their canonical WETH and factory explicitly.
- **Hops:** user to vault (lock, unlock); keeper or user to vault (`poke`, which records a price observation);
  Governance to vault (activate, deactivate, thresholds, TWAP window).

## Price Source

- **Observations.** Uniswap V2 cumulative prices (`price0CumulativeLast` / `price1CumulativeLast`). The vault
  stores observations in a 32-slot ring buffer. A new observation is recorded at most once per `twapWindow / 16`.
  Anyone can record one with `poke()`; `lock` and `unlock` also record one.
- **TWAP.** `(cumulativeNow − cumulativeObs) / elapsed`, using the newest observation at least `twapWindow` old.
  The current cumulative includes the counterfactual accrual since the pair's last update, as in Uniswap's
  oracle library.
- **Stale or missing data.** If no observation is between `twapWindow` and `2 × twapWindow` old, or the
  pair's reserves are zero, the TWAP is invalid and price conditions cannot be met.
- **Token order and units.** Both token orders are handled. The price is quoted in wei per 1 IFR (`10^9` raw
  units), the same unit as CommitmentVault's P0.
- **Manipulation.** A swap and its reversal inside one block do not move the cumulative price, so they cannot
  trigger an unlock.
- **Window.** `twapWindow` defaults to 7 days. Governance can change it only within 1 to 30 days.

## Readiness Scope

Price locks are rejected (`"price locks not active"`) until `activate()` succeeds. After activation, **every new
lock checks the same scope again** and reverts (`"readiness scope not met"`) when it does not hold, for example
after liquidity was withdrawn. Existing locks keep both unlock paths.

`activate()` is owner-only (Governance with its 48-hour timelock) and checks on-chain at call time:

| Threshold | Condition |
| --- | --- |
| `minWethReserve` | the lower of the current pool WETH reserve and the reserve at the TWAP observation must be at least this value |
| `minActivationPrice` | the TWAP must be valid and at least this value |

A threshold of zero is not required; at least one must be non-zero. `readiness()` returns current values
against both thresholds, so the website can show progress.

`deactivate()` stops new locks only. It never affects existing locks.

### Recommended Starting Values

Chain state at block 26,110,650 (2026-10-03):

- the pair holds 18,740,426.21 IFR and 0.3035 WETH;
- spot price is about 16.19 gwei per IFR (P0 = 0.3 gwei).

| Parameter | Recommendation | Reason |
| --- | --- | --- |
| `minWethReserve` | 50 ETH | about 165 times today's depth; deeper pools make a sustained TWAP move more expensive |
| `minActivationPrice` | 0 (not required) | depth, not price, is the main defence of a TWAP |
| `twapWindow` | 7 days | matches the CV-01 compensation rule |

No quantified manipulation cost is claimed: it depends on arbitrage activity and liquidity behaviour that this
specification does not model.

### Known Limit: Depth Is Sampled at Two Points

The depth condition reads the pool WETH reserve at two moments only: when the TWAP observation was recorded and
now. It does not prove that the reserve stayed at or above `minWethReserve` for the whole TWAP window. Liquidity
could be withdrawn between the two samples and returned before the second one, and a price could be pushed
during that thin interval. Re-checking readiness on every lock and recording observations frequently
(`poke()` at least every `twapWindow / 16`) narrow this, but do not remove it.

Activation with this limit is the approved scope (built, disabled until the readiness scope holds, activated by
Governance). A stronger prerequisite — for example the minimum reserve over every stored observation in the
window, or an independent second price source — would change that scope and needs a separate owner decision.

## Locks

- **Lock.** `lock(amount, targetPriceWei, earliestTime, maxUnlockTime)`:
  - `targetPriceWei > 0`;
  - `maxUnlockTime` between 1 day and 4 years from now;
  - optional `earliestTime` no later than `maxUnlockTime`;
  - at most 50 active (not yet unlocked) locks per wallet; unlocked locks free their slot.
- **Accounting.** The amount is the credited balance difference, so a fee-on-transfer deposit is recorded
  at what the vault actually received.
- **Unlock.** The locker may unlock:
  - after `maxUnlockTime` (rescue), regardless of price or activation state. This path makes no pair or oracle
    call, so a paused, broken or reverting pair cannot block it; or
  - when `earliestTime` has passed and the valid TWAP is at or above `targetPriceWei`. This path fails closed
    if the pair cannot be read.

## Fee Exemption

InfernoToken taxes transfers between non-exempt addresses. Until a separate Governance proposal makes the vault
fee-exempt, a lock is credited with the received amount and an unlock pays the transfer tax again.

## Deployment Path (step 1 done)

1. Independent security review of the contract and this specification, including the slices changed after the
   first review (per-lock readiness, oracle-free rescue, factory-bound pair). **Done:** second review T-256.
2. Sepolia rehearsal: deploy, poke over a full window, activate, lock, unlock by price and by rescue.
3. Mainnet deployment with Governance as owner (`scripts/deploy-price-lock-vault.js` refuses Mainnet unless
   `ALLOW_MAINNET_PRICE_LOCK_DEPLOY=yes`).
4. Governance proposal: `InfernoToken.setFeeExempt(vault, true)`.
5. Keepers record observations; the website shows `readiness()`.
6. When the scope is met: Governance proposal `activate()`; it reverts on-chain if the scope is not met at
   execution time.
