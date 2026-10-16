# BuybackVault Redeployment Specification

**Status:** proposed requirements for Council review, 17 October 2026. No
contract changes, deployment, funding, swap, exemption or activation authorized.

## Scope and evidence boundary

Gio authorized a BuybackVault redeploy specification alongside Governance V2.
This document addresses CWA-26/W3, JUL-08 and CWA-19, with CWA-16 two-step
ownership and JUL-21 build provenance. Numeric tightening and new readiness
controls below are design recommendations for Council approval.

Read with the [Governance specification](GOVERNANCE_V2_SPEC.md),
[migration plan](../GOVERNANCE_MIGRATION_PLAN.md),
[CWA register](../community-audits/cwa-remediation-register.json),
[July register](../community-audits/july-2026-remediation-register.json),
[source](../../contracts/buyback/BuybackVault.sol), and
[deployment record](../DEPLOYMENTS.md).
The evidence limitations in the Governance specification apply here: there is
no fresh chain-state attestation from this writing session.

The recorded existing vault is
`0x670D293e3D65f96171c10DdC8d88B96b0570F812`. Its bytecode predates W3 bounds
and JUL-08 fee-on-transfer accounting. Repository HEAD already has basis-point
and nonzero-address checks, a supporting-fee-on-transfer swap, received-balance
accounting and recipient-credit events. HEAD still permits unbounded cooldown
and 100% slippage, and has single-step ownership and an immutable pause guardian.
Copying HEAD alone does not meet this specification.

BuybackController is a different contract with a buyback/LP split. Its recorded
address `0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c` remains the IFR pool-fee
receiver under Proposal #21. IFR fees arriving there do not convert themselves
into ETH for this vault. Migrating its owner to Governance V2 does not upgrade
its swaps, guardian or accounting. No Controller execution, replacement or
automatic fee redirection is authorized here.

## Ownership, roles and interfaces

The new vault must implement [contract standards](../CONTRACT_STANDARDS.md),
including explicit initial ownership, `pendingOwner`, nomination, acceptance,
nomination cancellation and events. Initial owner is the approved Treasury Safe;
it nominates G2, which accepts by an ordinary delayed G2 proposal. There is no
renunciation, arbitrary immediate sweep or generic external-call facility.

Proposed operational roles, requiring Council approval:

- Owner: G2 after acceptance; all configuration, activation, spending and
  unpause actions go through its delay and expiry.
- Pause guardian: Treasury Safe, with immediate pause only. Resume is a delayed
  owner action. Owner-controlled guardian replacement is timelocked and emits
  old/new addresses; do not make this role permanently immutable again.
- The new 2-of-3 Guardian Safe only cancels Governance proposals. Do not assign
  it the vault's pause role, ownership or asset custody.

Retain a bounded `setParams(burnShareBps, cooldown, slippageBps, router, treasury)`
or equivalent explicitly documented setters. Add a separate activation state and
an execution interface with a fixed ETH amount, minimum net IFR received and
deadline, for example `executeBuyback(ethAmount, minReceived, deadline)`.
This is an ABI sketch only; implementation and integration changes are deferred.

## Bounded configuration (W3 / CWA-26)

The same validation must apply to constructor defaults and every setter;
reject the complete update atomically if any field is invalid.

| Parameter | Proposed hard constraint | Initial recommendation |
| --- | --- | --- |
| `burnShareBps` | `0 <= value <= 10_000`; economic changes need an explicit Council decision | 5,000, preserving the existing nominal 50/50 split |
| `cooldown` | 1 hour through 7 days inclusive | 1 hour |
| `slippageBps` | 0 through 1,000 inclusive; 10,000 is forbidden | 500; this is a ceiling, not evidence that 5% is safe |
| Router | Nonzero deployed contract in a constructor-fixed, independently reviewed router allowlist; verify canonical WETH/factory/pair identity | Approved Uniswap V2 Router02 identity; pin exact address and code in the future manifest |
| Treasury | Nonzero approved recipient, distinct from vault, token, router and BurnReserve | Treasury Safe, after fresh identity checks |
| IFR / BurnReserve | Nonzero, distinct, constructor-fixed validated contracts | Existing IFR and BurnReserve; no asset replacement |
| Activation delay | Immutable minimum 60 days from deployment, recommended retention | 60 days; passage of time alone never activates |
| Spend limit | Nonzero immutable per-transaction ETH ceiling plus a bounded rolling budget | Exact amounts require liquidity analysis and Council approval |

The router allowlist cannot be enlarged by an unbounded owner setter. A different
router implementation requires a reviewed replacement or a separately specified
bounded authorization mechanism. `code.length`, a successful quote or a matching
WETH getter alone is insufficient. Treasury replacement must name the recipient
and custody evidence in the timelocked proposal.

Readiness thresholds must also be bounded: an owner cannot set zero depth,
disable freshness, choose unlimited spending or set a zero protection floor to
bypass readiness. Exact depth, oracle-age/window and rolling-budget limits are
unresolved activation blockers, not permission to invent production values.

Emit parameter events containing every old/new value, including router and
treasury. The current `ParamsUpdated` omits those addresses. Emit ownership,
guardian, pause, unpause, activation/deactivation and funded/executed amounts.
No silent address mutation is acceptable.

## Swap and split accounting (JUL-08)

1. Owner execution requires active, unpaused, activation time reached, cooldown
   elapsed, sufficient ETH, unexpired deadline, readiness and budget checks.
   Spend only the ETH amount encoded in the queued proposal, never an expanded
   balance that arrived after queuing. Reject zero amount and zero minimum out.
2. Snapshot the vault IFR balance immediately before the swap. Call
   `swapExactETHForTokensSupportingFeeOnTransferTokens` with the validated
   WETH-to-IFR path and the vault as recipient. Do not use a router-returned
   amounts array as proof of receipt.
3. `received = balanceAfter - balanceBefore` in integer base units. Require the
   actual net receipt to meet both the proposal's `minReceived` and the
   independent on-chain price-protection floor. A gross router quote is not a
   net-receipt guarantee. Checked underflow or an inadequate net receipt reverts.
4. `burnDebit = received * burnShareBps / 10_000`, rounded down;
   `treasuryDebit = received - burnDebit`. Split only this swap's receipt;
   donated or previously held IFR must not silently enter the distribution.
5. Measure each recipient's before/after balance separately around its transfer.
   Record the actual credited amounts. A transfer to BurnReserve increases its
   held balance; it is not a call to `burn` and must not be reported as a supply
   burn. Any transfer-tax burn is a separate token effect.
6. A failed swap, transfer, balance read, readiness check or minimum-credit check
   reverts the entire operation, including cooldown, budget and activation-related
   execution counters. No partially distributed success event is allowed.

Use IFR's nine decimals and Solidity integer arithmetic; JavaScript tests and
proposal tooling use `bigint`. Test the real InfernoToken both with and without
sender/recipient exemptions, and with nonzero burn and pool fees. A supporting
swap may legitimately revert when gross-quote slippage fails to accommodate the
transfer tax; never fix that by dropping the net minimum to zero.

An execution event must include ETH spent, IFR actually received, nominal split
debits, recipient credits, recipient identities and an execution identifier.
These values must be sufficient to reconcile token balances and transfer-tax
effects. Zero-value split legs must not create false credited-amount claims.

## Reentrancy, ERC-20 returns and MEV (CWA-19)

Apply a reentrancy guard and checks-effects-interactions to spending and any
future asset-recovery entry point. Update cooldown/budget state before external
interaction, with full rollback on failure. Test malicious router callbacks and
token callbacks, including attempts to reenter execution, configuration and
asset recovery. Owner-only execution or a positive cooldown is not a substitute.

The historical CWA-19 text is not an exact inventory of today's HEAD:
BuybackController source already inherits `ReentrancyGuard` and checks the
`withdrawIFR` transfer return. Those source observations do not establish deployed
bytecode remediation and do not remove the replacement's adversarial-test gate.

Use a pinned, reviewed SafeERC20-style wrapper: reject `false` and malformed
returns, permit a successful no-return ERC-20 when intended, and propagate
transfer failures. The present IFR implementation returns a boolean, but that
does not justify unchecked generic return handling. This ETH-input swap needs
no IFR router approval; do not add unlimited approval. Any future approval path
needs exact limits, reset behavior and its own tests.

A same-transaction `getAmountsOut` quote and `deadline = block.timestamp` do not
protect against a manipulated pool or a sandwich. Before activation, specify
and independently review an on-chain price reference independent of that spot
quote, freshness/deviation checks, minimum WETH depth, the trade/budget caps and
net-of-tax protection. Sharing the Lane 2 TWAP design is an option, not a
ratified buyback oracle. Thin liquidity or unavailable/stale observations must
fail closed. A private transaction relay can supplement, but cannot replace,
these contract conditions; G2 execution is permissionless.

For a queued buyback, deadline must be after its proposal ETA and no later than
proposal expiry, with a Council-approved shorter execution window. If market
conditions or the window change, cancel/re-propose and wait a fresh delay.
Never loosen bounds during execution to make a stale proposal succeed.

No general recovery function is approved in this specification. If needed for
future operations, separately specify allowed assets, fixed governance-only
destination, amount caps, events, pause prerequisites and timelock. In
particular, do not infer a recovery function on the deployed old vault.

## Activation gate

Deployment and two-step ownership acceptance leave the vault inactive. The
60-day clock is only one necessary condition. No one may fund it for operation
or queue a buyback until all gates below have evidence and separate approval.
This funding hold is an operational rule: unsolicited or forced ETH/IFR can
still arrive. Receiving assets must never activate the vault or bypass its
inactive, ownership, readiness or spending checks.

1. Council approves implementation scope, all hard limits, recipients, the
   funding source, economic split and guardian role separation.
2. Independent review covers W3, JUL-08, CWA-19, Ownable2Step, the oracle/MEV
   design and migration. Archive exact build metadata and matching deployed
   bytecode as specified under JUL-21 in the migration plan.
3. Passing unit/fuzz/adversarial tests and a pinned mainnet-fork rehearsal;
   Sepolia evidence includes taxed transfers, independent G2 execution,
   cancellation, inactivity, pause and resumption.
4. Read-only checks confirm G2 ownership, no stale pending owner, correct token,
   router, BurnReserve, treasury, pause guardian, activation time, hard limits
   and current fee exemptions. Any exemption is a separate timelocked token
   proposal, never an implicit consequence of redeployment.
5. Current liquidity, oracle observations/freshness, funding and budget evidence
   satisfy the approved thresholds. The old vault and Controller are not used
   as a supposedly upgraded fallback.
6. Council separately approves an exact `activate` proposal through G2. It waits
   the full G2 delay and must re-check readiness on-chain at execution. Each
   buyback also re-checks readiness; activation cannot freeze a once-good quote.
7. Funding and a bounded first buyback require their own exact authorization,
   post-transaction balance/event reconciliation and monitoring. A failed gate
   leaves the vault inactive/unfunded or paused, with no permission to bypass it.

## Verification plan and unresolved decisions

- Boundary-test every configuration field at minimum, maximum and one outside;
  reject zero/codeless/unapproved router, recipient collisions and invalid defaults.
- Verify two-step nomination/accept/cancel/replace, stale candidates, forbidden
  renunciation and direct unauthorized configuration; verify all events.
- Test activation minus one/exactly, pre-activation funding attempts as an
  operational refusal, inactive execution, cooldown boundaries, budgets,
  pause/unpause authorities, expired deadlines and readiness deterioration.
- Test taxed input/output behavior with real IFR, exemptions independently
  toggled, donations, tiny amounts/rounding, zero split legs, false/no-return
  tokens, failed recipient transfers and reentrant router/token mocks.
- Verify actual receipt and recipient-credit events against balances; confirm
  that a BurnReserve deposit does not increment its `totalBurned`.
- Test manipulation, stale/zero-depth observations, excessive trade size and
  honest/miner-reordered permissionless G2 execution. Every failure is atomic.
- Rehearse replacement without invoking old-vault swaps or Controller execute.
  Old-vault nonzero residual assets block a claimed complete funds migration.

Council must choose the price reference and bounds, spend/rolling-budget limits,
execution window, funding policy, exemption policy and pause-guardian assignment;
ratify the proposed stricter `setParams` ranges and activation delay; and decide
whether a separately scoped recovery path is required. No activation date is
promised by this planning document.
