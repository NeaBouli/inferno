# CommitmentVault V3: native batch and split draft

Status: **local design and implementation draft only; not approved for deployment**.
Scope: [CommitmentVaultV3.sol](../../contracts/vault/CommitmentVaultV3.sol) and
[its local tests](../../test/CommitmentVaultV3.test.js). No existing custody,
deployment, frontend routing, allowance, or governance configuration is changed.

## Source boundary and motivation

The [open UX item](../PHASE3_OPEN_ITEMS_STATUS_20260708.md#5-web3-ux-backlog)
tracks one approval followed by one wallet confirmation per tranche. Native
entry points allow one approval for the total and one subsequent transaction
creating every tranche. An existing sufficient allowance needs no new approval.
This draft does not implement permit or gas sponsorship.

The baseline is the **repository release candidate**
[CommitmentVaultV2.sol](../../contracts/vault/CommitmentVaultV2.sol), not the
historical deployed contract also called V2. The distinction is documented in
[JUL-07](JUL-07-V2-SOLVENCY-EVIDENCE.md) and
[compiler provenance](JUL-21-COMPILER-PROVENANCE-EVIDENCE.md).
No current chain state is asserted here. Solidity 0.8.28, Cancun and the
existing unoptimized build policy are retained for this local draft.

V3 is a standalone successor because V2's private custody/history and
non-virtual entry point cannot support additive batching through inheritance
without changing V2. V2 production source remains unchanged. V3 copies its
governance, readers, maintenance and exit policy; single, batch and split entry
share one private validation/reservation/receipt implementation. Future V2
hardening must be reconciled explicitly with this copy before a release.

## Public API and allocation policy

```solidity
struct LockCondition {
    ConditionType cType;
    uint256 unlockTime;
    uint256 p0Multiplier;
}
struct LockPart {
    uint256 amount;
    LockCondition condition;
}
function lockBatch(uint256[] amounts, LockCondition[] conditions)
    external returns (uint256 firstTrancheId);
function lockSplit(uint256 total, LockPart[] parts)
    external returns (uint256 firstTrancheId);
```

- Both entry points accept 1 through `MAX_LOCK_BATCH = 20` locks. The V2
  `MAX_BATCH = 50` pagination/pruning limit stays separate and unchanged.
- Amounts are positive integers in nine-decimal IFR base units. `lockBatch`
  requires equal array lengths and calculates a checked aggregate sum.
- `lockSplit` uses **explicit base-unit allocations**, not percentages or
  weights. Their checked sum must equal the positive `total` exactly; there is
  no division, rounding, remainder assignment, or implicit final tranche.
- For example, `total = 10 * 1e9 + 1` can be allocated as
  `[5 * 1e9, 5 * 1e9 + 1]`, each with its own deadline.
- Every condition must be `TIME_ONLY`, have a zero multiplier and expire from
  one day through 1461 days after the transaction timestamp, inclusive.
- `firstTrancheId` identifies the first appended lock. All following IDs are
  consecutive in the caller's history. No existing ID or lock is reused.
- Each new lock emits the V2-shaped `Locked` event with source `version = 3`.
  Exactly one `BatchLocked(wallet, firstTrancheId, version, count, total)`
  follows all per-lock events. Single `lock` emits only `Locked`.

An ABI consumer must encode nested tuples explicitly. A frontend must prepare
the base-unit allocation and deadlines, display all terms and approve the
aggregate amount to the new vault only after a separately authorized release.
There is no frontend integration in this draft.

## Custody and accounting invariants

1. **Caller ownership:** every tranche's depositor and history key is
   `msg.sender`, and the aggregate transfer is from `msg.sender`. No recipient,
   `lockFor`, router, `tx.origin`, or delegated beneficiary is accepted. Smart
   contract wallets can call directly and own their own locks. Calling through
   a helper would make that helper the caller; it does not batch for an EOA.
2. **One incoming transfer:** a successful batch/split makes exactly one
   `safeTransferFrom(msg.sender, address(this), total)` and checks the vault's
   balance before and after it. Existing donations are excluded from receipt.
3. **Exact receipt or complete revert:** as in V2, the exemption getter must
   report true, and the balance delta must equal the requested total exactly.
   A short, zero, or excess receipt reverts all claims, limits, history, token
   movements, allowance consumption and events. Taxed deposits are not
   proportionally credited. Tax rounding is measured on the aggregate transfer.
4. **CEI and reentrancy:** all terms and limits are checked, every tranche and
   gross-entry record is appended, and all wallet/global counters are reserved
   before transferFrom. Receipt validation follows the interaction with no
   further accounting writes. Single, batch, split, unlock and pruning share
   `nonReentrant`. The immutable token implementation remains trusted as in V2.
5. **Unchanged ceilings:** per-lock limits apply to each allocation, and wallet,
   global and rolling-day limits apply to the full aggregate plus prior usage.
   Every part consumes an active slot under the unchanged limit of 50.
6. **Exact rolling gross entries:** one history entry is retained per new lock,
   all with the transaction timestamp. Aggregating transferFrom never merges
   entry records or bypasses pruning work. Automatic pruning still handles at
   most 50 expired entries; larger backlogs need permissionless maintenance.
   A failed deposit also reverts its attempted pruning. Exits do not refund
   gross entry usage. Entries expire at timestamp plus 24 hours, inclusive.
7. **Unchanged exits:** each mature claim is consumed once, exclusively to its
   original depositor, even when deposits are paused or exemption is revoked.
   The retired claim is gross; `Unlocked` reports measured net recipient credit.
   A failed outgoing transfer restores the claim for retry.
8. **Conservation:** outstanding tranche amounts equal wallet claims; wallet
   claims sum to `totalLocked`; active counts match unreleased tranches. Under
   the same trusted-token assumptions as V2, custody covers all claims and
   donations create no claims or entry capacity.
9. **Governance continuity:** initial entries are disabled with zero caps;
   enablement/configuration retains the 48-hour delay, nonce protection and
   hard maxima. Immediate owner pause never blocks exits. Two-step ownership
   acceptance cancels the previous owner's pending configuration, and
   renunciation remains disabled. New batch APIs add no administrative powers.

## Review and Council decisions before any deployment

Council must explicitly approve the successor specification, the 20-lock bound,
explicit-amount split ABI, versioned event/indexing policy, entry maxima,
time bounds, exact-receipt policy and governance ownership/activation sequence.
V2's existing ratification does not approve V3 or authorize deployment.

Independent review must examine aggregate arithmetic and cap enforcement,
caller ownership, all-or-nothing receipt handling, cross-entry-point reentrancy,
permissionless exits, rolling-history liveness, worst-case gas and bytecode size.
It must also reconcile this source copy against any intervening V2 changes and
review the token implementation/exemption trust boundary. Tests and bounded
analysis do not replace an independent smart-contract audit.

A separate release needs approved compiler/build provenance, exact-head CI,
full Slither and bounded Mythril reports, governance and Treasury Safe
authorization, a separately reviewed deployment/activation plan, required token
exemption, and frontend/indexer/version integration. Existing V1 or deployed V2
custody is never migrated, repaired or accessed by this contract. No mainnet
transaction or deployment script is introduced by this task.

## Local verification and static-analysis scope

The focused suite covers V2 single-lock and multi-single parity, exact approvals,
one transferFrom, state reservations observed inside transferFrom, per-lock and
batch events, ownership, limits, invalid terms, allowance/balance failure,
taxes, excess/short receipt, donations, active-slot reuse, rolling pruning,
callback reentrancy, governance handover, real IFR exemption revocation,
mixed-operation conservation and gas comparisons.

V3 is explicitly added to Mythril's concrete-contract scope (24 to 25) and
Slither's production-file coverage assertion (28 to 29), following the
FeeRouterV2 and BuybackVaultV2 scope changes. The Slither High baseline is
unchanged. A scoped run with Slither 0.11.5 and solc 0.8.28/Cancun observed
**zero High or Critical signals**; none are expected from the new entry paths.
Lower-severity timestamp/pragma/default-zero reports are not High suppressions.
Any new High in CI still requires individual review and a written rationale;
none is baselined by this draft. The requested `test-mythril` and
`test-slither-baseline` scripts validate gate policy and scope, rather than
performing the full analyzer runs.

### Verification results

- Focused Hardhat suite: **142 passing** (82 V3 tests, 60 existing V2 tests).
  The standard invocation hit `MultiProcessMutexTimeoutError` after 60000 ms
  waiting for the global cache's `compiler-download-list` lock. A temporary
  config imported the unchanged project config and supplied its compiler
  `path` fields from the existing local cache. No download, global cache change
  or persistent Hardhat configuration change was needed. The actual build used
  `solc-macosx-amd64-v0.8.28+commit.7893614a`, Cancun, optimizer disabled;
  compiler cache root was
  `/Users/gio/Library/Caches/hardhat-nodejs/compilers-v3/macosx-amd64/`.
- Runtime size: **15,411 bytes**, below the 24,576-byte EIP-170 bound.
- Gas sanity from the same snapshotted initial state, using the test token
  with additional accounting observations: ten singles **3,077,030** gas;
  batch of ten **1,797,680**; split of ten **1,798,935**; batch of twenty
  **3,229,362**. These are local test measurements, not live gas estimates.
- `node scripts/test-slither-baseline.cjs`: **PASS**. Scoped Slither analysis
  produced a successful JSON report with zero High/Critical signals. The raw
  CLI returned 255 because lower-severity reports remain; this is not a clean
  all-severity analyzer result or a full-repository scan.
- `node scripts/check-markdownlint-baseline.cjs`: **PASS** with 3,636 historical
  findings unchanged across 249 files. The baseline was regenerated with the
  required `--write-baseline` command only after the runner reported the sole
  mismatch as file count, 248 to 249; the diff changes only `filesScanned`.
- `node scripts/test-mythril.cjs`: **blocked by an existing timeout-fixture
  race**, reproduced twice. Its scope/configuration assertions pass before the
  process-tree test's 100 ms timeout kills a child before it writes the PID
  fixture; the subsequent read fails with `ENOENT` at line 167. Independent
  child-start measurements were 673, 150 and 454 ms in this environment.
  Only the requested scope counts were changed; timeout logic was not altered
  to obtain a passing result. A successful full Mythril analysis is still a
  separate prerequisite for any release.
