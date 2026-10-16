# Governance and BuybackVault Migration Plan

**Status:** unexecuted planning document, 17 October 2026. No transaction payload
is approved for signing or broadcast. Every future on-chain action requires its
own recorded Council authorization.

## Definition of Ready and authority

Gio authorized specifications and a migration plan on 17 October 2026, mandated
two-step ownership in future contracts, and selected a separate cancel-only
guardian Safe, 2-of-3. This authorization covers documentation only. It does not
approve deployment, new signer appointments, funding, token exemptions, swaps,
ownership/guardian transfers or changes to live economics.

Before any execution, the Council must approve:

- The final [Governance V2 specification](specs/GOVERNANCE_V2_SPEC.md),
  [BuybackVault specification](specs/BUYBACKVAULT_REDEPLOY_SPEC.md) and
  [Guardian Safe plan](specs/GUARDIAN_SAFE_PLAN.md), including unresolved numeric
  limits, signer selections and asset-flow policy.
- Exact source commit, reviewed build, chain ID, all full addresses and code
  identities, roles, target/calldata/value for each step, Safe transaction
  hashes/nonces, timelock delays, ETAs, expiry windows and a named operator.
- Independent contract/migration review and a complete pinned mainnet-fork
  rehearsal plus Sepolia rehearsal using the intended Safe thresholds.
- Explicit exceptions for immutable legacy single-step transfers and the G1
  owner handoff, and a decision on FeeRouterV1's fixed governance pointer.
- A fresh read-only, block-numbered baseline, rollback transactions that are
  technically available, abort criteria and post-step verification ownership.

No deployment artifact or script that broadcasts is delivered with this plan.
Preparation is read-only/offline; signer actions below are future instructions
subject to the gate above.

## Baseline and named actors

Use the complete contract/address inventory in the Governance specification and
the [mainnet manifest](../deployments/mainnet.json), checked against
[DEPLOYMENTS.md](DEPLOYMENTS.md) and deployed verified source. Evidence reviewed
at `9c0f5352c31cf4c7db595ac444a8464db3125b88` is dated repository evidence.
Fresh public RPC/explorer verification was unavailable in this session; there
is no asserted live migration baseline or allocated G2/new-vault/Safe address.

| Name | Meaning and future signing authority |
| --- | --- |
| `T` | Treasury Safe `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`, documented 3-of-5; re-read actual quorum, owners, modules and nonce |
| `G1` | Existing Governance `0xc43d48E7FDA576C5022d0670B652A622E8caD041`; T is documented owner |
| `G2` | New Governance; initial owner/proposer T; anyone may execute ready, unexpired G2 proposals |
| `C` | Proposed separate 2-of-3 cancel-only Guardian Safe; signer appointments and address not yet approved |
| `V1` / `V2` | Existing / replacement BuybackVault; V2 address is not allocated |
| `D1` / `D2` | G1/G2 delays read at queuing time; G1 documented 172,800 seconds, G2 recommended minimum/initial 172,800 seconds |
| Deployment operator | Council-named deployer for reviewed creations only; no residual owner/guardian privilege |
| Verification operator | Read-only provider; no signing key or signer impersonation on a live network |

The old deployer `0x6b36687b0cd4386fb14cf565B67D7862110Fed67` signs nothing in
the planned governance-owner handoff. Its immutable V1 and BuybackController
pause/unpause roles remain for now by Gio's 17 October decision. Source changes
cannot rotate those deployed roles.

## Build provenance to preserve (JUL-21)

For G2, V2, Safe configuration and every future replacement, preserve:

- Source commit, clean-worktree declaration, full sources/imports and hashes,
  lockfile and its digest, resolved dependency versions and license identifiers.
- Exact Node/package-manager/Hardhat versions; full solc version including build
  identifier and compiler binary digest; standard JSON input/output and build-info.
- Optimizer enabled/runs/details, `viaIR`, EVM target, metadata/bytecode-hash
  settings, remappings, linked-library addresses, storage layout and ABI.
- Constructor arguments and encoded bytes, initcode and runtime bytecode,
  creation transaction/receipt, chain ID, deployer, deployment block/hash and
  immutable/link references used for bytecode comparison.
- Independent review artifacts and exact-head test results; Etherscan
  verification input and Sourcify exact-match result or an explicitly reviewed
  discrepancy. Preserve public artifacts without keys, RPC credentials or secrets.
- Safe singleton/version, proxy and implementation code hashes, setup calldata,
  owners, threshold, modules, guard and fallback handler at the evidence block.

Repository configuration currently lists solc 0.8.20 with `paris` and 0.8.28 with
`cancun`. Do not infer the compiler used for an artifact from its pragma or from
that list: compatible pragmas and dependency constraints can select a different
compiler. Freeze the actual build-info per contract. Distinguish constructor
immutables, dependency drift and metadata differences from real code changes;
the G1 W1 and V1 W3 discrepancies are documented real source-era changes.
Any unexplained mismatch blocks migration.

## Ordered future on-chain steps

Each step starts only after its prerequisites and Council action approval. After
each transaction, wait for the Council's chosen confirmation/finality policy,
record the receipt and canonical block hash, then perform the specified
read-only checks. A reverted/reorganized transaction is not a completed step.
Never infer completion from a Safe signature collection or queued proposal alone.

### Step 0 — Freeze the migration manifest and baseline (read-only)

**Signs:** nobody. Record chain ID 1, block/hash/timestamp, code hashes,
`owner/admin/governance/guardian`, Safe owners/threshold/modules, relevant
pending owners, fees/exemptions and token receiver, ETH/IFR balances, all G1
proposal IDs/content/ETAs/status and G1 delay. Compare every inventory row to
verified deployed interfaces, including CommitmentVault V2.

Record user custody state, LendingVault disabled-price state, reward caller
state and Controller configuration as unchanged-value assertions. Record V1
balances freshly; historical zero balances are not proof of current emptiness.
Identify which already queued G1 actions must be cancelled before migration.

**Abort:** any unexplained role/code/queue drift, absent quorum, unresolved
guardian independence or nonzero V1 assets without a separately approved plan.
No on-chain rollback is needed before anything is signed.

### Step 1 — Create and verify C

**Signs:** approved deployment operator for Safe creation/setup, then two of the
three approved C signers for a harmless rehearsal on the approved test network.
No protocol role is assigned until address/code/configuration and independent
custody evidence are accepted. Do not perform a mainnet "test cancellation" of
a live proposal as a harmless identity check.

**Read-only verification:** approved Safe proxy/singleton, exactly three owners,
threshold two, expected modules/guard/fallback handler, no unapproved execution
bypass. Confirm C is distinct from T, Community Safe and LP Reserve Safe.

**Abort/rollback:** discard an unassigned misconfigured Safe. Once assigned,
replacement requires the appropriate governed rotation; do not silently change
the signers or threshold from the approved manifest.

### Step 2 — Deploy and verify G2 and inactive V2

**Signs:** approved deployment operator creates the exact reviewed builds, with
explicit initial owner T. G2 guardian is C. V2 pause guardian is the separately
approved operational guardian, proposed T, never C. Verify all constructor
parameters before creating anything; publish and archive the metadata above.

**Read-only verification:** runtime/code/source match, G2 owner T and no pending
owner, C guardian, ratified delay/floor/expiry constants and empty proposal space;
V2 owner T, inactive state, approved roles/limits, no operational funds and
`activationTime` at least the approved delay after its deployment timestamp.

**Abort/rollback:** if either deployment is wrong, do not fund or wire it. Record
the unused address and obtain separate approval for any replacement deployment.
Deployment gas and published addresses are irreversible; G1 still controls the
existing system at this point.

### Step 3 — Complete V2 ownership in two actual steps

**Signs, nomination:** T's verified quorum submits
`V2.transferOwnership(G2)`. This changes only `pendingOwner`; T remains owner.
No private deployer retains a bootstrap privilege.

**Read-only verification:** `V2.owner() == T`, `pendingOwner() == G2`, correct
nomination event, inactive/unfunded state.

**Signs, acceptance proposal:** T submits `G2.propose(V2, acceptOwnership())`.
Verify target, full calldata, zero value, ID, operation hash, ETA and expiry.
Wait the full snapshotted D2; an independent executor may then execute before
expiry. No Safe quorum is required merely to call G2 execute.

**Read-only verification:** accepted-owner event, `owner() == G2`, cleared
pending owner and executed G2 proposal. **Abort/rollback:** before acceptance,
T may cancel/replace the nomination and T or C can cancel the G2 proposal.
After acceptance, returning ownership requires a new G2-delayed nomination and
acceptance by T; there is no instant undo.

### Step 4 — Clean G1 queue and prepare child handoffs

**Signs:** T, as current G1 owner/guardian, cancels every stale or unapproved
pending G1 proposal selected in the manifest. Cancellation is immediate and
irreversible for that ID; no reactivation is permitted. Preserve any required
business action only through a separately approved plan, not a blind replay.

T queues separate G1 proposals for each of the ten movable control roles listed
below. Re-read each role immediately before queuing. Record exact target,
calldata, zero value, proposal ID and ETA. Publish enough time for review; wait
the actual snapshotted D1 after each proposal is created. If D1 differs from the
documented 48 hours or the approved policy, stop and reconcile first.

| Planned order | Target | G1 proposal calldata | Read-only result after execution |
| --- | --- | --- | --- |
| 1 | BuilderRegistry | `transferOwnership(G2)` | `owner == G2`, registered-builder state preserved |
| 2 | CommitmentVault V1 | `transferOwnership(G2)` | `owner == G2`, legacy tranches and custody preserved |
| 3 | CommitmentVault V2 | `transferOwnership(G2)` | `owner == G2`, TIME_ONLY state and custody preserved |
| 4 | LendingVault V1 | `transferOwnership(G2)` | `owner == G2`, disabled borrowing/price state preserved |
| 5 | PartnerVault | `setAdmin(G2)` | `admin == G2`, guardian/callers/allocations preserved |
| 6 | Existing BuybackVault V1 | `transferOwnership(G2)` | `owner == G2`, dormant state and guardian preserved |
| 7 | BuybackController | `transferOwnership(G2)` | `owner == G2`, fee inflow/configuration preserved, no execution |
| 8 | BurnReserve | `transferOwnership(G2)` | `owner == G2`, guardian and balances/totalBurned preserved |
| 9 | LiquidityReserve | `transferOwnership(G2)` | `owner == G2`, lock/caps/accounting preserved |
| 10 | InfernoToken | `transferOwnership(G2)` | `owner == G2`, decimals/fees/receiver/exemptions preserved |

These deployed contracts expose single-step changes, not `pendingOwner` or
`acceptOwnership`. T2 cannot be retrofitted by a proposal. Council must approve
each legacy exception or pause migration for a separate replacement design.
G2's verified identity and a successful fork simulation are prerequisites, not
an invented on-chain acceptance handshake.

**Abort:** cancel unexecuted handoff proposals immediately if G2 is wrong or an
earlier check fails. G1 has no expiry: operators must not leave delayed handoff
proposals indefinitely executable. No child has moved merely by queuing it.

### Step 5 — Execute and verify each child handoff

**Signs:** T quorum calls G1 `execute(id)` after each corresponding ETA. G1
execution remains owner-only. Parallel queuing does not waive the per-row
verification hold point; execute in approved order, with token control last.

**Read-only verification after every row:** successful receipt and exact
ownership/admin event; target role equals G2; old role no longer has access;
all unchanged-value assertions from step 0; no token or ETH movement beyond
expected gas. Use `eth_call`/local fork negative probes, not live mutating probes.
Read negative-probe results against the verified ABI, not just arbitrary revert
text. Re-run G2 owner/guardian/delay and code checks before the next row.

**Abort/rollback:** stop the remaining sequence and cancel every outstanding
handoff if a row fails. Already moved roles are controlled by G2. A return to G1
requires T to propose the reverse `transferOwnership(G1)` or `setAdmin(G1)` in
G2, wait D2 and execute before expiry. These reverse legacy changes are also
single-step, need explicit approval and independent verification, and depend on
G2 remaining functional. Lost control cannot be promised recoverable.

### Step 6 — Resolve FeeRouter and transfer the G1 root, if approved

FeeRouterV1's `governance()` remains G1; there is no setter, despite its ordinary
storage declaration. Proposed solution: retain G1 solely as a legacy bridge,
with G2 as its owner. A separate FeeRouter replacement is an alternative that
needs its own specification, authorization and integrations; it is not hidden
inside this plan.

**Precondition:** every direct role in step 5 verified, every G1 proposal
classified and no unwanted executable action remaining, bridge review complete,
and separate Council approval for this root change.

**Signs:** T quorum directly calls deployed `G1.setOwner(G2)` only after a
publicly recorded review interval of at least the approved migration wait
(recommended 48 hours) from the final exact manifest. This is an operational
hold, not an on-chain timelock. Deployed G1 `setOwner` is `onlyOwner`; trying
`G1.propose(G1, setOwner(G2))` then G1 execute fails because the self-call sender
is G1, not T. G1 has no two-step acceptance. Do not use the repository W1-fixed
source to claim otherwise (CWA-25).

**Read-only verification:** G1 owner G2, FeeRouter governance still G1, G1
guardian unchanged for now, G1 delay retained and no stale proposal outstanding.
T must no longer be able to directly propose/execute/setOwner on G1.

**Abort/rollback:** before this call, T retains legacy root control; do not
declare migration complete if the bridge choice is unresolved. After it,
G2 can timelock a call to `G1.setOwner(T)` if still functional, but cannot undo
completed external effects. Root rollback is neither immediate nor guaranteed.

### Step 7 — Assign C the legacy Governance cancel role

**Signs:** T proposes `G2.propose(G1, setGuardian(C))`; wait D2; anyone executes
the ready proposal before expiry. G1 accepts the call because its owner is now
G2. Do not assign C any vault guardian, BurnReserve guardian or token/admin role.

**Read-only verification:** `G1.guardian() == C`, `G2.guardian() == C`, correct
rotation events, C's unchanged 2-of-3 configuration and other legacy guardians
unchanged. Negative probes confirm C can cancel on Governance only and cannot
mutate delays, owners, recipients or balances through a privileged role.

**Abort/rollback:** cancel the pending G2 rotation if its identity changes.
After execution, guardian reversal requires another delayed G2 proposal and
can itself be cancelled by C. Cancellation censorship and key loss therefore
need the pre-approved incident policy; no recovery bypass is assumed.

### Step 8 — Reconcile, publish evidence and keep activation separate

**Signs:** nobody for the read-only reconciliation. Re-read the entire inventory,
Safes and queues at a new canonical block, not just the final transaction's
target. Reconcile all expected events, balances, token supply and unchanged
state. Record which contracts remain legacy and which roles remain immediate.
Update deployment/role records only after independently verified execution.

G2/V2 deployment alone does not close audit findings: publish source/bytecode
matches, ownership evidence, test/review reports and residual-risk acceptance.
Do not count planned addresses in the current deployed-component inventory.

V2 stays inactive and operationally unfunded. Its activation, fee exemption,
funding and first bounded buyback follow the separate gate in its specification,
including the 60-day minimum, readiness checks, full D2 wait and proposal expiry.
Do not copy old activation timestamps or shorten the clock to speed migration.

## Future FeeRouter administration through the retained bridge

If the Council approves the bridge, later FeeRouter changes use both governors:

1. T proposes in G2 a call to `G1.propose(FeeRouterV1, exactCalldata)`. After D2,
   anyone executes that G2 proposal; record the newly created G1 ID and ETA.
2. Only after the G1 ID/content are verified, T proposes in G2 a call to
   `G1.execute(g1Id)`. After D2 and after the G1 ETA, anyone may execute this
   second G2 proposal before its expiry. Simulate the complete nested call.
3. If G1's ETA would fall outside the outer G2 execution window, schedule the
   second wrapper later. No shortening of D1/D2 or outer expiry extension is
   permitted. G1 still has no expiry; stale G1 actions must be cancelled by C
   or a separately timelocked G2 cancellation, not left ready indefinitely.

No proposal ID or signature migrates between governors. C can cancel the outer
G2 proposal or, once assigned, the inner G1 proposal with its own 2-of-3 action.
T cannot directly execute G1 after root transfer. FeeRouter vouchers and funds
do not move merely because this governance route changes.

## Fee exemptions, fees and residual assets

Ownership does not alter `InfernoToken.feeExempt` mappings. Record and compare
all relevant existing entries, including Treasury, BurnReserve, both existing
buyback contracts, CommitmentVault V1/V2, reserves, locks and LP pair. Governance
addresses do not need an exemption merely to make administrative calls.

A new V2 address starts without the old vault's exemption. If approved, queue
`InfernoToken.setFeeExempt(V2, true)` through whichever governor actually owns
the token at that step; proposed placement is after step 5 through G2. Wait D2,
verify exact content and expiry, then verify the mapping and event. Test both
exempt and taxed flows before activation. Do not remove V1's exemption until
its residual balances/flows and recovery limitations are resolved; removing it
can change net receipts and burn/pool fees on later transfers.

Under the current token source, either endpoint being exempt bypasses the
transfer fee. Re-read actual fee rates and relevant endpoint exemptions; do
not assume every hop is taxed or every new address inherits an exemption.
Preserve integer base units (IFR has nine decimals). Depositing IFR into
BurnReserve is not itself a supply burn; balances and `totalSupply` need separate
reconciliation. No fee-rate change is included.

Keep `poolFeeReceiver` pointing to the documented BuybackController unless a
separate proposal is approved. FeeRouterV1's historical recovered IFR are
unallocated Treasury assets per Lane 3, not approved migration funding. Neither
IFR fee accrual at Controller nor a Treasury balance authorizes an ETH spend.

V1 has no generic ETH/IFR withdrawal in the reviewed interface. If it has assets,
do not promise a `withdraw`/`sweep` or execute its old swap as a migration shortcut.
Stop the funds-migration claim and obtain a separate contract-specific recovery
decision. Controller has governed withdrawal methods, but their use and any
later Controller replacement are separate scope and signing decisions.

## Completion and Council questions

Completion means every approved step has final receipts and independent role,
bytecode, queue and unchanged-state evidence; V2 ownership is genuinely accepted;
all legacy limitations and abort outcomes are recorded. A partial migration
must name remaining owners and executable proposals, never just say "done".

Council must decide the numeric G2/V2 policies, C signers and censorship recovery,
legacy single-step exceptions, FeeRouter bridge versus replacement, V2 pause
guardian, fee-exemption/funding/activation policy, finality policy and the later
Controller/immutable-guardian replacement scope. No current implementation,
deployer signature, production transaction or contract-fund movement follows
from accepting this document as a plan.
