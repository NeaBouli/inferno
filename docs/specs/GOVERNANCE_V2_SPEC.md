# Governance V2 Specification

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

## Authority, scope and evidence

Gio's decisions of 17 October 2026 authorize planning a Governance replacement and
BuybackVault redeploy, require Ownable2Step-style ownership in every future
contract, and select a separate cancel-only guardian Safe with a 2-of-3 threshold.
Deployment and migration require later action-specific Council decisions.
Numerical defaults were ratified by the owner on 18 October 2026; exact deployment
identities, constructor arguments and migration actions still require approval.

This is a replacement timelock, not a token-voting system. The Treasury Safe
remains the ratified proposer/owner; Forum signals and Council decisions do not
themselves execute transactions. No token migration, fee change, LendingVault
activation, price-lock activation or BuybackController redeploy is included.

Evidence reviewed at repository commit
`9c0f5352c31cf4c7db595ac444a8464db3125b88`:

- [CWA register](../community-audits/cwa-remediation-register.json): CWA-25,
  CWA-26, CWA-16, CWA-09 and CWA-62.
- [July register](../community-audits/july-2026-remediation-register.json):
  JUL-06, JUL-08, JUL-21 and JUL-23.
- [Lane 3](../GOVERNANCE_PRODUCT_DECISION_REGISTER.md#lane-3--feerouter-sinkaccrual-and-governanceguardian-redeployment),
  [deployment record](../DEPLOYMENTS.md),
  [guardian migration](../GUARDIAN_MIGRATION.md), and
  [mainnet manifest](../../deployments/mainnet.json).
- [Governance source](../../contracts/governance/Governance.sol) and the
  [deployed-source audit](../community-audits/CWA_IFR_Contracts_Deep_Audit_2026-09-14.md).

These are dated repository observations, not fresh chain attestations. Public
RPC DNS resolution failed and explorer access was unavailable in this writing
session. Every address, role, balance, queued proposal and code identity must be
re-read at a recorded mainnet block before execution. A discrepancy blocks the
affected step; it must not be resolved by assuming repository HEAD is deployed.

## Requirements and changes from deployed Governance

`G1` means the existing mainnet Governance; `G2` means the proposed replacement,
whose address is not assigned. Existing G1 is recorded at
`0xc43d48E7FDA576C5022d0670B652A622E8caD041`.

| ID | Deployed G1 / source distinction | Required G2 behavior |
| --- | --- | --- |
| G-01 | Owner proposes and executes | Only the owner proposes; anyone can execute the exact queued call after its delay |
| G-02 | No proposal expiry | Each proposal snapshots an immutable execution deadline; expired proposals cannot execute |
| G-03 | One-hour minimum, documented configured delay 48 hours | Enforce a hard minimum; recommended floor and initial delay 48 hours, maximum 30 days |
| G-04 | Deployed `setOwner` is immediate `onlyOwner` (CWA-25); repository W1 fix uses `onlySelf` | Ownership nomination must be a timelocked self-call, followed by acceptance from the pending owner |
| G-05 | `setGuardian` is immediate `onlyOwner` (CWA-62 exception) | Guardian rotation must be a timelocked self-call; no immediate guardian-rotation bypass |
| G-06 | Owner or guardian can immediately cancel | Retain immediate cancellation, with a separate 2-of-3 Safe as guardian; guardian has no other protocol power |
| G-07 | Minimal proposal and configuration events | Emit complete lifecycle, ownership and configuration evidence |
| G-08 | Arbitrary zero-value target call | Preserve zero-value `CALL` only; no `delegatecall`, executor-selected calldata or generic immediate admin execution |

The W1 source fix is necessary but does not supply expiry, permissionless execute
or two-step ownership. None of these changes modifies G1 in place. G1's existing
guardian rotation and deployed owner-rotation exceptions remain until the legacy
control path has moved; public descriptions must retain those exceptions.

## Roles and configuration

| Role / setting | Proposed value or rule |
| --- | --- |
| Initial owner/proposer | Treasury Safe `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`, documented 3-of-5; verify actual owners, threshold and modules |
| Guardian | New, separately deployed [Guardian Safe](GUARDIAN_SAFE_PLAN.md), exactly 2-of-3 |
| Executor | Any account, including the Safe, an independent keeper or a user |
| `MIN_DELAY` | Immutable 48 hours, ratified 2026-10-18; never reducible by any role |
| `MAX_DELAY` | Immutable 30 days, ratified retention of the existing ceiling |
| Initial `delay` | 48 hours, ratified; subject to the hard floor |
| `GRACE_PERIOD` | Immutable 7 days after ETA, ratified 2026-10-18 |

Constructor validation must reject zero owner/guardian, invalid delay bounds and
an owner equal to the guardian. The deployment acceptance check must establish
that the two addresses are the approved Safes with the approved signer sets.
`code.length` alone does not establish Safe identity or signer independence.
Subsequent nominations and guardian rotations must preserve that separation:
reject G2 itself as its own owner, reject the guardian as pending owner, and
reject a guardian equal to the current or pending owner. Otherwise a self-owned
proposer could become unable to create proposals, or a rotation could collapse
the intended independent veto.

Only a queued call from G2 to itself may change `delay`, nominate an owner,
cancel an ownership nomination or rotate the guardian. Such changes use the
delay in force when their proposal was created. The guardian may cancel them
before execution but may not appoint itself, propose, execute early, pause G2,
set a delay, move funds or acquire an ownership role. A guardian member may call
permissionless execute as any other account, gaining no privileged execution.

## Proposal lifecycle

1. `propose(target, data)` is owner-only. Reject zero or code-less targets and
   calldata shorter than a selector. This specification supports one contract
   call with value zero per proposal; batched execution is not included.
2. Assign a monotonically increasing ID, scoped to chain ID and G2 address.
   Snapshot `eta = block.timestamp + delay` and
   `expiresAt = eta + GRACE_PERIOD`. Store target and exact calldata permanently.
   Compute an operation hash over chain ID, G2 address, ID, target, calldata hash,
   ETA and expiry. G1 and G2 proposal IDs must never be conflated.
3. State is `Pending` before ETA, `Ready` for `eta <= timestamp < expiresAt`,
   and `Expired` at or after expiry, unless already executed or cancelled.
   Expiry is derived from time and needs no transaction.
4. `execute(id)` is permissionless only in `Ready`. Re-check the target has
   code, mark the operation executed before the external call, and guard the
   execution entry point against reentrancy. The caller cannot replace calldata,
   target, recipient, deadline or value, and receives no executor fee.
5. A target revert must bubble its raw revert data and revert the whole
   transaction, including the executed marker. Retry remains possible until
   expiry; no swallowed failure or partial completion is allowed.
6. `cancel(id)` is callable immediately by the owner or guardian for a pending
   or ready proposal. Cancellation is terminal. Reject nonexistent, executed,
   cancelled and expired IDs. Cancellation after ETA is valid until execution;
   a cancellation/execute transaction race is resolved by chain ordering.
7. Re-proposing an expired or cancelled action creates a new ID and a fresh
   full delay. Delay changes cannot reschedule existing proposals. There is no
   resume, uncancel, expiry extension or emergency execute path.

The queued bytes provide authorization; permissionless execution provides
liveness, not renewed policy consent. Time-sensitive actions must carry target
preconditions and a bounded deadline. An expired outer proposal must be freshly
reviewed even if the underlying legacy G1 proposal has no expiry.

## Interface sketch

Illustrative ABI only; this fenced sketch is not a contract implementation.
Revert types and storage layout must be finalized during implementation review.

```solidity
enum ProposalState { Unset, Pending, Ready, Executed, Cancelled, Expired }

function owner() external view returns (address);
function pendingOwner() external view returns (address);
function guardian() external view returns (address);
function delay() external view returns (uint256);
function MIN_DELAY() external view returns (uint256);
function MAX_DELAY() external view returns (uint256);
function GRACE_PERIOD() external view returns (uint256);
function proposalCount() external view returns (uint256);
function propose(address target, bytes calldata data) external returns (uint256 id);
function execute(uint256 id) external returns (bytes memory result);
function cancel(uint256 id) external;
function state(uint256 id) external view returns (ProposalState);
function getProposal(uint256 id) external view returns (
    address target, bytes memory data, uint256 eta, uint256 expiresAt,
    bytes32 operationHash, bool executed, bool cancelled
);
function setDelay(uint256 newDelay) external; // onlySelf, through execute
function setGuardian(address newGuardian) external; // onlySelf, through execute
function transferOwnership(address newOwner) external; // onlySelf nomination
function acceptOwnership() external; // pending owner only
function cancelOwnershipTransfer() external; // onlySelf, through execute
```

Do not retain an immediate `setOwner` alias or inherited owner-only path around
the self-call restriction. Disable renunciation; do not allow zero-address
nomination. An ownership nomination leaves the old owner active until the
pending owner accepts. Nomination replacement/cancellation must clear the old
pending address; a stale candidate can never accept afterward. Cancellation
cannot undo an already accepted transfer or beat a prior acceptance transaction.

Required events:

- `ProposalCreated`: indexed ID, proposer and target; full calldata, ETA, expiry
  and operation hash as event data.
- `ProposalExecuted`: indexed ID and executor, operation hash and result hash.
- `ProposalCancelled`: indexed ID and cancelling account, operation hash.
- `DelayUpdated`: old and new delay.
- `GuardianUpdated`: indexed old and new guardian.
- `OwnershipTransferStarted`, `OwnershipTransferred` and
  `OwnershipTransferCancelled`: old/current owner and pending/new owner.

An expiry event is not required: no transaction occurs merely because time
passes. Indexers derive expiry from stored timestamps and canonical block time.

## Governed-contract inventory and ownership migration

The following inventory records documented G1 control, including legacy and
retired contracts. All full addresses come from the mainnet deployment record.
`T1` means an immutable legacy single-step handoff executed by G1 after its
timelock, with explicit Council acceptance of that limitation. `T2` means a true
two-step nomination and acceptance in a future contract. A waiting period plus
two off-chain approvals does not turn T1 into Ownable2Step.

| Contract | Documented mainnet address | Present role | Planned control path |
| --- | --- | --- | --- |
| InfernoToken | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` | `owner = G1` | T1 `transferOwnership(G2)`; keep the existing token and nine decimals |
| LiquidityReserve | `0xdc0309804803b3A105154f6073061E3185018f64` | `owner = G1` | T1 `transferOwnership(G2)`; retain balances, locks and withdrawal caps |
| BurnReserve | `0xaA1496133B6c274190A2113410B501C5802b6fCF` | `owner = G1` | T1 `transferOwnership(G2)`; guardian burn authority is separate |
| BuybackVault, existing | `0x670D293e3D65f96171c10DdC8d88B96b0570F812` | `owner = G1` | T1 `transferOwnership(G2)` for legacy control; remain dormant, without assuming a sweep function |
| PartnerVault | `0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D` | `admin = G1` | T1 `setAdmin(G2)`; do not change guardian or authorized callers as a side effect |
| BuilderRegistry | `0xdfe6636DA47F8949330697e1dC5391267CEf0EE3` | `owner = G1` | T1 `transferOwnership(G2)` |
| CommitmentVault V1 | `0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3` | `owner = G1` | T1 `transferOwnership(G2)`; existing tranches stay at V1 |
| CommitmentVault V2 | `0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F` | `owner = G1` | T1 `transferOwnership(G2)`; existing TIME_ONLY custody stays at V2 |
| LendingVault V1 | `0x974305Ab0EC905172e697271C3d7d385194EB9DF` | `owner = G1` | T1 `transferOwnership(G2)`; borrowing remains disabled, no price activation |
| BuybackController | `0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c` | `owner = G1` | T1 `transferOwnership(G2)`; no buyback execution or redeploy in this scope |
| FeeRouterV1 | `0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a` | `governance = G1` | No setter exists; retain G1 as a controlled legacy bridge, subject to Council approval |

FeeRouterV1's pointer is effectively fixed by its interface, although its source
declares ordinary storage rather than Solidity `immutable`. Do not invent a
`setGovernance` or `acceptOwnership` call. Retiring G1 without accounting for this
pointer strands FeeRouter administration.

Proposed legacy bridge: after all direct children have moved and all stale G1
proposals are cancelled, Treasury Safe transfers G1's own owner role to G2.
Deployed G1 only offers immediate, single-step `setOwner(G2)`; this last step
requires an explicit legacy exception and an announced operational wait. It
cannot be made an on-chain timelocked G1 self-call: deployed `onlyOwner` rejects
G1 calling itself. Thereafter G2 separately timelocks calls to G1 `propose` and
`execute`, and G1 enforces its own delay. G1 remains deployed, its ID space stays
separate, and its remaining guardian can cancel its proposals. See the
[migration plan](../GOVERNANCE_MIGRATION_PLAN.md) for sequencing and alternatives.

The replacement BuybackVault uses T2: its initial Treasury Safe owner nominates
G2; G2 queues and executes `acceptOwnership()` on the new vault. G2's own future
owner changes use timelocked nomination followed by pending-owner acceptance.
The old owner retains control until acceptance in every new contract.

For inventory completeness, IFRLock `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb`
and Vesting `0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271` have guardian roles,
not G1 owner roles. BootstrapVaultV3
`0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141` has no transferable owner role.
Their user custody and permanently retained LP are outside this migration.

## Invariants

1. Every successful G2 target call has one matching, unexpired, uncancelled
   proposal whose stored ETA has passed and whose exact bytes were executed once.
2. All proposal ETAs use a delay at least `MIN_DELAY`; all deadlines are fixed at
   creation. No later delay, role or ownership change rewrites these values.
3. A guardian can only reduce the set of executable proposals by cancellation.
   It cannot expand privileges, execute early, change parameters or receive assets.
4. A failed target call commits no lifecycle state. A reentrant target cannot
   double-execute or execute another proposal through nested execution.
5. Only the pending owner can accept; nomination alone changes no active owner.
   Zero/self owner, overlap with the guardian, renunciation and an immediate
   owner-setting bypass are impossible.
6. Migration changes control pointers only. User balances, lock conditions,
   fee rates, token decimals and custody addresses are unchanged.
7. Governance replacement does not repair immutable legacy code. Every retained
   T1 pointer and the FeeRouter bridge are disclosed and tested separately.

## Threat model

| Threat / trust boundary | Required control and residual risk |
| --- | --- |
| Compromised proposer Safe quorum | Full delay, immutable floor, public exact-calldata review and independent cancellation; an honest guardian must react before execution |
| Compromised guardian quorum | Cancel-only prevents theft; cancellation censorship remains possible, including censorship of guardian replacement; Council must decide the operational recovery policy |
| Shared signer/device compromise | Independent guardian signers and custody; two Safe addresses alone do not remove correlated compromise |
| MEV/front-running of execution | Execution bytes cannot change; target-level preconditions and deadlines still matter; a ready action can execute before a cancellation lands |
| Stale operation / configuration drift | Expiry, fresh snapshots and exact-content checks; already queued proposals survive owner changes unless explicitly cancelled |
| Malicious or upgradeable target | `CALL`, no delegated storage access, reentrancy protection and code/proxy identity review; a timelock is not proof that the target is safe |
| Lost proposer keys / no keeper | Permissionless execute keeps ready actions live; new proposals still need the owner quorum; no secret emergency owner bypass |
| Migration address error / partial handoff | Full-address manifests, fork rehearsals, per-child receipts and T2 for new contracts; legacy T1 mistakes may require another full timelock or be unrecoverable |
| Legacy G1 / FeeRouter boundary | Drain old queue, preserve the bridge explicitly, retain deployed W1 exception disclosure; no assumption that G1 gains G2 expiry or ownership acceptance |

## Test and acceptance plan

Implementation acceptance requires new lifecycle and adversarial tests, not
merely the existing [G1 tests](../../test/Governance.test.js).

- Exercise every role against every mutating entry point; verify a random account
  can execute a ready proposal but cannot propose, cancel or alter ownership.
- Check ETA minus one, ETA exactly, expiry minus one and expiry exactly; check
  nonexistent IDs, repeated execution/cancellation, cancellation after ETA,
  fresh delay on re-proposal and multiple proposals with identical calldata.
- Test constructor and `setDelay` at the floor, ceiling and outside both; lower
  and increase delay with previously queued proposals and verify snapshot values.
- Test timelocked guardian replacement and ownership nomination; reject direct
  owner calls, stale candidates, zero/self nominees, owner/guardian overlap and
  renunciation. Test pending-owner rejection, replacement, cancellation and
  acceptance transaction ordering.
- Assert complete event fields and operation hashes, chain/address separation,
  raw custom-error propagation and atomic state rollback on target revert.
- Use malicious/reentrant targets, code-less targets, large returndata and
  independent executors; test that no ETH-value or delegatecall path exists.
- Rehearse every inventory row against pinned deployed bytecode on a mainnet
  fork. Include FeeRouter nested governance, legacy `setOwner` access rules,
  stale queue cancellation, partial migration, reverse handoffs and new-vault T2.
- Rehearse approved equivalents on Sepolia with both Safe thresholds, then
  archive build inputs, receipts, timestamps, role reads and negative probes.
- Obtain contract and migration review before any Council deployment
  decision; external audit is deferred pending funding and must be disclosed.
  A specification or source-only test does not close CWA-25/26 or JUL-23.

## Ratified policy and remaining operational decisions

The 48-hour floor, 30-day ceiling and seven-day grace period are ratified. Approve the
legacy T1 exceptions and FeeRouter bridge or a separately specified FeeRouter
replacement; select guardian signers and a cancellation-censorship recovery
policy; approve deployment identities, rehearsal evidence and each migration
step. The [BuybackVault specification](BUYBACKVAULT_REDEPLOY_SPEC.md) has separate
funding and activation decisions.

## Expired-proposal re-submission policy

An expired action may be submitted through `propose(target, data)` as a new ID
with a fresh full delay and execution window. The proposal dossier must reference
the expired `(chainId, controller, id)` and operation hash and explain the renewed
review. This reference is off-chain policy, not an extra target-calldata field or
a revival of the old ID. Existing lifecycle tests cover fresh IDs, timing and
permanent expiry; no ABI or execution-semantics change is required.
