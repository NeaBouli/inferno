# Contract Engineering Standards

**Owner decision:** 17 October 2026. Ownable2Step-style ownership transfer is
mandatory for every future contract with an ownership or equivalent admin role.
These standards guide future implementation and review; they do not deploy,
upgrade or authorize changes to an existing contract.

## Ownership and privileged roles

- Use an explicitly initialized, nonzero owner and true two-step ownership:
  current owner nominates `pendingOwner`; only that pending address accepts;
  the current owner remains active until acceptance. Apply equivalent semantics
  to replacement admin/governance roles, not only a role named `owner`.
- Provide explicit pending-transfer cancellation/replacement and clear pending
  state on acceptance. Reject zero nominees, stale candidates and unauthorized
  acceptance. Emit nomination, acceptance and cancellation events. For the
  governance controller, disable renunciation and direct owner-setting aliases.
- Production protocol contracts must end with the approved governance controller
  as owner/admin. Prove a contract recipient can actually accept through a queued
  call. An EOA deployment operator must have no hidden bootstrap privilege.
- On the governance controller, ownership nomination, cancellation/replacement,
  delay and guardian changes must pass its own timelock. On governed children,
  owner-only changes are called by that controller through its timelock.
  A library's default owner-only transfer must not bypass controller self-call
  requirements. Pending-owner acceptance is distinct from nomination.
- Define a capability table for every role. Separate proposer, executor,
  cancellation, pause/resume, burn and custody permissions. A cancel-only guardian
  receives none of the other roles. Document every immediate exception.
- Existing deployed single-step contracts cannot acquire an acceptance method
  through documentation. Require an explicit Council-approved legacy exception
  and contract-specific migration tests; every new replacement must meet this
  standard. No fabricated `acceptOwnership`, guardian setter or upgrade path.

## Bounded administration

No unbounded admin powers: every numeric setting needs on-chain minimum/maximum
constraints, units, rationale, defaults, boundary tests and a defined effect on
already committed state. Validate constructor values with the same rules as
setters. The owner must not be able to disable protection by selecting zero,
100% slippage, unlimited budgets or an arbitrarily short delay.

Address setters need nonzero checks, role/asset identity validation, events and
timelocked authorization. For routers/oracles, bound the permitted destination
and trust model; code existence alone does not establish safe behavior. An
unrestricted call/delegatecall, sweep, proxy upgrade, arbitrary mint or bypass
role must not be added as an emergency convenience. Any required asset-recovery
or upgrade authority needs its own bounded specification and explicit approval.

User asset custody, token economics, irreversible burns and rescue/unlock
rights need explicit invariants. A migration changes only the approved pointers;
it must not silently change fee rates, recipients, lock conditions or ownership
of user assets. IFR uses nine decimals: preserve integer base units and use
`bigint` in tooling; never round balances or eligibility through JavaScript
`number`.

## NatSpec and events

Every public/external entry point, constructor, privileged role, event and
security-relevant constant/state field needs accurate NatSpec. Document:

- Purpose, authorized caller, parameters/returns, units and rounding.
- Hard bounds, activation/delay/expiry rules, external-call trust assumptions,
  state transitions, failure conditions and irreversible effects.
- Whether a reported amount is quoted, debited, received, recipient-credited,
  held in a reserve or actually burned from supply.
- Which source/build version the description covers; source fixes do not imply
  that deployed mainnet behavior has changed.

Emit events for every privileged role/configuration transition and economically
meaningful operation. Include indexed identities/operation IDs, old/new values,
recipients and enough amount data to reconcile state; do not silently omit router
or treasury changes. Timelock events must expose exact action data, ETA and
expiry. Time passing need not produce a fabricated expiry event. Events never
contain secrets or personal recovery material.

## External interactions and accounting

Use checks-effects-interactions and a reviewed reentrancy guard for asset-moving
flows. Propagate failures atomically. Check ERC-20 return values with pinned,
reviewed SafeERC20-style handling; bound and reset approvals where necessary.
For fee-on-transfer tokens, account using received/credited balance differences,
including outgoing recipient credits where events claim receipt. Quotes and
router return arrays are not receipt evidence.

MEV-sensitive calls require an explicit price/freshness/depth threat model,
nonzero net minimums, bounded deadlines and spend limits. A spot quote or private
relay alone is not a manipulation defense. No execution reward, destination or
calldata may be chosen by a permissionless executor outside the queued action.

## Verification and deployment evidence

Before a deployment decision, obtain role-negative, boundary, lifecycle,
adversarial and invariant tests; exact-head CI; independent security review;
and migration rehearsals against pinned deployed bytecode and on Sepolia as
applicable. Test two-step acceptance, stale nomination, cancellation and failed
acceptance, not just the happy path.

Preserve reproducible build metadata: exact source/lockfile, compiler build and
settings, resolved dependencies, standard JSON/build-info, ABI/storage layout,
constructor arguments, libraries/immutables, initcode/runtime hashes and
verification results. Mixed compiler configuration is not deployment provenance.
The [migration plan](GOVERNANCE_MIGRATION_PLAN.md) defines the JUL-21 evidence set.

Maintain a full role/address/authority inventory, read-only pre/post checks,
wait/expiry windows and technically feasible abort/rollback steps. Council
decisions, Safe signatures, queued proposals, deployment, funding and activation
are separate milestones. Documentation or source-only fixes never establish
that a live contract was upgraded or an audit finding was closed.
