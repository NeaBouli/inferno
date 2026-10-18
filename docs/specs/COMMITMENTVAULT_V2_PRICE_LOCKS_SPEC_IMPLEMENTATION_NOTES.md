# CommitmentVaultV2 implementation notes

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

## Scope and interpretation

The [specification](COMMITMENTVAULT_V2_PRICE_LOCKS_SPEC.md), under
“Recommendation and naming,” explicitly requires CommitmentVault V2 to remain
**TIME_ONLY**, and assigns new price conditions to a separate, independently
reviewed PriceLockVault successor. The [oracle-path document](../COMMITMENT_PRICE_LOCK_ORACLE_PATH.md)
records Option B as the chosen option; its earlier Option A example is not an
instruction to reactivate price enums in CommitmentVaultV2.

Accordingly, [CommitmentVaultV2.sol](../../contracts/vault/CommitmentVaultV2.sol)
implements a new, bounded **time-only release candidate**. It does not implement the price
successor described elsewhere in the specification. In particular, no stub
oracle, permissive readiness flag, discretionary price setter or placeholder
incident predicate has been introduced. The full price-successor acceptance
plan remains outstanding. The owner ratified this time-only scope on 18 October 2026.

The conservative entry ceilings, one-day minimum, 50 concurrent locks,
exact-receipt policy and permissionless deadline return are **ratified defaults**
for this time-only release candidate (PL-C05/06).
The contract starts with entry disabled and all four entry caps zero.

## Implementation and compatibility

- `lock(amount, cType, unlockTime, p0Multiplier)` retains the legacy input shape
  only to explicitly reject all three price enums before custody. TIME_ONLY
  requires a zero multiplier. There is no P0/oracle storage or setter.
- Each tranche records the original depositor, measured exact credited amount,
  deposit timestamp and immutable deadline. Its remaining amount becomes zero
  only on terminal release; historical IDs are never reused.
- At the deadline anyone can trigger payment to that original depositor. Unlike
  V1, there is no marking step or extra 30-day relayer wait. The deadline is the
  unconditional return path; entry state, limits, exemption and governance
  cooperation are irrelevant to exit.
- ERC20 metadata must report nine decimals at construction. The token's existing
  `feeExempt(address)` getter is checked at configuration execution and every
  deposit. Actual vault balance deltas must independently equal the requested
  amount. Taxed/short/zero receipts revert the complete transaction.
- Outgoing events report the **gross claim retired** and measured net recipient
  credit separately. Revoked exemption never blocks exit, and there is no
  treasury gross-up. Gross retired claims need not equal actual vault debits if
  the vault itself is a token fee receiver; excess balances create no claims.
- All outstanding caps use claim accounting, never the donated token balance.
  Gross entries use an exact timestamp queue for the rolling interval
  `(now - 24 hours, now]`. At exact age 24 hours an entry expires. Releases do
  not change recorded gross spend. No calendar-day or epoch reset is used.
- Automatic pruning processes at most 50 entries. If more expired entries
  remain, entry reverts `EntryHistoryNeedsPruning`; anyone can prune in batches
  of 1–50 and retry. A reverting deposit rolls back its attempted pruning too.
  `unprunedEntryAmount` is a conservative historical value until maintenance;
  it is not a live quote of remaining entry capacity. This never gates exit.
- `getTranches(wallet, offset, limit)` is paginated (1–50), unlike the legacy
  all-history getter. `lockedBalance` and `hasActiveLock` are constant-work
  lookups. This is a distinct ABI and must not silently replace a live address.
- Configuration stores exact proposed caps and emits a nonce and 48-hour ETA.
  Replacement restarts the delay; cancellation, entry pause and accepted
  ownership handover clear the pending action. Execution checks the nonce and
  exemption again. Lower caps are prospective and can leave old outstanding
  claims above the new entry limit without affecting their release rights.
- OpenZeppelin Ownable2Step governs the sole production admin role. Zero
  nominees are rejected; explicit cancellation and replacement are supported;
  only the pending address accepts. Renunciation is always disabled because
  responsibilities continue even at zero custody. Accepted ownership clears
  the old owner's outstanding entry queue. No guardian/controller is invented.
- Governance remains responsible for timelocking its child-contract admin
  calls, including ownership changes. The vault adds its own fixed 48-hour
  entry configuration delay; it does not replace Governance's public delay.
  A local test uses the existing Governance contract to prove queued contract
  acceptance. That fixture does not certify that legacy Governance meets the
  new successor standards or approve it as the production principal.
- No dependencies, compiler settings, existing contract logic,
  production addresses, UI/eligibility routing or analyzer baselines changed.
  Test-only wrappers reuse the existing taxed and reentrant mocks; their
  unrestricted fault switches are fixtures, not production admin roles.

## Requirement traceability

All `CV2-Txx` identifiers below are exact, uniquely searchable prefixes of test
names in [CommitmentVaultV2.test.js](../../test/CommitmentVaultV2.test.js).
Code locations name symbols in `contracts/vault/CommitmentVaultV2.sol` unless
stated otherwise. “Deferred” means **not implemented or claimed as tested**;
existing candidate tests do not prove the new price requirements.

| Specification requirement | Code location / disposition | Test name(s) / evidence |
| --- | --- | --- |
| Keep CommitmentVault V2 time-only; separate price product | `ConditionType`, `lock`; no oracle/P0 entry points | CV2-T04, CV2-T05.1–3, CV2-T06 |
| Do not patch deployed V1/V2 or existing PriceLockVault | New file only; no legacy call/storage references | CV2-T47; changed-file review |
| V1's zero-price path and ineffective oracle-only repair | Historical context only; existing code untouched | Existing CommitmentVault T12–T17/T36/T44–T45 retained; no new chain attestation |
| PRICE_ONLY/AND fail in old bytecode; distinguish OR's time branch | Deferred historical bytecode/fork evidence, not recreated by this source | Existing fork suites unchanged; not run offline |
| Exact CV-01 inventory and no inferred burn/payment | No incident balances or compensation accounting in new code | CV2-T04, CV2-T47; fresh pinned inventory deferred |
| New target price, optional earliest date, mandatory deadline | Price successor deferred; time fallback has only `Tranche.unlockTime` | CV2-T04–T06 establish exclusion; price branch tests outstanding |
| Reject unsupported independent TIME_OR_PRICE rather than reinterpret | `lock` rejects every non-TIME_ONLY enum | CV2-T05.2 |
| Price targets positive, bounded, wei/full IFR; no bps conversion | No price input accepted; multiplier must be zero | CV2-T05.1–3, CV2-T06; actual target validation deferred |
| Nonzero custody amounts | `lock`, `InvalidAmount` | CV2-T17 |
| Ratified one-day minimum / 1461-day maximum | `MIN_LOCK_DURATION`, `MAX_LOCK_DURATION`, `lock` | CV2-T18 past/now/minimum-minus-one/minimum/maximum/maximum-plus-one |
| At most 50 concurrent locks; terminal slots freed | `activeLockCount`, `MAX_ACTIVE_LOCKS`, `unlock` | CV2-T40 |
| Store original depositor, credited amount, time and terminal state | `Tranche`, `lock`, `unlock` | CV2-T16, CV2-T20, CV2-T40, CV2-T45 |
| Immutable adapter/policy versions and user choice for new source | No price source or source replacement exists; successor deferred | CV2-T04; adapter-version tests outstanding |
| New source needs a new version, full warm-up and explicit user choice | Deferred PL-C02; no source can be installed into this time-only contract | No source-warm-up test claimed |
| No price-hit latch, no price mark/30-day timer | No price path or mark method; time deadline needs no mark | CV2-T04, CV2-T19; crossing/drop tests deferred |
| Permissionless release only to original depositor, no bounty | `unlock(wallet, trancheId)` | CV2-T19–T20, CV2-T45 |
| Shared lending interface/evidence policy, seven-day TWAP | Deferred to separate price successor/adapter | No claimed price-source test |
| One-hour age/gap, 50 WETH and approved IFR-side floor | Deferred PL-C02; no configurable source bypass | CV2-T04 establishes no price activation path |
| Price/target absolute bounds and deviation refusal | Deferred PL-C02; no discretionary price setter | Price-boundary tests outstanding |
| Missing/stale/zero/reverting/out-of-range data never releases early | No source consumed; only immutable time can release | CV2-T19, CV2-T42; price-specific refusal tests outstanding |
| Do not assume shallow 17.6M IFR / 0.39 ETH is economically safe | No liquidity claim or price activation | No fork/economic evidence claimed |
| Check depth throughout coverage; two endpoints insufficient | Deferred PL-C02; existing candidate unchanged | All checkpoint/continuous-depth tests outstanding |
| Readiness is validity AND approved depth at activation/entry/release | Deferred for price successor, not approximated by a time-only readiness flag | Price-readiness tests outstanding |
| New entry disabled and caps zero initially | Constructor/default state, `depositsEnabled`, `entryLimits` | CV2-T01, CV2-T15 |
| Cannot silently change old sources, targets or deadlines | No tranche mutation/configuration path except consuming amount/state | CV2-T41, CV2-T45 |
| Mandatory deadline checked without oracle/pair call | `unlock`; no oracle/pair address exists anywhere | CV2-T04, CV2-T19, CV2-T42 |
| Deadline survives inactive/entry pause/no governance/exemption failure | `unlock` has no entry/admin/exemption checks | CV2-T22, CV2-T25, CV2-T28, CV2-T41–T42 |
| Failed exit preserves claim atomically | `unlock`, SafeERC20, ReentrancyGuard | CV2-T30.1–2, CV2-T44.unlock/lock/pruneEntryHistory |
| Optional early rescue only if approved and disclosed at deposit | Omitted, as the specification permits while PL-C03 is open | CV2-T04; no claim of rescue coverage |
| Rescue proof/continuous seven-day incident/opt-in | Deferred PL-C03; no fabricated incident predicate | No rescue-proof test claimed |
| Exact rescue action hash, chain, wallet, IDs, amounts and reason | Deferred PL-C03 | No rescue-queue test claimed |
| Rescue 48-hour governance + seven-day vault delay/window | Deferred PL-C03 | No rescue-timing test claimed |
| Whole-lock rescue, bounded batch, duplicate/already-released rejection | No early rescue; ordinary release consumes each whole claim once | CV2-T20, CV2-T45; rescue batching deferred |
| Rescue 100k/action, rolling 500k/30 days and independent 1% epoch cap | Zero rescue facility/authority; no budget setter | No rescue-budget tests claimed |
| New deposits cannot inflate epoch rescue budget | No rescue budget; donations excluded from all claims | CV2-T32; rescue epoch tests deferred |
| Owner/accepted guardian rescue cancellation, never redirection | Guardian/rescue omitted pending PL-C03/04 | CV2-T04; guardian tests deferred |
| Rescue cap/incident changes need a new governed delay, never affect queued actions | No rescue policy setters or queues; deferred PL-C03 | No rescue-policy-change test claimed |
| Locks above whole-lock rescue cap wait for ordinary deadline, which no budget throttles | Entire rescue power omitted; all accepted time claims retain their deadline | CV2-T19, CV2-T22, CV2-T41–T42 |
| Every new production admin uses Ownable2Step | Inherits `Ownable2Step`; sole role is owner | CV2-T10–T14 |
| Pending owner gets no authority; wrong/stale acceptors rejected | `transferOwnership`, `acceptOwnership`, inherited access control | CV2-T10–T12 |
| Explicit ownership cancellation/replacement and accepted-state clearing | `cancelOwnershipTransfer`, `acceptOwnership` | CV2-T11–T12 |
| Renunciation disabled while custody/responsibilities exist | `renounceOwnership` always rejects owner renunciation | CV2-T13 |
| Contract owner acceptance must be executable through real queued calls | Existing Governance test fixture only | CV2-T14; successor controller/staging rehearsal deferred |
| Guardian/controller nomination and acceptance, no raw one-step admin | No additional production role installed; pending PL-C04 | CV2-T04, CV2-T10; controller installation deferred |
| Immediate owner entry pause; governance-only delayed resumption | `pauseDeposits`, `queueEntryConfiguration`, `executeEntryConfiguration` | CV2-T07–T08, CV2-T10, CV2-T15 |
| Guardian price pause cannot stop time/deadline return | No guardian/price branch; owner entry pause never gates exits | CV2-T22; separate guardian policy deferred |
| Owner configuration is prospective only | `entryLimits`, immutable tranche terms | CV2-T41, CV2-T45 |
| No borrowing, yield, protocol/rescue fee or arbitrary IFR withdrawal | No such entry point; full claim retired only to original depositor | CV2-T04, CV2-T20, CV2-T32 |
| Activation/entry require exemption and exact measured receipt | `_requireFeeExemption`, `lock` balance deltas | CV2-T16, CV2-T23–T24, CV2-T26.1/350/10000 |
| Revoked exemption stops entry; exits remain usable with disclosed tax | `lock`, `unlock`; measured net-credit event | CV2-T23, CV2-T25, CV2-T28 |
| SafeERC20 handles false/reverting transfer atomically | `lock`, `unlock` | CV2-T29.1–2, CV2-T30.1–2, CV2-T31 |
| CEI and reentrancy protection on external asset flows | `lock` reservations, `unlock` terminal state, `nonReentrant` | CV2-T43, CV2-T44.unlock/lock/pruneEntryHistory |
| Bounded loops; maintenance independent of lifetime history | `_pruneEntryHistory`, `pruneEntryHistory`, paginated `getTranches` | CV2-T37–T40 |
| Donations create no lock, larger claim or cap budget | All counters driven only by claims/entries | CV2-T32, CV2-T45 |
| Versioned lock, release, pause and ownership events | `Locked`, `Unlocked`, configuration/pause/cancel events, inherited ownership events | CV2-T07–T08, CV2-T11–T12, CV2-T15–T16, CV2-T20, CV2-T25 |
| Price evidence/release reason/rescue lifecycle events | Only TIME_ONLY deadline release exists; no price/rescue event is fabricated | CV2-T04; successor versioned reasons/evidence deferred |
| No proxy/arbitrary-call emergency escape | No such method/role | CV2-T04 |
| Ratified 100k/250k/1M/100k rolling-24h entry ceilings | Constants, `queueEntryConfiguration`, `lock`, exact entry history | CV2-T09, CV2-T33–T36 |
| Global/gross caps resist wallet/call splitting | Shared `totalLocked`, `unprunedEntryAmount` and entry history | CV2-T35–T37 |
| Release frees outstanding capacity, never refunds gross-entry spend | `unlock` changes only liability/count, not entry queue | CV2-T35, CV2-T40–T41, CV2-T46 |
| Inventory/migrate only new opt-in locks, no V1 transfer/approval reuse | `lock` uses caller's approval to this address only | CV2-T31, CV2-T47; live inventory deferred |
| Versioned UI and Benefits price exclusion | No UI, routing, ABI export or eligibility changes | Existing consumers unchanged; PL-C07 deferred |
| CV-01 reserves/funding/compensation kept separate | No reserve/funding/compensation action or balance references | CV2-T04, CV2-T47 |
| Invariant 1: claim sum = totalLocked; balance >= liability | `lock`, `unlock`, accounting mappings | `assertConservation` throughout, CV2-T32, CV2-T45 |
| Invariant 2: original recipient, exactly once | `unlock`, no recipient setter | CV2-T20, CV2-T30, CV2-T44–T45 |
| Invariant 3: finite immutable oracle-free deadline | `Tranche.unlockTime`, duration bounds, `unlock` | CV2-T18–T19, CV2-T22, CV2-T42 |
| Invariant 4: before-deadline valid execution-time price only | No predeadline release in this time-only slice | CV2-T19; actual price execution tests deferred |
| Invariant 5: no retroactive terms/source/rescue changes | No mutable term/source/rescue fields | CV2-T04, CV2-T41, CV2-T45 |
| Invariant 6: narrowly bounded early rescue | Entire power omitted | No claim of governed-rescue implementation |
| Invariant 7: exact active/outstanding/gross accounting | `activeLockCount`, `lockedBalance`, `totalLocked`, entry history | CV2-T34–T40, CV2-T45–T46 |
| Invariant 8: only accepted owner has admin; no withdrawal entitlement | Ownable2Step and fixed `unlock` recipient | CV2-T10–T14, CV2-T20 |
| Invariant 9: custody versions remain independent | No legacy contract reference | CV2-T47 |
| Invariant 10: nine-decimal integer amounts, no ambiguous multiplier | Constructor, `IFR_UNIT`, bigint tests, zero multiplier requirement | CV2-T03, CV2-T06, CV2-T16, CV2-T25–T27 |
| Future token-order/factory/wrap/stale/gap/manipulation tests | No adapter/pair in this scope | Deferred successor/fork acceptance plan, never counted as passing |
| Future rescue/guardian/staging/pinned-fork tests | No such roles/powers and no network used | Deferred; no skipped fork test claimed as evidence |
| Gate order PL-C01–07, review, full-window staging, evidence and separate authorization | Source tests cannot establish operational milestones | Ratified time-only policy; deployment dry-run added, activation evidence remains open |
| Fresh authoritative source/bytecode/owner/exemption/block/hash evidence | Constructor checks local metadata only, not chain identity/provenance | Deferred; no fresh mainnet assertions |

## Revert and standard coverage

| Custom error / requirement | Code symbol | Exact test prefix |
| --- | --- | --- |
| InvalidToken | constructor | CV2-T02, CV2-T03 |
| UnsupportedDecimals | constructor | CV2-T03 |
| PriceConditionsDisabled | lock | CV2-T05.1–3 |
| UnexpectedPriceParameter | lock | CV2-T06 |
| DepositsDisabled | lock | CV2-T15 |
| FeeExemptionRequired | _requireFeeExemption | CV2-T23, CV2-T24 |
| InvalidAmount | lock | CV2-T17 |
| InvalidUnlockTime | lock | CV2-T18 |
| TooManyActiveLocks | lock | CV2-T40 |
| InvalidEntryLimits | queueEntryConfiguration | CV2-T09 |
| EntryLimitExceeded | lock | CV2-T33–T36, CV2-T41 |
| EntryHistoryNeedsPruning | lock | CV2-T37 |
| InvalidBatchSize | pruneEntryHistory / getTranches | CV2-T38 |
| NoPendingConfiguration | execute/cancelEntryConfiguration | CV2-T07, CV2-T08, CV2-T15 |
| ConfigurationNotReady | executeEntryConfiguration | CV2-T07 |
| InvalidConfigurationNonce | executeEntryConfiguration | CV2-T08 |
| InvalidTranche | _getTranche | CV2-T20, CV2-T21, CV2-T47 |
| AlreadyUnlocked | unlock | CV2-T20, CV2-T45 |
| ConditionNotMet | unlock | CV2-T19 |
| ReceiptMismatch | lock | CV2-T26.1/350/10000 |
| InvalidOwnerNominee | transferOwnership | CV2-T12 |
| NoPendingOwnershipTransfer | cancelOwnershipTransfer | CV2-T12 |
| OwnershipRenunciationDisabled | renounceOwnership | CV2-T13 |
| OwnableInvalidOwner / OwnableUnauthorizedAccount | inherited Ownable / Ownable2Step | CV2-T02, CV2-T10–T12 |
| SafeERC20FailedOperation / token revert propagation | SafeERC20 | CV2-T29.1–2, CV2-T30.1–2, CV2-T31 |
| ReentrancyGuardReentrantCall | ReentrancyGuard | CV2-T43, CV2-T44.unlock/lock/pruneEntryHistory |
| NatSpec on new public/external methods, constructor, events and security fields | Contract/interface declarations; inherited OpenZeppelin role getters | Source review; compile |
| No new dependency/configuration/production-source changes | New files only | Working-tree review |

## Ratified interpretations and operational requirements

1. **PL-C01 / naming:** the owner selected this time-only `CommitmentVaultV2` deliverable
   versus a separately named price successor. The latter is not implemented.
   The already deployed V2 is not replaced and gains no new functions.
2. **PL-C02:** the shared price adapter interface, source/policy versions,
   absolute target/price limits, continuous-depth evidence, age/gap/deviation
   rules and economic attack analysis remain undecided. No consult-only oracle
   or existing two-endpoint candidate can stand in for those requirements.
3. **PL-C03:** early rescue is omitted entirely, leaving no administrative
   custody transfer entitlement. Incident continuity proof, exact action data,
   opt-in, windows, rolling/epoch budgets and cancellation need a separately
   scoped implementation if approved.
4. **PL-C04:** only the initial nonzero owner and its two-step successor are
   production roles. No guardian is installed in the ratified time-only scope.
   Production owner identity and its 48-hour public timelock must be verified
   separately; this constructor does not certify a supplied address as the
   approved controller. No deployer-only bypass exists.
5. **PL-C05:** one-day/1461-day durations, 50 active locks, the four entry
   ceilings and permissionless depositor-only return are ratified for time-only
   custody. Zero initial caps and the disabled initial flag prevent accidental entry.
6. **PL-C06:** strict incoming exact receipt is the conservative pilot rule;
   merely crediting a short receipt would contradict it. Exits accept a lower
   taxed net receipt without gross-up or requiring renewed exemption. This policy
   is ratified; provide the final disclosures before allowing deposits.
7. **PL-C07 / compatibility:** the old marking/30-day relayer path and unbounded
   `getTranches` ABI are deliberately absent from this release candidate. The requested
   filename is not permission to route any UI, SDK, Benefits or legacy address
   to it. Legacy inventory and fresh chain evidence remain future work.
8. **Entry operations:** bounded exact rolling accounting can require separate
   pruning calls after more than 50 historical entries expire. This maintenance
   interface is ratified; rehearse its UX before activation. It cannot prevent
   deadline exits. Queue expiry was not specified for ordinary entry configuration, so no expiry duration
   has been invented: it persists until execution, cancellation, replacement,
   pause or accepted ownership handover.
9. **Analyzer configuration:** Mythril includes 22 concrete contracts and
   Slither discovers 26 non-mock Solidity files, including all three release
   candidates. Six reviewed Slither signals remain baselined. Their configuration
   self-tests are not engine analysis or an external audit; no suppression is added.
10. **Release evidence:** no pinned fork, Sepolia, live metadata, full-window
    price rehearsal, independent review or economic audit was performed.
    Deterministic time-only tests do not satisfy the successor activation gates.

See the local delivery report at
`.fleet/reports/commitmentvault-v2-20261018.md` for exact verification commands,
results and the sandbox-only compiler-cache workaround.

## Owner ratification (2026-10-18)

The owner ratified every conservative interpretation and open-question default
listed above. Activation still requires the applicable evidence gates and a separate
Governance vote plus Treasury Safe signer approval. External audit is deferred
pending funding and a stable token price; no audited claim is made.
