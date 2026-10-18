# Governance V2 implementation notes

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

Authority boundaries remain defined in [GUARDIAN_SAFE_PLAN.md](GUARDIAN_SAFE_PLAN.md),
[GOVERNANCE_MIGRATION_PLAN.md](../GOVERNANCE_MIGRATION_PLAN.md) and
[CONTRACT_STANDARDS.md](../CONTRACT_STANDARDS.md).

Implementation: [GovernanceV2.sol](../../contracts/governance/GovernanceV2.sol).
Tests: [GovernanceV2.test.js](../../test/GovernanceV2.test.js). The additional
[MockGovernanceV2Target.sol](../../contracts/mocks/MockGovernanceV2Target.sol)
provides controlled return/revert/storage probes. Existing production contracts,
interfaces and dependency versions are unchanged. Release tooling is documented
in the activation runbook. Existing `MockReentrantToken`, `MockFeeOnTransferToken`,
`MockFalseReturnToken` and `InfernoToken` are reused without modification.

## Contract decisions and ABI

Constructor: `GovernanceV2(address initialOwner, address initialGuardian,
uint256 initialDelay)`. The deployer gains no implicit authority. The release candidate uses
the specification's ratified constants: `MIN_DELAY = 172800`,
`MAX_DELAY = 2592000`, `GRACE_PERIOD = 604800`, all in seconds. Initial delay is
explicit and validated within the same inclusive bounds as `setDelay`; use the
ratified 48-hour default unless a different bounded delay is explicitly approved.

Proposal IDs start at zero and are local to this controller. Their complete
identity is `(chainId, controller, id)`. The operation hash is:

```solidity
keccak256(abi.encode(
    block.chainid, address(this), id, target, keccak256(data), eta, expiresAt
))
```

All fields are stored permanently. `state(unknownId)` returns `Unset`;
`getProposal`, `execute` and authorized `cancel` revert for unknown IDs. The
explicit `getProposal` ABI follows the sketch; there is no additional mutable
proposal mapping interface. Expiry is exclusive: `eta <= timestamp < expiresAt`.
Executed/cancelled flags take precedence over time-derived state forever.

The contract inherits the existing OpenZeppelin `Ownable2Step` and
`ReentrancyGuard` implementations resolved by the lockfile (5.6.1). OZ's
`transferOwnership` has an owner-only modifier and no internal nomination hook.
Calling that implementation from a timelocked self-call would fail; relaxing
`_checkOwner` would also let the controller masquerade as proposer. Instead:

- Override `transferOwnership` with `onlySelf`, validated nomination storage and
  the inherited `OwnershipTransferStarted` event.
- Override the virtual `pendingOwner` getter to return that storage.
- Retain OZ's actual `acceptOwnership` authorization via `super`; it reads the
  virtual getter and calls the virtual `_transferOwnership` hook.
- Clear the nomination in that hook and retain OZ's owner storage and
  `OwnershipTransferred` event. The unused base pending slot remains zero.
- Emit `OwnershipTransferCancelled` when clearing/replacing a pending candidate;
  prohibit zero nomination and all renunciation. `_checkOwner` remains unchanged.

This is a controller-specific adaptation of the library, not an additional owner
setter or an immediate owner-only nomination route. The tests exercise both
EOA and contract acceptance, and a queued attempt to make the controller propose
on its own behalf.

## Capabilities

| Entry point | Active owner | Guardian | Pending owner | Other account |
| --- | --- | --- | --- | --- |
| `propose` | Yes | No | No | No |
| `execute` | Ready only | Ready only | Ready only | Ready only |
| `cancel` | Pending/Ready | Pending/Ready | No | No |
| `setDelay`, `setGuardian` | Queued self-call only | No | No | No |
| `transferOwnership`, `cancelOwnershipTransfer` | Queued self-call only | No | No | No |
| `acceptOwnership` | Only if also pending | No | Yes | No |
| `renounceOwnership` | Always reverts | Always reverts | Always reverts | Always reverts |

The guardian has no pause, burn, transfer, fee, asset-recovery or early-execution
entry point. It may execute a ready operation as an ordinary permissionless
executor. Cancellation censorship, including vetoing guardian replacement,
remains the expressly documented residual risk; there is no recovery bypass.

## Requirement traceability

Locations below refer to `contracts/governance/GovernanceV2.sol` unless another
file is named. Test titles are exact strings from `test/GovernanceV2.test.js`;
`<role>`, `<phase>`, `<delay>` and similar placeholders denote generated cases.

| Spec requirement | Code location | Test name / evidence |
| --- | --- | --- |
| G-01: active owner alone proposes | `propose`, inherited `onlyOwner` | `rejects proposal creation by <role>`; `initializes explicit roles, immutable bounds and a zero-based empty ID space without deployer privilege` |
| G-01: permissionless exact-call execution | `execute` | `allows <role> to execute exactly at ETA with exact result/event and zero-value CALL` (owner, guardian, user, pending owner, deployer) |
| G-02: immutable exclusive execution deadline | `propose`, `state`, `execute` | `derives expiry exactly without a transaction and rejects execute and cancel`; `does not revive a failing call after its immutable expiry` |
| G-03: hard 48-hour floor, 30-day ceiling, bounded constructor | Constants, constructor, `_validateDelay`, `setDelay` | `rejects constructor delay <delay>`; `accepts constructor inclusive delay boundary <delay>`; `rejects queued delay outside bounds: <delay>` |
| G-04: delayed two-step ownership, no old setter | `transferOwnership`, `acceptOwnership`, `_transferOwnership` | `nominates after delay, retains the old owner, and clears pending on acceptance`; `rejects every direct configuration/nomination path by <role>` |
| G-05: only delayed guardian rotation | `setGuardian`, `onlySelf` | `rotates guardian only after the full delay and transfers only cancellation privilege`; `lets guardian veto its own replacement without a bypass` |
| G-06: immediate owner/guardian veto, otherwise no guardian privilege | `cancel`, `onlySelf`, inherited `onlyOwner` | `allows <role> cancellation in <phase> and emits complete terminal evidence`; `rejects every direct configuration/nomination path by guardian`; `rejects proposal creation by guardian` |
| G-07: creation event, indexed ID/proposer/target, exact bytes/timing/hash | `ProposalCreated`, `propose` | `stores exact bytes, timestamps and domain hash and emits every creation field` |
| G-07: execution event with executor and complete result hash | `ProposalExecuted`, `execute` | `allows <role> to execute exactly at ETA with exact result/event and zero-value CALL`; `supports large returndata and hashes the complete ABI result` |
| G-07: cancellation identity and operation hash | `ProposalCancelled`, `cancel` | `allows <role> cancellation in <phase> and emits complete terminal evidence` |
| G-07: old/new delay and guardian events, including initialization | Constructor, `setDelay`, `setGuardian` | `emits constructor ownership, guardian and delay evidence`; `accepts delay ceiling and floor without rewriting prior timestamps or hashes`; `rotates guardian only after the full delay and transfers only cancellation privilege` |
| G-07: nomination, acceptance and cancellation/replacement evidence | `transferOwnership`, `_cancelPendingOwnership`, inherited ownership events | `nominates after delay, retains the old owner, and clears pending on acceptance`; `clears a replaced candidate with cancellation evidence and prevents stale acceptance`; `cancels a nomination only through delay and rejects stale acceptance` |
| G-08: one zero-value CALL; no batch/delegatecall/value/admin bypass | `execute` low-level `.call(p.data)`; nonpayable ABI | `exposes no ETH-value, executor-selected calldata, delegatecall or immediate admin entry point`; target storage/caller assertions in `allows <role> to execute exactly at ETA with exact result/event and zero-value CALL` |
| Constructor rejects zero/self owner and zero/overlapping guardian | Constructor, OZ `Ownable`, `_validateGuardian` | `rejects zero and self initial owners`; `rejects zero, owner-overlapping and self initial guardians` |
| No owner/guardian collapse after nomination or rotation | `_validateOwner`, `_validateGuardian` called at execution | `rejects zero, self and guardian nominees through queued calls`; `rejects zero, self, active-owner and pending-owner guardians` |
| Queued role changes revalidate the current separation invariant | `setGuardian`, `transferOwnership` | `revalidates role separation at execution when a nomination changes queued rotation validity`; `revalidates queued nomination against a later guardian rotation` |
| Only self may configure delay/guardian or nominate/cancel ownership | `onlySelf`, four configuration entry points | `rejects every direct configuration/nomination path by <role>` (including deployer and pending candidate) |
| Lifecycle 1: reject zero/code-less target and short selector | `_validateTarget`, `propose` | `rejects zero and code-less targets`; `rejects calldata shorter than a selector: <data>`; `accepts four-byte selectors without inventing a selector allowlist` |
| Lifecycle 2: monotonic ID, chain/controller scope and permanent exact bytes | `proposalCount`, `_proposals`, `propose`, `getProposal` | `assigns distinct increasing IDs and hashes to identical calls`; `separates operation hashes by chain, controller address and local ID`; `stores exact bytes, timestamps and domain hash and emits every creation field` |
| Lifecycle 2: ETA and grace snapshots | `propose` | `stores exact bytes, timestamps and domain hash and emits every creation field`; `accepts delay ceiling and floor without rewriting prior timestamps or hashes` |
| Lifecycle 3: Pending before ETA; Ready from ETA; Expired at expiry | `state` | `rejects execution at ETA minus one and leaves the proposal pending`; `allows <role> to execute exactly at ETA with exact result/event and zero-value CALL`; `allows execution at expiry minus one and retains Executed after expiry`; `derives expiry exactly without a transaction and rejects execute and cancel` |
| Lifecycle 4: recheck target code, CEI, global execution guard | `_validateTarget`, `execute`, OZ `nonReentrant` | `rechecks target code at execution and permits retry after code is restored`; `blocks same-proposal reentrancy from the existing malicious token and rolls back all effects`; `blocks other-proposal reentrancy from the existing malicious token and rolls back all effects` |
| Lifecycle 4: executor cannot select recipient/bytes/value/deadline or take a reward | `execute(uint256)` loads only stored fields | `exposes no ETH-value, executor-selected calldata, delegatecall or immediate admin entry point`; IFR recipient/pool/burn reconciliation tests |
| Lifecycle 5: raw target error propagation, atomic failure, retry before expiry | `execute` memory-safe raw revert | `bubbles raw custom errors, rolls back target writes, and permits a corrected retry`; `bubbles string reasons without wrapping the raw revert`; `bubbles empty revert data and leaves the action retryable`; `does not revive a failing call after its immutable expiry` |
| Lifecycle 6: cancel Pending/Ready, reject unknown/terminal/expired | `cancel`, `_existingState`, `state` | `allows <role> cancellation in <phase> and emits complete terminal evidence`; `reports Unset but rejects nonexistent reads, execution and cancellation`; `rejects repeated execution and cancellation of an executed action`; `derives expiry exactly without a transaction and rejects execute and cancel` |
| Lifecycle 6: cancellation/execute race follows transaction ordering | `cancel` and `execute` terminal-state checks | `permits cancellation at expiry minus one and resolves cancel-first ordering terminally`; `rejects repeated execution and cancellation of an executed action` (execute-first) |
| Lifecycle 7: re-propose with new ID/full delay; no resume or extension | `propose`, immutable stored timestamps, restricted ABI | `requires a new ID and full fresh delay to re-propose a <terminal> action`; `accepts delay ceiling and floor without rewriting prior timestamps or hashes`; `exposes no ETH-value, executor-selected calldata, delegatecall or immediate admin entry point` |
| Ownable2Step: only pending owner accepts, old owner remains active | `acceptOwnership`, inherited OZ acceptance | `rejects acceptance without a nomination for all roles`; `rejects acceptance by every account other than the nominated candidate`; `nominates after delay, retains the old owner, and clears pending on acceptance` |
| Ownable2Step: replacement/cancellation clear stale candidate | `transferOwnership`, `cancelOwnershipTransfer`, `_cancelPendingOwnership` | `clears a replaced candidate with cancellation evidence and prevents stale acceptance`; `cancels a nomination only through delay and rejects stale acceptance` |
| Ownership cancellation cannot undo completed acceptance | `cancelOwnershipTransfer` pending existence check | `does not undo acceptance if acceptance wins the race against queued cancellation`; `rejects cancellation when no nomination exists` |
| Disable renunciation and direct/inherited bypass | `renounceOwnership`, overridden transfer; unchanged `_checkOwner` | `disables renunciation for every role and for a queued self-call`; `cannot use a queued self-call to create proposals as though the controller were owner`; direct configuration matrix and ABI allowlist test |
| Already queued calls survive owner change | Permanent `_proposals` unaffected by ownership hooks | `leaves prior business proposals intact through ownership transfer and changes cancellation authority` |
| Contract owner can accept; future T2 child accepted by queued call | Inherited acceptance, `execute` | `allows a contract candidate to accept through an actual external call`; `accepts a new two-step child owner through the controller's exact queued CALL` |
| No ETH funding/value forwarding, even with forced balance | Nonpayable ABI, no receive/fallback, `.call` without value | `exposes no ETH-value, executor-selected calldata, delegatecall or immediate admin entry point` |
| Large return data and independent executors | `execute` full raw result and hash | `supports large returndata and hashes the complete ABI result`; execution role matrix |
| Malicious target cannot obtain configuration authority | `onlySelf` (not `tx.origin` or executor identity) | `does not grant a malicious target privileged configuration authority` |
| No Safe authentication inferred from code length | Explicit constructor roles; external acceptance requirement | EOA roles intentionally used by unit tests; real Safe identity/quorum verification is deferred, below |
| IFR retains nine decimals; no approximate token arithmetic | No token math/ledger in controller; integration tests use `bigint` and balance deltas | `reconciles actual IFR balance deltas at nine decimals with fee exemption false`; corresponding `true` case; `reuses the fee-on-transfer mock and never treats a transfer's boolean return as a receipt amount` |
| Migration does not silently alter fees/receiver/exemptions or existing code | New files only; no automatic migration/funding | IFR integration asserts original fee rates and nine decimals; every remaining migration requirement is deferred below |

### Invariants

| Spec invariant | Code location | Test name / evidence |
| --- | --- | --- |
| 1: one successful exact, ready, uncancelled, unexpired execution | `execute`, `state`, immutable proposal record | Execution role/boundary matrix; `rejects repeated execution and cancellation of an executed action`; cancellation terminal cases |
| 2: immutable floor and fixed deadlines despite reconfiguration | Constants, `propose`, `setDelay` | `accepts delay ceiling and floor without rewriting prior timestamps or hashes`; `leaves prior business proposals intact through ownership transfer and changes cancellation authority` |
| 3: guardian only reduces executable set | `cancel`, `onlySelf`, `onlyOwner` | Guardian role-negative cases; `lets guardian veto its own replacement without a bypass`; `lets guardian cancel ownership proposals without acquiring ownership` |
| 4: failure commits no lifecycle state; no nested execution | `execute` CEI, revert bubbling, global guard | Custom-error rollback/retry test and both malicious token reentrancy tests |
| 5: only pending accepts; no zero/self/overlap/renunciation/bypass | Ownership overrides, inherited acceptance, validation helpers | Entire `Ownable2Step handover without inherited bypasses` group and role-overlap tests |
| 6: migration preserves custody, locks, economics and decimals | No migration or production edits | Partial local evidence: IFR balance-delta/fee tests; full inventory rehearsal deferred |
| 7: G2 does not repair immutable G1 or hide T1/FeeRouter limits | Separate new contract and domain; no legacy edits | Domain-hash separation and local T1 token test; pinned deployed G1/FeeRouter rehearsal deferred |

### Custom-error and revert coverage

| Error / revert | Test name |
| --- | --- |
| `OnlySelf` | `rejects every direct configuration/nomination path by <role>`; `does not grant a malicious target privileged configuration authority` |
| `UnauthorizedCancellation` | `rejects cancellation by <role>`; guardian rotation and ownership handover cancellation-authority cases |
| `InvalidGuardian` | Constructor guardian rejection; `rejects zero, self, active-owner and pending-owner guardians`; execution-time role drift case |
| `DelayOutOfBounds` | All constructor/queued bounds cases |
| `InvalidTarget` | `rejects zero and code-less targets`; `rechecks target code at execution and permits retry after code is restored` |
| `InvalidCalldata` | `rejects calldata shorter than a selector: <data>` (all lengths 0 through 3) |
| `ProposalNotFound` | `reports Unset but rejects nonexistent reads, execution and cancellation` |
| `InvalidProposalState` | Pending, Executed, Cancelled and Expired execution; Executed, Cancelled and Expired cancellation cases |
| `NoPendingOwnershipTransfer` | `rejects cancellation when no nomination exists`; acceptance-before-cancellation ordering case |
| `RenunciationDisabled` | `disables renunciation for every role and for a queued self-call` |
| OZ `OwnableInvalidOwner` | Zero/self constructor owner; zero/self/guardian queued nominees; nomination/guardian drift case |
| OZ `OwnableUnauthorizedAccount` | Proposal access matrix; acceptance role matrices; stale/replaced/cancelled/accepted nominees; queued self-propose bypass case |
| OZ `ReentrancyGuardReentrantCall` | Both existing malicious-token nested-execution cases, with explicit gas limits to exercise mined reverting transactions |
| Target `TargetFailure`, `Error(string)`, empty data | Three raw propagation tests; custom-error case uses an explicit gas limit to verify mined rollback of target writes |
| Solidity nonpayable entry checks | `exposes no ETH-value, executor-selected calldata, delegatecall or immediate admin entry point` |

## Accounting boundary

G2 is a generic timelock, with no deposit, internal balance ledger, swap quote,
asset-recovery wrapper or token-receipt event. Its execution result hash is a
hash of raw target return data, never an assertion of value received. Adding a
receipt ledger or a new asset API would exceed the specification.

Tests measure the actual incoming G2 balance delta and outgoing recipient delta
using integer `bigint`, including non-round amounts, values above the JavaScript
safe-integer range, tax rounding, both endpoint-exempt and taxed IFR transfers,
pool credits and supply burns. The existing fee/reentrancy mocks are reused.
No `number` conversion is applied to token values. Timestamp conversions alone
use `Number` to satisfy the local JSON-RPC timestamp API.

Raw CALL semantics cannot interpret arbitrary return bytes as an ERC-20 boolean:
a `false` return is a successful EVM CALL and therefore completes the operation.
This behavior is explicitly tested and requires target-level semantics review.
Future asset-moving target contracts must use SafeERC20/balance-delta accounting
as required by the standards; this release candidate adds no special token execution path.

## Requirements deliberately left to later approval and rehearsal

These are acceptance requirements of the source documents, not implemented
protocol features or claims satisfied by the local unit suite:

| Requirement | Code boundary / present evidence | Missing future evidence |
| --- | --- | --- |
| Treasury Safe owner and separate exactly 2-of-3 Guardian Safe | Explicit role arguments and address separation only | Approved Safe singleton/proxy identity, public signer consent/independence, exact owners/threshold, modules/guard/fallback handler, fresh block-bound code hashes |
| Guardian signer authentication/replay and cancellation operations | `cancel` checks the calling Safe address only | Actual Safe 1-signature rejection, 2-signature success, outsider failure, nonce/chain replay tests, monitoring ownership and response drill |
| No cancel Safe pause/burn/admin/custody power elsewhere | G2 provides only the documented cancellation privilege | Guardian plan's eight legacy-role rows must be freshly read; do not reassign any vault/pause/burn roles to C |
| Ratified numeric floor/ceiling/grace and initial delay | Constants match owner ratification | Exact reviewed build and constructor arguments |
| Ten movable legacy control roles | No migration actions; local IFR legacy T1 integration only | Pinned deployed-bytecode rehearsals for BuilderRegistry, CommitmentVault V1/V2, LendingVault V1, PartnerVault, BuybackVault V1, BuybackController, BurnReserve, LiquidityReserve, InfernoToken; per-row positive/negative and unchanged-state checks |
| Preserve custody and locks; disabled LendingVault/price paths | No existing production file changes | Recorded balances, tranches, fees, receiver/exemptions, lock parameters, disabled-price/readiness assertions at pinned blocks |
| G1 root handoff and FeeRouter fixed pointer | G2 can queue exact generic calls; IDs/hashes are controller-scoped | Council T1 exception/bridge decision; deployed G1 immediate `onlyOwner setOwner` evidence; drained G1 queue; nested G2/G1 timelocks, separate IDs, legacy cancellation, partial migration and reverse-handoff tests |
| New BuybackVault T2 and operational guardian | Local G2-to-G2 test proves actual queued contract acceptance without inventing V1 ABI | Reviewed new-vault implementation, pause guardian separately approved, exact nomination/acceptance rehearsal while inactive/unfunded |
| IFRLock, Vesting, BootstrapVaultV3 remain outside owner migration | No changes/calls to them | Explicit unchanged custody/guardian/permanently retained LP evidence in full migration rehearsal |
| Build provenance JUL-21 | Existing compiler config, lockfile and local build-info available | Reviewed source commit, exact compiler/dependency digests/settings, ABI/storage layout, initcode/runtime/constructor metadata, independent review, verification matches and deployment receipts |
| Fresh authoritative live state | No network or live transactions used | Canonical block/hash, code/role/queue/balance inventory and discrepancy resolution |
| Safe creation, deployment, funding/exemption, activation and publication | Guarded deployment script; no live changes | Each remains a separate action-specific approval; preserve new-vault 60-day activation and separate Controller replacement scope |
| Mainnet-fork and Sepolia acceptance, exact-head CI and independent review | Local Hardhat tests only | Network-authorized pinned deployed-bytecode fork, actual Safe-quorum Sepolia rehearsal, review artifacts, CI and later per-step final receipts |

The repository G1 source has a timelocked `setOwner` fix; the specification says
deployed G1 uses immediate `onlyOwner`. Testing current source as if it were the
pinned deployed bridge would give misleading evidence. No such substitution is
made here, and no legacy `acceptOwnership` or FeeRouter setter is invented.

## Ratified interpretations and operational requirements

1. **Ratified timing.** The 48-hour floor, 30-day ceiling and seven-day
   grace period match the owner decision. Changing an immutable constant
   requires a newly reviewed release. Re-submissions reference expired proposals
   in the off-chain dossier, with a fresh ID and full delay; see the specification.
2. **Safe verification.** The specification explicitly rejects code length as
   proof of Safe identity. No generic constructor inspection or hardcoded live
   addresses are invented. Approved identities, signer sets and quorum must be
   established by the separate deployment acceptance gate. EOAs are permitted
   for local unit tests, not asserted to meet deployment policy.
3. **Guardian equal to G2 itself.** The spec explicitly disallows a self owner
   but does not separately state a self-guardian rule. Conservatively reject a
   self guardian as well: G2 cannot serve as an independently signing veto Safe.
4. **Unknown reads and ABI details.** The interface sketch leaves revert types,
   starting ID and storage layout open. IDs start at zero; `state` returns
   `Unset` for missing IDs and record reads revert rather than fabricate an
   authorization record. Custom errors carry the failing ID/address/state.
   Hash encoding is the explicit `abi.encode` tuple above, not packed encoding.
5. **Cancellation with no pending nominee.** Conservatively revert instead of
   emitting a fictitious cancellation. Replacement emits cancellation of the
   old pending address before the new nomination event. No new event is emitted
   merely because time passes or a reverted transaction made no state change.
6. **No candidate-bound cancellation in the sketch.** `cancelOwnershipTransfer()`
   clears whichever nominee is pending at execution, as the specified ABI
   implies. Acceptance winning first makes cancellation revert. If Council wants
   a cancellation bound to one expected nominee, that needs a spec/ABI decision;
   no extra argument or hidden policy was added.
7. **No pending-owner nomination expiry.** The spec expires proposals, not an
   already executed nomination. Pending ownership persists until acceptance,
   delayed replacement or delayed cancellation; no unilateral decline/timeout
   or immediate owner bypass is added.
8. **Generic CALL versus asset-success semantics.** A target returning `false`
   does not revert. Arbitrary returndata cannot safely be assumed to be an
   ERC-20 bool. No selector allowlist, special ERC-20 branch, receipt ledger,
   executor reward or sweep is introduced. Any desire to enforce token-specific
   success in G2 requires an explicit spec change or an approved target adapter.
9. **Return-data bounds.** No size cap is specified. Full raw bytes are returned
   and hashed; a 64-KiB payload is tested. Gas limits still constrain execution,
   and malicious target behavior needs exact-call review.
10. **Censorship recovery and stale target preconditions.** No emergency owner,
    guardian-replacement shortcut, deadline extension, uncancel or resume exists.
    Target-specific preconditions/deadlines must be encoded in the queued call;
    Safe monitoring and the cancellation-censorship incident policy remain
    Council/operational decisions.

## Audit gate impact and local verification

The current analyzer configuration includes all three release candidates:
Mythril enumerates 22 concrete contracts and Slither discovers 26 non-mock
Solidity files. The checked-in Slither baseline contains six reviewed signals.
Run `npm run test:mythril` and `npm run test:slither-baseline` for configuration
consistency; these are not engine analysis or an external audit. The release
changes no executable Solidity logic and does not expand suppressions.

## Owner ratification (2026-10-18)

The owner ratified the conservative behavior for every interpretation above:

- Timing: 48-hour minimum delay, 30-day maximum, 7-day grace period, immutable. An
  expired proposal can always be re-submitted as a new proposal that references the
  expired one; no revival of the expired ID.
- Owner (Treasury Safe), guardian (separate cancel-only 2-of-3 Safe), signer sets and
  thresholds are fixed and verified only in the deployment acceptance gate.
- A pending ownership nomination does not expire; the current owner stays until
  acceptance, delayed replacement or delayed cancellation.
- No emergency owner, guardian-replacement shortcut, deadline extension, uncancel or
  resume. Guardian censorship is handled operationally (trusted, reachable guardian
  members, monitoring, re-proposal).

This ratifies release-candidate policy. Deployment/activation requires separate
Governance and Treasury Safe approval. External audit is deferred pending funding
and a stable token price; no audited claim is made.
