# LendingVault V2 Borrowing Specification

**Status:** Release candidate - ready, not activated. Ratified 2026-10-18.
Built and tested locally; not deployed as this release candidate and not externally
audited. Activation requires a Governance vote and Treasury Safe signer approval.
Existing deployed versions and custody remain unchanged.

## Remaining before activation

- Governance proposal for the exact release, wiring and activation scope.
- Treasury Safe signer approval; independently verify owner/guardian identities and thresholds.
- Reviewed constructor arguments, build hashes and the applicable evidence gates below.
- External audit: pending funding, deferred until the token has a stable price and
  funding is available. Disclose this deferral in the proposal; never claim audited.

Follow [V2_ACTIVATION_RUNBOOK.md](../V2_ACTIVATION_RUNBOOK.md). Source readiness is
not activation authorization or evidence of a live deployment.

## Authority, scope and recommendation

Gio's 18 October 2026 decision ratifies the implementation defaults and local
release preparation, following the earlier design instruction in
[decision-register lane 1](../GOVERNANCE_PRODUCT_DECISION_REGISTER.md#lane-1--lendingvault-oracleborrow-activation-and-overdue-loans).
V1 remains retired. No deployment, funding or activation transaction is authorized.
**Ownable2Step for every admin role is mandatory owner policy**.

**Recommendation:** develop a separately deployed, capped, non-recourse term
loan design using a bounded Uniswap V2 TWAP shared with the future price-lock
design. Keep borrowing disabled until depth, observation coverage and economic
attack analysis pass. Repayment returns collateral through pull credits;
liquidation requires IFR repayment; a fixed maturity and disclosed ETH default
settlement prevent indefinitely trapped loans. Do not activate V1, use a spot
price, or silently fall back to a manual price. If a defensible oracle cannot
be established, defer market-priced borrowing. A no-price fixed-ratio product
would require its own explicit lender-risk approval (LV-C01).

The conservative numerical defaults are **ratified 2026-10-18** as implemented.
They do not establish market safety: the production oracle adapter, economic
evidence and exact deployment configuration remain activation prerequisites.

## Evidence and V1 boundary

Reviewed repository revision: `9c0f5352c31cf4c7db595ac444a8464db3125b88`.

| Input | Evidence relevant to V2 |
| --- | --- |
| [LendingVault source](../../contracts/vault/LendingVault.sol) | IFR is borrowed against ETH; `setIFRPrice` accepts only positive values; no pause, freshness or aggregate borrow cap; stored duration never causes expiry. |
| [CWA register](../community-audits/CWA_REMEDIATION_REGISTER.md) | CWA-01 requires bounded fresh pricing and emergency controls; CWA-08 requires fee receiver, collateral-return and expiry decisions. |
| [July register](../community-audits/JULY_2026_REMEDIATION_REGISTER.md) | JUL-03 keeps borrowing disabled until a reviewed V2 path exists. |
| [Known issues](../KNOWN-ISSUES.md#ops-001----lendingvault-v1-borrowing-disabled) | OPS-001 documents the fail-closed price boundary. |
| [V1 lifecycle tests](../../test/LendingVault.test.js) | Fee-receiver validation and interest split; T51 also demonstrates that a rejecting borrower/lender ETH receiver reverts repayment/liquidation. |
| [Existing price-lock specification](../PRICE_LOCK_VAULT_SPEC.md) | Seven-day TWAP candidate, proposed 50 WETH depth, and explicit two-endpoint liquidity-sampling limitation. This is not lending-oracle approval. |

The register records V1 borrowing disabled with `ifrPriceWei = 0` and its
retirement. Those are repository records, not a fresh chain-state attestation.
Explorer retrieval was unavailable during drafting; no current balances,
owners or live parameters are asserted here. Before implementation wiring or
activation, obtain a new block-number/hash-pinned read of deployed bytecode,
owner, price, offers, outstanding loans and token fee exemption.

V1 has neither a zero-price reset nor a pause after a positive price is set.
Its interest uses whole elapsed 30-day periods, at least one period, without
capping accrual at the stored duration. Health ignores interest. V1 liquidation
does not collect IFR: it writes off principal and sends 95% of ETH to the
lender and 5% to the caller. These source behaviors must not become implicit
V2 policy. V1 offers and collateral cannot be swept into a replacement;
lenders withdraw available V1 IFR themselves and explicitly opt into V2.

## Price options

The unit throughout is **wei of ETH per one full IFR**, with one IFR equal to
`10^9` base units. ETH and WETH use `10^18` base units. No USD feed or JavaScript
`number` conversion is needed for this pair.

| Option | Required controls | Principal weakness | Recommendation |
| --- | --- | --- | --- |
| Chainlink IFR/ETH, or IFR/USD divided by ETH/USD | Verify actual official feed/proxy, chain, assets, decimals, heartbeat, positive answer, nonfuture/nonzero update time and consumer age bounds on every leg. | No verified IFR feed was identified in the official catalog research; a feed for another token or only ETH/USD does not price IFR. | Unavailable as an assumed dependency; reassess if a verifiable IFR feed appears. |
| Uniswap V2 cumulative-price TWAP | Proven canonical pair, full observation window, freshness/coverage, minimum depth, price/deviation bounds, exposure caps and pause. | Thin liquidity, LP withdrawal, sustained manipulation and delayed reaction to real IFR appreciation. | Preferred conditional research path, with a shared adapter and separate consumer policies. |
| Manual governed quote | Positive bounded quote with source timestamp, expiry, evidence hash, maximum change and sequence number; no refresh by merely changing publication time. | Governance/key discretion; a 48-hour timelock cannot reliably maintain a one-hour market quote. | Test harness or separately approved restricted pilot only; no automatic fallback. |
| No-price fixed-ratio loans | Lender posts immutable IFR principal/ETH collateral terms, fixed rate, due date and contractual ETH default amount; borrower accepts the exact quote. | No market LTV or price liquidation; borrower can choose default if IFR appreciates; lender bears that option risk. | Technically possible distinct product; not a substitute claiming market collateral safety. |

Research on 17 October 2026 found no confirmed IFR proxy in the
[official Chainlink feed catalog](https://data.chain.link/feeds). This is an
availability assumption, not proof that a feed can never exist. Feed selection
must follow [Chainlink's quality guidance](https://docs.chain.link/docs/selecting-data-feeds)
and [consumer API](https://docs.chain.link/data-feeds/api-reference).

For a manual alternative, the release candidate consumer limit is one hour from the
**source** timestamp, a maximum 10% change from the last accepted quote, and
Council-approved absolute price bounds (LV-C02). A quote whose source time
predates a 48-hour queue would expire before execution. A delegated publisher
would therefore introduce a new privileged role, threat model and approval;
it must also follow the two-step admin standard. Do not lengthen freshness
silently to make a queued quote executable. No direct EOA price setter is
part of the recommended design.

## Shared TWAP contract and consumer validity

This is the ratified adapter interface policy, not deployed functionality. The
adapter returns price, observation start/end, latest observation time,
configuration version, sampled depth/coverage and a validity reason. Reading
must not refresh age. Observation recording is permissionless and has no
authority to write arbitrary prices.

1. Resolve the pair through the canonical factory and prove exact IFR/WETH
   token identities and decimals. Bind factory, pair and token addresses to
   the deployment manifest; reject substitute pairs and incompatible tokens.
2. Use the IFR-to-WETH cumulative direction directly. Calculate the average
   cumulative increment over elapsed seconds, then normalize from UQ112x112
   to wei per `10^9` IFR base units. Do not invert the opposite arithmetic
   average. Handle cumulative and 32-bit timestamp wrap explicitly.
3. Include counterfactual accrual since the pair's last reserve update, as in
   [Uniswap's oracle library](https://github.com/Uniswap/v2-periphery/blob/master/contracts/libraries/UniswapV2OracleLibrary.sol).
   A quiet pair is not automatically stale if genuine observations continue.
4. Ratified lending policy: seven-day slow window; boundary observations at
   most one hour outside the desired window; newest checkpoint no older than
   one hour; no checkpoint gap above one hour across the window. Allocate a
   bounded buffer large enough for that coverage, not the existing candidate's
   32 slots at hourly spacing. Retain needed window endpoints despite public
   checkpoint calls; enforce minimum recording spacing against buffer churn.
   Missing history fails closed.
5. Require at least 50 WETH and a Council-set IFR-side depth floor at every
   stored checkpoint used for coverage and at consumption. Both floors are
   mandatory for lending. Zero reserves, insufficient depth, missing coverage,
   pair reverts or out-of-range price make the result invalid.
6. The ratified fast cumulative window of 30-60 actual elapsed minutes must
   agree with the slow price within 20%; it needs its own retained endpoints
   and a recording cadence of at least every 30 minutes. It is a circuit
   breaker from the same market, not an independent source. Origination uses
   `Pborrow = max(Pslow, Pfast)`; health and liquidation use
   `Phealth = Psettle = min(Pslow, Pfast)` to resist inflated valuations. Invalid
   fast data also blocks those actions. Absolute price bounds are not
   bootstrap P0 and require explicit Council values.
7. Pair, source, window or validity-policy changes produce a new version,
   pause new borrowing and require a complete warm-up before reuse. Existing
   loans bind their adapter/policy version; do not retroactively reprice them
   with a governance-selected replacement. A failed old adapter leaves
   repayment and the contractual expiry route available.

The policy in items 4-6 is ratified; implementation and evidence for the shared
adapter remain open (LV-C02/LV-C03 and PL-C02 in the companion specification).
Even dense checkpoints do not prove minimum
liquidity between checkpoints: flash-added depth can satisfy samples. Test
that attack and require an economic bound or independently verifiable depth
commitment/second source; otherwise the activation gate fails. A seven-day
TWAP alone also lags genuine price jumps and is insufficient proof of timely
liquidation safety. These remain material research gates.

## Manipulation and exposure budget

The task's **17.6 million IFR / 0.39 ETH** pool is a supplied thin-liquidity
scenario, not a newly verified reserve snapshot. Its ideal constant-product
spot quote is about `22,159,090,909` wei per IFR. Ignoring trading fees, token
taxes and arbitrage, a factor-two spot increase takes only
`0.39 * (sqrt(2) - 1)`, about **0.162 ETH**, of WETH input; a factor-two
decrease takes about **7.29 million IFR** of IFR input. These are gross trade
sizes, not unrecoverable attacker cost or TWAP-security estimates.

| Attack or failure | Effect | Required analysis/control |
| --- | --- | --- |
| Flash loan plus spot manipulation | Depress IFR price, obtain too much IFR for posted ETH, unwind and default. | Never value debt from spot; test swap/borrow/reverse in one transaction. |
| Same-block cumulative manipulation | A spike and reversal cannot add elapsed time, but the adapter might accidentally read spot or accept a zero window. | Nonzero completed window, correct cumulative direction, same-block regression. |
| Sustained/multiblock low price | Underprice IFR debt at origination; seven-day averages can still be bought if the market is shallow. | Fork economic sweeps over duration, LP ownership/removal, arbitrage and congestion; independent cost review. |
| Sustained high price | Cause wrongful liquidation; IFR appreciation also legitimately reduces collateral safety. | Full IFR repayment by liquidator, conservative confirmed valuation, capped bonus and borrower surplus; quantify lag/bad debt. |
| Temporary LP additions at checkpoints | Pass sampled depth while manipulating thin intervals. | Explicit adversarial test; samples alone cannot certify continuous depth. |
| Keeper outage or reverting pair | Block new borrowing and price liquidation; risk grows during outage. | Permissionless checkpoints, bounded age, alerts, oracle-independent repayment and maturity settlement. |
| Multiple wallets or offers | Bypass address/offer limits. | Aggregate IFR and committed-ETH exposure caps are authoritative. |

[Uniswap's oracle discussion](https://docs.uniswap.org/contracts/v2/concepts/core-concepts/oracles)
explains cumulative averaging and the dependence of resistance on depth,
duration and arbitrage. It does not establish a safe IFR borrowing budget.
Include external economic gains, including price-lock releases, in the
shared-source attack model. A lock release has no universal ETH value cap.

Ratified pilot ceilings (LV-C04), all on-chain and checked atomically:

| Limit | Ratified ceiling and accounting |
| --- | --- |
| Total outstanding principal | `100,000 * 10^9` IFR; also no more than 10% of current lending principal (`totalAvailable + totalLent`, excluding interest credits and donations). |
| Per loan / borrower / offer | 10,000 / 20,000 / 25,000 IFR outstanding; borrower maximum two active loans. Address caps are not Sybil protection. |
| Gross origination rate | 25,000 IFR per rolling 24 hours across all offers; repayment does not restore this budget. |
| ETH exposure | Sum of each loan's immutable default ETH amount no greater than `min(0.5 ETH, 1% of validated WETH depth)`; do not mark this accounting down with a manipulated price. |
| Economic ceiling | Maximum realizable attack gain must be below a reviewed lower-bound manipulation cost with the ratified 10x margin. If no defensible positive lower bound exists, cap is zero. |

Every applicable ceiling must pass. Caps initialize at zero. Principal exits
outstanding totals only after terminal settlement; fresh loans still consume
the gross-origination budget. Cap decreases never force a loan closed; cap
increases and reactivation require the 48-hour governance path. The scenario's
0.39 ETH depth fails the ratified 50 WETH prerequisite regardless of caps.

## Loan terms, interest and LTV

Proposed initial scope: full repayments and full liquidations, no collateral
withdrawal, refinancing, partial liquidation, cross-collateralization or pooled
loss sharing. Each lender posts an offer with a fixed rate and term bounds;
each loan snapshots those terms, fee receiver, adapter/policy and default
settlement. Borrower supplies maximum rate, minimum received IFR, maximum
required collateral and transaction deadline to reject changed quotes.

Let `A` be IFR principal in base units, `C` collateral in wei, `r` the fixed
rate in basis points per 30 days, and `T` term in seconds. Use full-precision
integer `mulDiv` with explicit rounding:

```text
elapsed = min(max(now - start, 0), T)
interest(t) = ceil(A * r * elapsed / (10,000 * 30 days))
D(t) = A + interest(t)
Dmax = A + ceil(A * r * T / (10,000 * 30 days))
V(D, P) = ceil(D * P / 10^9)                     [wei]
requiredCollateral = ceil(V(Dmax, Pborrow) * 10,000 / initialLtvBps)
LTV(t) = V(D(t), Phealth) / C                   [compare by cross-product]
```

Proposals (LV-C05): initial LTV at most **30%**, warning from **40%**, full
liquidation from **50%**, 5% maximum liquidation bonus; term 30-90 days;
interest rate at most 200 bps per 30 days, noncompounding, accrued per second
and frozen at maturity. No minimum month on early repayment. Equality is
valid at the initial cap and liquidatable at the liquidation boundary.
These replace, rather than claim approval of, V1's 200%/150%/120% collateral
ratios and 2%-25% monthly utilization schedule. Origination covers maximum
term interest, not principal alone. Interest is IFR, never an ETH fee.

## Settlement and collateral return

| Transition | Preconditions and resulting accounting |
| --- | --- |
| Fund / withdraw offer | Credit actual received IFR; require exact amount in the fee-exempt pilot. Lender may withdraw only available principal; closure can be reopened safely without stale offer-index flags. |
| Borrow | All caps, oracle validity, receiver configuration, fee exemption and initial LTV pass. Move `A` from available to lent; store `C` and terms; deliver exactly `A` IFR or revert. |
| Repay | Receive net `D(t)` IFR from the borrower, including during pause/outage/grace. Close the loan once, return principal to the originating offer and credit interest beneficiaries. Credit the borrower's entire `C` in ETH. No oracle call. |
| Top up | Borrower adds ETH to an active loan even during pause/outage. It changes collateral, not debt, rate or fixed default amount. |
| Price liquidation | Valid confirmed price, LTV at or above the threshold, active loan and time before the expiry boundary. Liquidator pays full `D(t)` IFR; return principal and split received interest. Credit liquidator `min(C, ceil(V(D(t), Psettle) * (10,000 + bonusBps) / 10,000))` ETH; borrower receives all remaining ETH. |
| Mature / grace | Debt freezes at `Dmax` at `start + T`. Proposed grace: seven days. Repayment, top-up and valid price liquidation remain possible until `due + grace`; no renewal or admin extension. |
| Expire / default | At or after `due + grace`, any caller settles without an oracle or an ETH receiver call. Write off outstanding IFR principal to a separate loss counter, reduce lent totals, and credit the lender the immutable default ETH amount (bounded by `C`); credit borrower all surplus. No invented IFR repayment or unreceived interest distribution. |

At origination, the ratified contractual default payment is
`E = min(C, ceil(V(Dmax, Pborrow) * 12,500 / 10,000))` (LV-C06). Store `E`;
later top-ups do not increase it. At default the lender receives `E` and the
borrower receives `C - E`; no expiry keeper bounty is provided. Repayment is
accepted only before `due + grace`; expiry is accepted from that exact
timestamp, so transaction ordering cannot choose different boundary rules.
Price liquidation is also unavailable from that boundary. All terminal
paths reject already settled loans.

This fixed ETH default payment is an explicit non-recourse term, not a promise
to restore IFR at its future market value. It avoids an outage trapping ETH,
but gives the borrower an economic default option if IFR appreciates sharply.
The lender may lose IFR exposure even with excess ETH collateral. The owner
ratified this payoff (LV-C06); the activation proposal must disclose its stress
results. Activation stays blocked until the economic evidence gates pass.
Do not conceal that tradeoff with an admin
price override or silently give the lender all borrower surplus.

V1's pay-caller-without-IFR liquidation is excluded from V2. If nobody is
willing to pay full IFR debt, liquidation need not happen: the loan remains
active until repayment or expiry and is reported as at-risk. Lenders cannot
withdraw outstanding principal as if it were still present.

All ETH recipients use individual pull credits with a credit-holder-authorized
destination, checks-effects-interactions and reentrancy protection. A failed
claim restores the credit and cannot undo debt settlement or block another
claim. Use an optional WETH payout route for an ETH-rejecting claimant.
IFR interest is likewise claimed from balances; a receiver failure never
blocks repayment. Claims cannot change their beneficiary through an admin.

Proposed interest split remains 50% lender / 50% protocol (LV-C07): floor the
lender half and give the remainder to the protocol. The fee receiver must be
nonzero, distinct from the vault/token and capable of claiming its credits;
configure and test it before borrowing. Snapshot it per loan and
credit that address, never an unset sink. Destination changes affect future
loans only. A protocol receiver's controller follows Ownable2Step; the
receiver itself gains no loan administration rights.

If fee exemption is revoked, stop new borrowing and deposits but preserve
settlement. Repayment/liquidation must receive at least the full net `D(t)`:
the payer may authorize a larger, explicitly bounded gross transfer, and any
received excess becomes that payer's IFR credit. Never credit nominal input
as received IFR or overdraw another lender's principal. Outgoing IFR
withdrawals/claims debit their gross entitlement and disclose any token tax, without a treasury
gross-up guarantee (LV-C07). Arbitrary IFR-token failure cannot be solved by
vault logic; oracle-free ETH expiry remains available.

## Administration and emergency behavior

Every new vault, configurable oracle adapter, guardian controller, rescue or
fee controller with privileged powers must inherit OpenZeppelin
**Ownable2Step**. Its ownership moves only through nomination and the pending
owner's `acceptOwnership`; the old owner retains authority until acceptance.
Disable ownership renunciation while the system has continuing obligations.
The documented semantics are in
[OpenZeppelin's API](https://docs.openzeppelin.com/contracts/5.x/api/access).

Proposed role assignment (LV-C08): Governance is each vault/adapter owner;
a dedicated pause controller owned by the Treasury Safe through Ownable2Step
is the sole emergency guardian. Installing/replacing that role contract also
requires governed nomination and acceptance from the candidate; no one-step
raw guardian, oracle-publisher or rescue-admin setter. Zero nomination may
cancel a pending owner transfer, never remove the incumbent. Permissionless
observers and settlement callers are not admins. Fee beneficiaries without
privileged methods are recipients, not admin exceptions.

| Action | Authority / behavior |
| --- | --- |
| Pause new borrowing | Owner or accepted guardian, immediate; also automatic refusal on invalid oracle/caps/exemption. |
| Pause price liquidation | Owner or guardian, immediate, for oracle incidents; this does not freeze maturity settlement. |
| Resume either activity | Governance only after at least 48 hours, on-chain validity checks and full warm-up if history was invalidated. |
| Withdraw available offers, repay, top up, claim, expire | Remain available during every pause and oracle failure. |
| Change rates, caps, receiver or future policy | Governance with 48-hour timelock; bounded and prospective only. |
| Seize collateral, sweep owed IFR/ETH, change live loan terms | No admin capability. |

No proxy upgrade or arbitrary-call/delegatecall escape hatch is proposed.
Emit role-nomination/acceptance, config-version, pause, quote, lifecycle,
write-off and claim events sufficient to reconcile every balance. Monitor
observation gaps, depth, cap headroom, health, maturities, losses and pending
ownership changes; a monitor cannot execute governance automatically.

## Invariants

1. `totalLent = sum(active principal)` and available principal equals the sum
   of withdrawable offer balances. Default losses never become available IFR.
2. IFR balance is at least available principal plus all unclaimed IFR credits.
   Accrued but unpaid interest and lent principal are not cash liabilities.
3. ETH balance is at least active collateral plus all unclaimed ETH credits;
   forced/direct transfers do not create user credits or relax any cap.
4. Each terminal transition reduces active counts once, consumes its loan once,
   and partitions all collateral into credits totaling exactly `C`.
5. Only received interest is allocated; lender and protocol allocations sum
   exactly to interest, including one-base-unit rounding cases.
6. No borrow or price liquidation succeeds with invalid or stale evidence;
   no price failure, pause, hostile recipient or guardian can prevent
   repayment or contractual expiry accounting.
7. No loan changes its rate, term, receiver, oracle policy or default payment
   after borrower/lender acceptance. Borrower top-ups cannot be swept by admin.
8. Exposure/rate caps hold across all offers and wallets after every borrow;
   closing and reopening loans cannot reset a rolling gross-origination cap.
9. No admin role transfers in one step; pending owners and unaccepted role
   candidates have no new authority. Ownership is not a fund-withdrawal right.
10. All token/price arithmetic uses checked integers and explicit rounding;
    tests and clients use `bigint` or decimal strings for IFR amounts.

## Verification plan

These are requirements for future implementation, **not passing V2 tests**.
Preserve existing V1 tests as evidence of legacy behavior.

| Suite | Required cases |
| --- | --- |
| Lifecycle | Fund/increase/withdraw/reopen, quote slippage/deadline, early/on-time/late repayment, top-up, full liquidation with IFR payment, expiry, losses and every credit split. |
| Time and integer boundaries | Due/grace minus one second and exact boundary; zero/tiny principal, one base unit, maximum rate/term, ceil/floor behavior, interest-inclusive LTV, equality at caps and thresholds. |
| Recipient and token behavior | Adapt [LendingVaultActor](../../contracts/mocks/LendingVaultActor.sol) for rejecting/reentrant ETH claimants; malicious IFR receiver, false-return/reverting token, revoked fee exemption, exact-balance deltas, forced ETH and direct IFR. Settlement must remain independent of claims. |
| Oracle | Both token orders, 9/18 decimals, wrong factory/pair, zero reserves, missing/stale/future observations, insufficient window, counterfactual accrual, timestamp/cumulative wrap, buffer overwrite, gaps, pair revert, extreme deviation and full re-warm after config change. |
| Abuse and accounting | Atomic flash swap, sustained low/high TWAP, temporary checkpoint liquidity, multiwallet cap use, repay/reborrow churn, utilization changes, insolvency/loss reporting and randomized conservation sequences. |
| Authority | Unauthorized admin actions; nominate/cancel/replace/accept owner and guardian controller; wrong acceptor; old versus pending authority; renounce blocked; guardian cannot unpause, reprice, seize or extend maturity. |
| Pause/outage | Price actions stop; available withdrawals, repayments, top-ups, claims and oracle-free expiry still work with a pair that always reverts. |

Fork plan: create a future `test/fork/LendingVaultV2Fork.test.js` using a
recorded Mainnet block **and hash**, a secret-free manifest and an archive RPC.
Use the real IFR token, canonical factory/pair and actual fee behavior.
Deploy candidate bytecode only to the local fork; label it synthetic, never
evidence of a deployed V2. Assert V1 remains disabled and no state migration
occurs. Cover fee exemption via the actual Safe-to-Governance timelock on
the fork, including exact calldata, early execution rejection and post-state.
Use actual swaps/liquidity operations, not only reserve mocks, for flash,
multiblock, thin-pool and sample-liquidity attacks; publish gas, capital,
fees, unwind, gain and arbitrage assumptions. Include the supplied
17.6M/0.39 scenario as a separately labeled synthetic stress fixture.

Existing commands for reference are `npm run test:contracts` and
`npx hardhat test test/LendingVault.test.js test/PriceLockVault.test.js`.
Future V2 suites must be added to the contract gate; a skipped fork suite or
an idle-price fork proving TWAP equals spot does not satisfy manipulation
analysis. Never broadcast fork impersonations or transactions to Mainnet.

## Ratified policy and activation gates

The owner ratified the conservative implementation defaults for these design
rows on 18 October 2026; see the implementation notes. Exact identities, oracle
delivery, economic evidence and activation authorization remain open. Ratification
does not claim that the shared production adapter has been implemented.

| ID | Decision requiring a recorded outcome |
| --- | --- |
| LV-C01 | Build/approve the TWAP term-loan product, defer it, or commission a distinct no-price lender-quote product; accept economic default-option risk. |
| LV-C02 | Source selection, shared adapter, seven-day slow/30-60-minute fast windows, recording/retention policy, one-hour age/gap bounds, 20% deviation, absolute price bounds and version pinning; any manual-publisher alternative. |
| LV-C03 | WETH and IFR depth floors, evidence of depth between samples, independent source/committed-liquidity requirements and a credible manipulation-cost model. |
| LV-C04 | Every IFR, borrower, offer, aggregate ETH and rolling-origination cap; 10x attack-cost margin and initial pilot allocation. Unset means zero borrowing. |
| LV-C05 | Initial/warning/liquidation LTV, rate ceiling/model, term limits, accrual/rounding and bonus. |
| LV-C06 | Seven-day grace, fixed ETH default formula/25% buffer, non-recourse loss treatment and exact expiry boundary; mandatory lender disclosure. |
| LV-C07 | Protocol interest split, beneficiary/controller address, fee-exemption dependency and receipt policy. |
| LV-C08 | Exact governance/guardian controller principals, nomination/acceptance wiring, pause scope, incident and resumption process. Two-step ownership itself is mandatory. |
| LV-C09 | Implementation budget, independent reviewer, testnet acceptance, deployment/migration scope and a separate production activation decision. |

Activation requires all of the following, in order:

1. Record the ratified defaults for LV-C01-LV-C09 and reconcile with lane 2;
   an approved immutable loan payoff and an exact, bounded parameter manifest.
2. Implementation authorization, complete lifecycle/invariant/hostile-recipient
   tests and independent contract plus oracle/economic review, including
   the fixed-ETH default option and shared-source gains. Existing price-lock
   review does not review this design.
3. Pinned fork evidence and Sepolia full-window rehearsal with borrowing,
   repayment, liquidation, overdue/default, guardian pause and both steps of
   every ownership transfer. No RPC access or skipped tests is not a pass.
4. Fresh chain evidence, fee exemption and valid receiver/controllers;
   sufficient liquidity/coverage and demonstrated attack budget. Failure or
   inability to bound manipulation cost leaves the borrowing cap zero.
5. Separate action-specific production authorization and exact reviewed-head
   checks, followed by Safe proposal and public **48-hour timelock** for each
   required wiring/activation action. Activation and every borrow recheck
   readiness on-chain; off-chain approval alone cannot bypass it.
6. Post-execution block/hash-pinned owner, pending owner, code, exemption,
   caps, pause, receiver and oracle checks, with alerts and an exercised pause
   runbook before widening any cap. V1 price remains unset.

No activation gate is marked complete by this documentation change.
