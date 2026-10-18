# CommitmentVault V2 and Price-Conditioned Lock Specification

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

The release-candidate status applies to the ratified **time-only CommitmentVaultV2**
implementation. The separate price-lock successor and shared production oracle
remain future work; their requirements below are not implemented by this release.
The already deployed time-only V2 has a separate identity and is unchanged.

## Recommendation and naming

**Recommendation:** retain CommitmentVault V2 as a time-only vault. If price
locks proceed, use a separately reviewed `PriceLockVault` successor with a
bounded seven-day TWAP shared with the LendingVault research path, immutable
per-lock terms, an unconditional oracle-free return deadline of at most four
years, and an optional capped, timelocked early-rescue mechanism. Keep new
price locks disabled until Council decisions and readiness gates pass. If
price-source safety cannot be shown, remove price conditions from the new
product and offer time-only locks.

This follows the 3 October owner choice in
[decision-register lane 2](../GOVERNANCE_PRODUCT_DECISION_REGISTER.md#lane-2--commitmentvault-price-lock-v2-and-v1-fail-closed-boundary):
dedicated PriceLockVault, seven-day TWAP, maximum four-year rescue time,
governed on-chain readiness. Gio's 18 October decision ratifies the time-only
implementation defaults and local release preparation, and keeps
**Ownable2Step mandatory for every admin role**. It does not
authorize replacing the already deployed time-only V2 or activating the
existing PriceLockVault candidate.

The requested “V2 price-lock” title describes a product design generation.
It is **not** a claim that deployed CommitmentVault V2 supports prices. The
[V2 repair record](../COMMITMENT_VAULT_V2_REPAIR.md) already records a
time-only deployment, fee exemption and interface release. Existing
[PriceLockVault source](../../contracts/vault/PriceLockVault.sol) and its
[specification](../PRICE_LOCK_VAULT_SPEC.md) are a built candidate, recorded
as reviewed and not deployed at this repository revision. The candidate uses
`Ownable`, a 32-slot observation buffer, two-endpoint depth sampling and
deadline rescue; it has no governed early-rescue facility. The separate price-successor
requirements remain a delta requiring implementation authorization and a new
review, not a claim that the candidate meets them.

## Why V1 price tranches cannot unlock

Evidence base: revision `9c0f5352c31cf4c7db595ac444a8464db3125b88`,
[CWA-03 register](../community-audits/CWA_REMEDIATION_REGISTER.md),
[OPS-002](../KNOWN-ISSUES.md#ops-002----commitmentvault-price-locks-disabled),
[repair record](../COMMITMENT_VAULT_V2_REPAIR.md),
[oracle-path analysis](../COMMITMENT_PRICE_LOCK_ORACLE_PATH.md) and
[CV-01 tranche record](../wiki/commitment-vault-compensation.html).

1. The deployed V1 accepted all four condition types. The repository later
   added `require(cType == TIME_ONLY, "price conditions disabled")`; this
   source guard does not retrofit old deployed bytecode. V2 uses the guard.
2. The price path returns zero even if Governance sets a nonzero oracle:
   `_getCurrentPrice()` contains no external oracle read. For the affected
   positive price targets, `currentPrice >= targetPrice` is always false.
3. `PRICE_ONLY` therefore never succeeds. `TIME_AND_PRICE` remains false even
   after its date. `TIME_ONLY` can succeed normally; `TIME_OR_PRICE` can
   succeed through its time branch. Do not label every price-related enum as
   permanently stuck.
4. `markConditionMet` and `unlock` require the condition to be true; waiting
   30 days cannot bypass it. The recorded fork experiment setting an oracle
   returning the maximum price and advancing ten years still could not
   release the affected tranches. V1 has no rescue, upgrade or fund-transfer
   admin function. An oracle-setting transaction cannot repair this bytecode.

CV-01 records **11 permanently locked tranches totaling
26,418,467.994338353 IFR**, exactly **26,418,467,994,338,353 base units**:
one `TIME_AND_PRICE` tranche of 18,367,567.924610366 IFR and ten `PRICE_ONLY`
tranches totaling 8,050,900.069727987 IFR. These tokens remain held by V1 and
in token total supply; they are not burned. This is the repository's dated
incident record, not a fresh balance attestation. Explorer retrieval was
unavailable while drafting; a new block/hash-pinned chain inventory remains
an activation prerequisite. No compensation vote or payment status is
inferred from the historical tranche record.

CV-01 compensation, if separately authorized under its own conditions,
transfers other reserves; it does not recover these V1 tokens or fund this
new vault. No rescue function added to a new contract can access V1 custody.

## Product alternatives and condition semantics

| Choice | Safety boundary | Recommendation / decision |
| --- | --- | --- |
| Remove price conditions | New custody accepts only a future time, with no P0 or oracle dependency. | Default if a safe source is unavailable; preserves the time-only repair. PL-C01 remains OPEN for whether a new price product proceeds. |
| Bounded source plus mandatory deadline | A valid price may release early; a fixed maximum time always releases without any oracle or admin. | Preferred dedicated-vault design, consistent with the existing lane 2 decision. Additional policy is OPEN under PL-C02-PL-C06. |
| Manual governed price | Require the bounded, source-timestamped quote rules in the lending specification; no silent fallback. | Not recommended for irrevocable price release; opens discretionary early release and timelock/freshness conflicts. Separate Council approval needed. |
| Oracle with governance as the only rescue | Oracle/key failure or Council inactivity can leave custody stuck forever. | Reject; governance rescue supplements, never replaces, the immutable deadline. |

The dedicated product's proposed first slice supports a target price with an
optional earliest date and a mandatory deadline. Define:

```text
deadlinePath = now >= maxUnlockTime
pricePath = !priceReleasePaused AND now >= earliestTime
            AND validPrice AND priceWei >= targetPriceWei
canRelease = deadlinePath OR pricePath OR executableGovernedRescue
```

Evaluate `deadlinePath` first and make **no oracle/pair call** on that path.
Optional `earliestTime = 0` gives bounded `PRICE_ONLY`; a positive date gives
bounded `TIME_AND_PRICE`. `TIME_ONLY` remains in CommitmentVault V2.
Independent `TIME_OR_PRICE` support would add a third, earlier time branch;
the existing PriceLockVault candidate does not provide that shape, so reject
it in the first slice rather than silently reinterpret it (PL-C01).

New terms store `targetPriceWei` directly in wei per full IFR, not ambiguous
“bps” multipliers. V1's actual formula divides `p0 * multiplier` by **100**,
despite comments calling the field bps. Do not reuse that ABI or silently
convert a new target with a denominator of 10,000. Validate target positivity,
integer bounds and explicit rounding before taking custody.

Proposed lock constraints: nonzero amount/target; deadline from one day to
`1461 days` after deposit; `earliestTime <= maxUnlockTime`; maximum 50 active
locks per wallet, with slots freed on terminal release. Store original
depositor, credited IFR amount, timestamps, target, adapter/policy version
and state. Terms never change after deposit. The four-year maximum is
existing owner policy; the one-day minimum, count, admitted condition shapes
and target range are OPEN (PL-C01/PL-C05).

No price-hit latch is proposed. Check the valid price at release execution;
a prior price crossing, UI indication or `mark` cannot create a permanent
release right if price later falls. There is no 30-day auto-unlock timer
for price hits in this slice. This avoids inheriting V1's transient-condition
ambiguity and matches the candidate's execution-time check. Deadline release
does not require a prior mark. Permissionless release to the original wallet
is proposed (PL-C05); a caller never receives the funds or a rescue bounty.

## Bounded price source and manipulation

Reuse the **interface and evidence policy** from
[the LendingVault V2 specification](LENDINGVAULT_V2_SPEC.md#shared-twap-contract-and-consumer-validity),
with per-consumer policy versions. Sharing does not mean using lending LTV
or copying an unreviewed oracle implementation. A verified IFR Chainlink feed
was not identified in official catalog research; do not invent a proxy or
substitute ETH/USD for IFR/ETH.

For price locks, retain the recorded **seven-day window**. Proposed additional
bounds are a one-hour latest-observation age and maximum coverage gap,
50 WETH plus a Council-set IFR-side reserve minimum at all sampled checkpoints
and consumption, absolute price/target limits, and deviation refusal as
defined in the shared specification (PL-C02). Invalid, missing, stale, zero,
out-of-range or reverting data cannot satisfy a price condition. Price-only
release must not succeed by treating an error as zero, maximum price, or the
last successful quote without its original expiry.

The supplied **17.6M IFR / 0.39 ETH** scenario is too shallow to justify
activation under the proposed depth floor. It is not a current chain read.
The lending specification quantifies illustrative spot trade sizes; a single-block
flash spike should not affect a completed cumulative window, but sustained
manipulation, LP removal and flash-added checkpoint liquidity remain relevant.
Do not present seven days or 50 WETH as a proven economic guarantee.

The existing candidate samples reserves only now and at the selected old
observation. That cannot certify depth throughout seven days. Checking more
samples also leaves gaps between samples. A stronger source/depth policy than
the candidate's recorded scope needs a new Council decision and review
(PL-C02). Likewise, changing the candidate's price-or-depth readiness to
mandatory price validity **and** depth is a proposed delta. No fallback may
weaken it automatically.

On-chain activation and **every new lock and price-based release** recheck
source validity and the approved depth/readiness policy. New-lock and price
activity initialize disabled, and entry caps initialize at zero. A price
threshold alone is not a depth test. A shared adapter failure affects both
vaults, so test combined attack
gains and operational outages. While a price unlock returns a depositor's
own tokens rather than borrowing treasury funds, premature release can have
external economic value. Lock caps alone do not prove a lower attack gain.

Bind existing locks to their source/policy version. Governance cannot replace
an old lock's oracle, lower its target or extend its deadline. A new source
requires a new version, a full warm-up and an explicit user choice for new
locks. If an old source fails, its immutable deadline still works.

## Two rescue paths

### Mandatory deadline return

At `maxUnlockTime` the original depositor is entitled to the whole remaining
lock amount. Any proposed relayer only triggers payment to that depositor.
The path ignores oracle validity, pair reads, active/new-lock flags, guardian
price pauses, governance availability and early-rescue budgets. No Council
vote, timelock, daily cap or compensation allocation is needed to exercise
this previously accepted deadline. It cannot be extended or revoked.

This is the principal protection against another permanently impossible
condition. Four years is an outer bound, not a promise of an earlier price
hit. Failed token transfers preserve the claim and revert that release;
ordinary token-chain availability remains a dependency, not an oracle escape.

### Optional governed early rescue

This is a proposed **new** power (PL-C03), disabled unless approved and
explicitly disclosed at deposit. It can only accelerate return to the
original depositor after a documented oracle/source failure; it cannot send
IFR to Governance, treasury, caller or another lock. Depositor opt-in to this
power is immutable; non-opted-in locks retain their ordinary deadline path.

1. Publish an incident/evidence hash and exact contract, chain, depositor,
   lock IDs, amounts and reason. Proposed qualifying incident: invalid source
   continuously evidenced for seven days. Off-chain testimony alone must not
   satisfy an on-chain predicate; if continuity cannot be safely demonstrated,
   early rescue remains disabled pending an approved alternative.
2. Queue the exact action through Governance's **48-hour public timelock**.
   In addition, the vault enforces a proposed **seven-day action delay** from
   registration. Execution time is at least the later of those deadlines;
   no incident, guardian or owner bypasses them. Proposed execution window:
   seven days after eligibility, then the authorization expires.
3. Recheck lock state, opted-in status, qualifying incident, amount and all
   budgets at execution. If it already released normally, reject; never pay
   twice. Proposed rescue releases whole locks only, with bounded batches.
4. Proposed caps: 100,000 IFR per action; 500,000 IFR across every rolling
   30-day interval; and 1% of total locked at the beginning of a fixed 30-day
   accounting epoch. Enforce the absolute rolling cap and epoch percentage
   cap independently. New deposits cannot enlarge that epoch's percentage
   budget. All queues share budgets consumed only by successful execution;
   splitting across calls/wallets cannot evade them.
5. Owner or accepted guardian may cancel queued rescue, never redirect it or
   accelerate execution. A cap increase or change to incident criteria needs
   a new governed delay and cannot apply to already queued actions. A lock
   above the whole-lock cap waits for normal release/deadline; caps never
   throttle the mandatory deadline route.

Exact incident proofs, amounts, epoch anchor, delay, window and batch size
are **OPEN PL-C03**, with zero early-rescue budget until decided. If this
additional admin power cannot be kept narrow and independently reviewed,
omit it and retain only the unconditional deadline. No confiscation, arbitrary
IFR sweep or general emergency transfer function is proposed.

## Ownership, guardian and accounting

Every newly built vault, mutable adapter, guardian controller and rescue
controller must inherit **Ownable2Step**. Ownership requires nomination and
acceptance by the pending owner; nomination alone grants no power.
Renunciation is disabled while custody or continuing responsibilities exist.
See [OpenZeppelin's ownership API](https://docs.openzeppelin.com/contracts/5.x/api/access).
This requirement also applies to a controller introduced to separate admin
duties; it is not satisfied by a two-step vault owner plus one-step setters
for raw guardian or rescue-admin EOAs.

Proposed principals (PL-C04): Governance owns the new vault and adapter;
the Treasury Safe owns an Ownable2Step pause controller. Role-controller
installation/replacement uses governed nomination plus candidate acceptance.
All ordinary configuration, activation and ownership migration uses the
recorded Safe-to-Governance 48-hour path. Ownership acceptance by a governance
contract must itself be executable and rehearsed; a deployer cannot accept
on its behalf. Existing deployed V1/V2 ownership semantics are not upgraded
by this document. The owner standard is mandatory for successors and any
privileged auxiliary contract added to this design.

| Control | Permitted effect |
| --- | --- |
| Owner / guardian immediate entry pause | Stop new deposits; no custody movement. |
| Owner / guardian immediate price-release pause | Disable the price branch during oracle incidents; cannot disable time/deadline return or previously executable nonprice claims. |
| Governance resumption | After 48 hours and on-chain readiness/coverage checks; no guardian unpause. |
| Governed rescue | Only the delayed, incident-bound, opted-in and capped acceleration above. |
| Owner configuration | Prospective adapter/policy and entry limits; no rewriting existing lock terms. |

There is no borrowing, yield, protocol fee or rescue fee in this custody
product. All credited IFR returns to the original depositor. Require fee
exemption for activating new locks. Measure received balance, and for the
proposed pilot reject a transfer that does not deliver the exact requested
amount. If exemption is later revoked, stop new deposits and report that
transfer taxes may reduce actual receipts on exit; do not trap the exit
until exemption returns or promise a treasury gross-up (PL-C06).

Use SafeERC20, checks-effects-interactions, reentrancy protection and bounded
per-call loops. State transitions consume each lock once before transfer;
a failed transfer reverts that transition. Direct token donations do not
create locks, increase an individual claim or grow the early-rescue epoch
budget. Emit versioned lock, price evidence, release-reason, pause,
rescue-queue/cancel/execute and ownership events. No proxy or arbitrary-call
upgrade escape is proposed.

Proposed entry caps (PL-C05): 100,000 IFR per lock, 250,000 IFR per wallet,
1,000,000 IFR globally outstanding and 100,000 IFR gross new locks per
rolling 24 hours. These are research ceilings, initialize at zero and are
not authorization to allocate any IFR. Only the global/gross ceilings bound
multiwallet entry. Release frees outstanding capacity but never resets the
gross-entry budget.

## Migration and CV-01 separation

1. Inventory V1, the deployed time-only V2 and any future vault separately,
   with chain ID, address, code hash, block/hash and per-lock type/amount.
   Use existing historical records for context, then collect fresh evidence
   before any activation claim.
2. **V1 funds cannot move into V2.** Permanently locked CV-01 balances stay in
   V1. Unlockable V1 time tranches are returned through V1 by their existing
   rules; users may then make a separate new deposit if they choose.
3. **V2 is only for new locks**, and the already deployed CommitmentVault V2
   remains `TIME_ONLY`. A future PriceLockVault successor also accepts only
   new opt-in deposits. No automatic relock, approval reuse, proxy storage
   migration, impersonated signature or admin transfer of old custody.
4. Keep legacy balances and release actions discoverable by version. Route
   new forms only to the approved new address after chain-readiness evidence;
   do not re-enable price enums on V1 or time-only V2. Prevent double counting
   across vaults. Price locks remain excluded from Benefits eligibility
   unless separately approved and implemented (PL-C07).
5. CV-01 funding, compensation approval, original conditions and payments
   remain in their own Council process. No rescue cap, deposited balance or
   hypothetical compensation in this specification constitutes a reserve
   allocation. Do not relabel compensation as migrated/recovered V1 IFR.

## Invariants

1. Sum of unreleased credited lock amounts equals `totalLocked`; token balance
   is at least that liability. Donations never create ownership claims.
2. Every release pays only the original depositor and consumes the amount once;
   caller, owner, guardian and rescue executor cannot substitute a recipient.
3. Every new price lock has an immutable finite deadline at most 1461 days
   after deposit. Deadline release makes no oracle call and survives all
   entry/price pauses, inactive state and unavailable Governance.
4. Before the deadline, price release requires valid current policy evidence
   and the exact target/date; past crossings do not latch eligibility.
5. No update lowers existing targets, changes source policy, extends deadlines,
   retroactively opts into governed rescue or changes rescue beneficiaries.
6. Governed early rescue is opted-in, delayed, incident-bound, budgeted and
   replay-safe. It never bypasses or caps mandatory deadline return.
7. Active-count/outstanding caps track terminal transitions exactly; rolling
   entry/rescue budgets resist call splitting and wallet splitting.
8. Only an accepted Ownable2Step owner/controller receives admin authority;
   no admin power is an IFR-withdrawal entitlement.
9. V1/V2/new-vault accounting is separate; no new contract claims to unlock,
   burn, migrate or compensate the CV-01 funds.
10. IFR quantities use 9-decimal base-unit integers; target prices use wei per
    full IFR. No floating-point amount or ambiguous multiplier is accepted.

## Test and fork plan

These are future acceptance tests, not a report of implemented changes.

| Area | Required evidence |
| --- | --- |
| Legacy boundary | Preserve [CommitmentVault tests](../../test/CommitmentVault.test.js) T12-T17 and T36/T44-T45: every price enum rejected before custody, even after oracle/P0 setters. Retain the separate legacy fork evidence that old V1 bytecode accepts those enums. |
| V1 incident | Pin original affected lock IDs and exact sum with bigint; V1 cannot release positive PRICE_ONLY/TIME_AND_PRICE targets after oracle-setting/max-returning mock and ten years. TIME_ONLY and TIME_OR_PRICE time branches remain distinct. Label historical block/hash. |
| Condition semantics | At target minus one wei, equality and above; before/at earliest date; crossing then price drop; no latch; invalid source never met; unsupported OR enum rejects without custody. |
| Deadline | At deadline minus one second and equality; four-year bound and one-day minimum; unreachable target; source always reverts; missing history, entry pause, price pause, inactive vault and no Governance all leave deadline release usable. |
| Oracle/manipulation | Both token orders, factory provenance, decimals, cumulative/timestamp wrap, stale/gapped data, zero reserves, flash spike/reversal, sustained manipulation and flash-added/checkpoint-only depth. Recheck readiness for activation, entry and price release. |
| Governed rescue | Non-opted-in or healthy locks, false incident proof, exact queue hash, 48-hour and seven-day boundaries, expired queue, cancellation, duplicate/partial/oversized action, all rolling/epoch caps, deposit-inflated budgets and already released lock. Prove deadline ignores every rescue budget. |
| Authority | Wrong acceptor, pending owner without rights, cancellation/replacement and acceptance, role-controller installation, renounce blocked; guardian cannot unpause, redirect, change terms or accelerate rescue. |
| Custody/adversarial | Missing/revoked exemption, taxed/reverting/false-return/reentrant token, direct donations, count slot reuse, many wallets, amount rounding, bounded batches and conservation under randomized lock/release/rescue sequences. |

Start from [PriceLockVault tests](../../test/PriceLockVault.test.js), including
post-window price behavior, oracle-free rescue against a reverting pair and
concurrent lock limits. These test the existing candidate, not these added
requirements. The existing
[PriceLockVault fork](../../test/fork/PriceLockVaultFork.test.js) proves pair
identity and idle TWAP/readiness; it does not model attack profitability.

Use the existing [deployed V2 fork](../../test/fork/CommitmentVaultV2Fork.test.js)
only at a block at or after its recorded deployment, and distinguish it from
[synthetic V2 rehearsal](../../test/fork/CommitmentVaultV2SyntheticRehearsal.test.js).
Add a separately named successor fork suite on an archive block/hash: deploy
only locally, exercise the real taxed IFR and real pair with swaps and LP
operations, record full-window observations, simulate the exact governance
timelocks/ownership acceptance, and prove no old-vault storage or balances
move. Publish loss/gain and liquidity assumptions for multiblock scenarios.
Do not count RPC-dependent skipped tests as evidence or broadcast them.

Reference commands: `npm run test:contracts`,
`npm run test:commitment-v2-proposal`, `npm run test:commitment-v2-fork`,
`npm run test:commitment-v2-synthetic-fork`, and
`npx hardhat test test/PriceLockVault.test.js test/fork/PriceLockVaultFork.test.js`.
Fork commands require explicit fork mode and a recorded archive block; no
fork test was run or Mainnet state changed to produce this release candidate.

## Ratified time-only policy and successor activation gates

Seven-day TWAP, separate price vault, maximum four-year deadline and the
mandatory Ownable2Step standard are recorded owner decisions. The following
time-only defaults were ratified on 18 October 2026 in the implementation notes.
The table also records separately scoped price-successor requirements; ratification
of the time-only defaults does not supply that successor or its oracle/rescue code:

| ID | Required decision |
| --- | --- |
| PL-C01 | Proceed with a new price product or time-only fallback; admit bounded PRICE_ONLY/AND only, or separately scope OR; approve successor naming and compatibility. |
| PL-C02 | Shared adapter/source version, absolute price bounds, age/gap/deviation checks, IFR/WETH depth floors, evidence between samples and stricter readiness at release; explicitly revise the candidate's two-endpoint scope if adopted. |
| PL-C03 | Include or omit opted-in governed early rescue; incident predicate/proof, seven-day delay and window, all absolute/rolling/percentage caps, epoch anchor, batch limit, cancellation and cap-change rules. |
| PL-C04 | Exact Governance/guardian/controller principals, two-step role installation, entry/price pause and 48-hour resumption procedures. Two-step ownership itself is mandatory. |
| PL-C05 | Per-lock/wallet/global/rolling entry caps, minimum duration, concurrent lock limit, target range and permissionless depositor-only release. |
| PL-C06 | Exact-receipt/exemption activation policy, treatment of revoked exemption on exit and explicit confirmation of no fees or treasury gross-up. |
| PL-C07 | Versioned UI/migration inventory and eligibility treatment; implementation funding, independent review, staging acceptance and separate deployment/activation authorization. CV-01 compensation remains separate. |

Required gate order:

1. Record the ratified time-only choices and remaining successor scope in
   PL-C01-PL-C07; reconcile them with the existing lane 2 scope and
   LendingVault LV-C02/LV-C03. Agree the user-visible early-release and
   maximum-time terms before taking any new custody.
2. Separately authorize implementation. Review the entire successor delta,
   including every admin role, oracle policy, rescue budgets and recipient
   invariants. Previous T-256 review does not approve these new requirements.
3. Pass deterministic/property tests, fresh pinned fork evidence and a
   Sepolia rehearsal over a full seven-day window, including outage, price
   drop, deadline return, early-rescue delay/caps and ownership acceptance.
4. Obtain fresh authoritative bytecode/ownership/exemption/version evidence,
   prove depth/coverage and economic readiness, and establish alerts and an
   exercised guardian runbook. Unproven manipulation resistance keeps price
   entry and release activation disabled; existing deadline rights survive.
5. Obtain separate action-specific production authorization. Use reviewed-head
   checks and the Safe-to-Governance **48-hour public timelock** for exact
   deployment wiring, fee exemption, ownership acceptance and activation.
   Activation and entry/readiness must revert if their on-chain scope fails.
6. Verify post-execution code, accepted/pending owners/controllers, flags,
   budgets, exemption and oracle version at a block/hash; then route only
   new opt-in locks. Keep legacy contracts visible and CV-01 disclosures
   separate. Any time-only fallback omits the price branch entirely.

This document records owner policy ratification; it closes no CWA/OPS issue
or production activation gate.
