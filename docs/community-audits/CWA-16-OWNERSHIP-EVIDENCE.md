# CWA-16 ownership and governance transfer evidence

Date: 2026-10-23. Source baseline: `72280741840ef493472d955649b73404a69386fc`.

This is local source and regression-test evidence for CWA-16 (Low). It does not
change contract code or close the finding. The remediation register still requires
two-step ownership in future versions and acceptance/cancellation tests before
deployment. Only this report and `test/Ownership.cwa16.test.js` are added.

Deployment labels below come from the repository's
[deployment record](../DEPLOYMENTS.md#ethereum-mainnet), especially its contract
table at `docs/DEPLOYMENTS.md:132`. No network, live-state inspection, or deployed
bytecode comparison was performed. Tests execute precompiled local artifacts on
Hardhat's simulated chain, with forking disabled. They establish local artifact
behavior, not the behavior of an independently verified deployed instance.

The assignment's suggested V1/V2 split needs one correction: the record lists
**CommitmentVaultV2 as already deployed** (`docs/DEPLOYMENTS.md:150`), with deployment
provenance beginning at line 152. GovernanceV2 and LendingVaultV2 are absent from
that table and explicitly marked not deployed in their source headers. Historical
reserve deployments called "v2" in the Sepolia notes still use the single-step
reserve implementations; that label does not imply `Ownable2Step`.

## Complete role inventory

All 26 non-mock Solidity files under `contracts/` were inspected: 18 contracts have
an owner, governance, admin, or guardian role; the other eight are listed below.
Constructor arguments named `governance` initialize an owner unless a separate
role is explicitly shown.

`OZ1` means inherited OpenZeppelin `Ownable`: direct `transferOwnership(nonzero)`
and direct `renounceOwnership()` to zero. `OZ2` means `Ownable2Step`, with the local
overrides described in the row. Installed OpenZeppelin version: 5.6.1. The shared
implementation is at `node_modules/@openzeppelin/contracts/access/Ownable.sol:76`
(renounce), `:84` (transfer), `:95` (write and event), and
`node_modules/@openzeppelin/contracts/access/Ownable2Step.sol:43` (nomination),
`:52` (clear pending), `:60` (pending-owner acceptance).

| Contract | Deployment classification in local record | Roles and transfer mechanism | Source locations |
| --- | --- | --- | --- |
| InfernoToken | Deployed V1 | Owner: OZ1, no acceptance; zero transfer rejected, renunciation allowed. | `contracts/token/InfernoToken.sol:11`, `:28`; OZ1 above |
| LiquidityReserve | Deployed V1 | Owner: direct nonzero setter, owner only. Guardian: direct nonzero setter by owner. | `contracts/liquidity/LiquidityReserve.sol:155`, `:133` |
| BurnReserve | Deployed V1 | Owner: direct nonzero setter, owner only. Guardian: direct nonzero setter by owner. | `contracts/burnreserve/BurnReserve.sol:96`, `:88` |
| BuybackVault | Deployed V1 | Owner: direct nonzero setter, owner only. Guardian: Solidity `immutable`, no rotation. | `contracts/buyback/BuybackVault.sol:178`, `:28`, `:86` |
| BuybackController | Deployed V1 | Owner: direct nonzero setter, owner only; initialized from governance. Guardian: Solidity `immutable`, no rotation. | `contracts/buyback/BuybackController.sol:257`, `:107`, `:42`, `:112` |
| Governance | Deployed V1 | Owner: `setOwner(nonzero)` via queued self-call; takes effect during execution without acceptance. Guardian: direct nonzero setter by owner. A timelock is not recipient acceptance. | `contracts/governance/Governance.sol:128`, `:86`, `:120` |
| IFRLock | Deployed V1 | Guardian only: direct nonzero setter by incumbent guardian. No owner/admin. | `contracts/lock/IFRLock.sol:22`, `:108` |
| Vesting | Deployed V1 | Guardian: direct nonzero `transferGuardian`, incumbent guardian only. Beneficiary: immutable, not an owner/admin. | `contracts/vesting/Vesting.sol:75`, `:14` |
| PartnerVault | Deployed V1 | Admin: direct nonzero setter by incumbent admin. Guardian: direct nonzero setter by incumbent guardian. | `contracts/partner/PartnerVault.sol:391`, `:400` |
| FeeRouterV1 | Deployed V1 | Governance assigned only in constructor; no transfer/setter or acceptance API. Effectively fixed, although storage is not declared `immutable`. Voucher signer is separately changed by a direct governance-only setter accepting zero. | `contracts/FeeRouterV1.sol:16`, `:61`, `:66`, `:72`, `:208` |
| CommitmentVault | Deployed legacy V1 | Owner: OZ1; no acceptance; zero transfer rejected, renunciation allowed. | `contracts/vault/CommitmentVault.sol:16`, `:62`; OZ1 above |
| LendingVault | Deployed retired V1 | Owner: OZ1; no acceptance; zero transfer rejected, renunciation allowed. | `contracts/vault/LendingVault.sol:18`, `:99`; OZ1 above |
| BuilderRegistry | Deployed V1 | Owner: OZ1; no acceptance; zero transfer rejected, renunciation allowed. | `contracts/BuilderRegistry.sol:17`, `:73`; OZ1 above |
| CommitmentVaultV2 | **Recorded as deployed V2** | Owner: OZ2 with nonzero nomination, explicit cancellation, acceptance that clears queued entry configuration, disabled renunciation. No separate guardian/admin. | `contracts/vault/CommitmentVaultV2.sol:26`, `:146`, `:313`, `:319`, `:327`, `:333` |
| GovernanceV2 | Not deployed; release candidate | Owner: OZ2 with custom pending storage; nomination/overwrite and cancellation require timelocked self-calls. Pending owner alone accepts; zero/self/guardian nominees rejected; renunciation disabled. Guardian rotation remains a single-step nonzero setter through the timelock, without guardian acceptance. | `contracts/governance/GovernanceV2.sol:10`, `:48`, `:200`, `:209`, `:215`, `:223`, `:228`, `:234`, `:251` |
| LendingVaultV2 | Not deployed; release candidate | Owner: OZ2; zero/self nominees rejected, explicit cancellation, disabled renunciation. Guardian: queued nomination of a contract, separate contract acceptance, explicit cancellation/overwrite; zero rejected. | `contracts/vault/LendingVaultV2.sol:58`, `:254`, `:263`, `:269`, `:277`, `:320`, `:328`, `:335` |
| PriceLockVault | Not listed as deployed; no V2 suffix | Owner: OZ1, despite being a newer contract; no acceptance, zero transfer rejected, renunciation allowed. | `contracts/vault/PriceLockVault.sol:30`, `:99`; OZ1 above |
| IFRBuilderVault | Library integration, not listed as deployed | Owner: OZ1; no acceptance, zero transfer rejected, renunciation allowed. | `contracts/library/IFRBuilderVault.sol:19`, `:32`; OZ1 above |

The unlisted PriceLockVault and IFRBuilderVault are not classified as deployed V1
or as V2 release candidates merely from their names. Fee collectors, pool/fee/LP
receivers, treasury destinations, price-oracle addresses and partner beneficiaries
are not additional owner/governance/admin/guardian roles. The FeeRouter voucher
signer is included above because it authorizes vouchers; it cannot administer the
router. The LendingVaultV2 fee receiver confirms its destination but explicitly
has no administration rights (`contracts/vault/LendingVaultV2.sol:173`).

| Remaining non-mock file | Role/transfer result and local deployment classification |
| --- | --- |
| `contracts/bootstrap/BootstrapVault.sol:47` | No privileged role; permissionless finalization at `:134`; `ifrSource` is an immutable funding source at `:49`, not an admin. Historical deployment, deprecated. |
| `contracts/bootstrap/BootstrapVaultV2.sol:47` | No privileged role or ownership transfer; permissionless finalization at `:130`; not listed as deployed. |
| `contracts/bootstrap/BootstrapVaultV3.sol:51` | No privileged role or ownership transfer; permissionless finalization at `:138` and refund at `:203`; recorded as deployed/finalized. |
| `contracts/view/IFRTierView.sol:11` | No privileged role or transfer; immutable read-only configuration; not listed as deployed. |
| `contracts/library/BaseAccessModule.sol:10` | Abstract module, no authority role or transfer. Internal setters require access control in a concrete consumer. |
| `contracts/library/HardLockModule.sol:13` | Abstract module, no authority role or transfer; ReentrancyGuard grants no admin role. |
| `contracts/library/TierModule.sol:12` | Abstract module, no authority role or transfer. |
| `contracts/library/CooldownModule.sol:7` | Abstract module, no authority role or transfer. |

## New test coverage

The file [Ownership.cwa16.test.js](../../test/Ownership.cwa16.test.js) adds 46 tests:

| Coverage group | Tests | Assertions |
| --- | ---: | --- |
| GovernanceV2 owner | 7 | Queued nomination and events; incumbent retains privileges until acceptance; owner, guardian and stranger cannot accept; only current nominee accepts; old owner loses proposal rights; pending clears; repeat acceptance fails; cancellation and overwrite invalidate stale nominees; zero nomination preserves pending state; zero initial owner rejected; unauthorized proposals/direct self-call bypass rejected; renunciation disabled. |
| LendingVaultV2 owner | 7 | Same ownership lifecycle with owner-only direct nomination/cancellation, inherited acceptance and contract-specific errors/events. |
| CommitmentVaultV2 owner | 7 | Same ownership lifecycle with owner-only direct nomination/cancellation, acceptance override and contract-specific errors/events. |
| GovernanceV2 timing and guardian bounds | 1 | Nomination execution fails one second before ETA and succeeds at ETA; zero guardian rotation reverts through the real timelock. |
| CommitmentVaultV2 configuration handover | 1 | Acceptance emits configuration cancellation, clears pending limits/ETA, denies the old owner and prevents the new owner from executing the stale configuration. |
| LendingVaultV2 guardian | 5 | Queue and 48-hour delay required; nominee contract alone accepts; EOA/owner/stranger cannot accept; pending guardian has no pause power; incumbent retains power until replacement accepts; old guardian loses pause power; acceptance/cancellation/overwrite events; stale or repeated acceptance rejected; zero/EOA rejected without clearing a valid nominee; non-owner cannot queue, nominate or cancel. |
| Legacy single-step evidence, marked `FINDING [Low]` | 18 | Ten owner transfers (eight deployed V1 plus two unlisted integrations), Governance owner transfer through its timelock, PartnerVault admin transfer and six guardian transfers. Each proves immediate role replacement without acceptance, events, old-role privilege loss and new-role authority. Zero transfer is rejected for every tested setter; six OZ1 contracts also demonstrate immediate renunciation to zero. |

All negative paths assert the specific error/revert and relevant state. V1
Governance wraps target revert bytes in an `Error(string)`; its zero-owner test
compares the complete nested revert data and verifies that execution remains
unmarked. No impersonation or storage/code mutation is used for transfers. The
guardian tests reuse the existing `LendingVaultV2Actor` mock to call acceptance
from a real contract address.

Ownership events asserted are `OwnershipTransferStarted`, `OwnershipTransferred`,
`OwnershipTransferCancelled` (GovernanceV2/CommitmentVaultV2), and
`OwnershipNominationCancelled` (LendingVaultV2). Vault cancellation additionally
emits the inherited `OwnershipTransferStarted(owner, zero)` without transferring
ownership to zero. Guardian events are `GuardianNominated` and `GuardianAccepted`.

## FINDINGs and remaining scope

All findings below retain **Low** severity, matching CWA-16. They require a
privileged caller to select an unintended recipient; they do not demonstrate an
unprivileged takeover. A mistyped/inaccessible destination can immediately take
control or strand future administration. Zero-address checks do not prove the
recipient can exercise the role, and a timelock does not provide acceptance.

| FINDING | Contract and source | Evidence and consequence |
| --- | --- | --- |
| F01 (Low) | `contracts/liquidity/LiquidityReserve.sol:155`, `:133` | Owner transfer and owner-managed guardian rotation take effect without recipient acceptance. |
| F02 (Low) | `contracts/burnreserve/BurnReserve.sol:96`, `:88` | Same for reserve owner and burn guardian. |
| F03 (Low) | `contracts/buyback/BuybackVault.sol:178` | Owner transfer is immediate; immutable guardian is not transferable. |
| F04 (Low) | `contracts/buyback/BuybackController.sol:257` | Owner transfer is immediate; immutable guardian is not transferable. |
| F05 (Low) | `contracts/token/InfernoToken.sol:11`, `:28` + OZ1 `Ownable.sol:84` | Inherited single-step transfer; explicit renunciation immediately sets owner to zero. |
| F06 (Low) | `contracts/vault/CommitmentVault.sol:16`, `:62` + OZ1 `Ownable.sol:84` | Same inherited transfer/renunciation behavior. |
| F07 (Low) | `contracts/vault/LendingVault.sol:18`, `:99` + OZ1 `Ownable.sol:84` | Same inherited transfer/renunciation behavior, even though V1 lending is retired. |
| F08 (Low) | `contracts/BuilderRegistry.sol:17`, `:73` + OZ1 `Ownable.sol:84` | Same inherited transfer/renunciation behavior. |
| F09 (Low) | `contracts/governance/Governance.sol:128`, `:120` | Ownership changes immediately when its queued self-call executes, without acceptance; guardian rotation is direct. |
| F10 (Low) | `contracts/partner/PartnerVault.sol:391`, `:400` | Admin and guardian are each replaced directly by their incumbent role. |
| F11 (Low) | `contracts/lock/IFRLock.sol:108` | Guardian replaces itself directly, with immediate pause-authority loss. |
| F12 (Low) | `contracts/vesting/Vesting.sol:75` | Same single-step guardian rotation; immutable beneficiary is unaffected. |
| F13 (Low; unlisted integration) | `contracts/vault/PriceLockVault.sol:30`, `:99` + OZ1 `Ownable.sol:84` | Newer source still uses single-step ownership and permits renunciation; reassess before deployment. |
| F14 (Low; unlisted integration) | `contracts/library/IFRBuilderVault.sol:19`, `:32` + OZ1 `Ownable.sol:84` | Library consumer still uses single-step ownership and permits renunciation; partner deployments need their own review. |

No tested V1 ownership/admin/guardian transfer setter accepts zero. The only
tested immediate transition to a zero owner is the separate inherited
`renounceOwnership()` API, which is intentional OZ1 behavior. These facts must not
be reported as a zero-address transfer vulnerability.

GovernanceV2's guardian is still rotated in one timelocked self-call at
`contracts/governance/GovernanceV2.sol:200`; its owner being two-step does not make
every role two-step. LendingVaultV2 requires guardian contract code but does not
prove the controller's own ownership semantics (`contracts/vault/LendingVaultV2.sol:319`).
These are explicit inventory limitations, not claims of owner-transfer failure.
FeeRouterV1 has no governance transfer API to exercise; constructor-only governance
and immutable buyback guardians therefore have no fabricated transfer tests.

Future release/migration review should retain the acceptance/cancellation tests,
use two-step ownership in new contracts, verify exact deployment bytecode and
controller identity, and separately authorize any live migration. Existing
single-step V1 contracts are not repaired by these tests. No register disposition,
production contract, existing test, generated document or on-chain role changed.

## Verification

Forking was explicitly disabled and `--no-compile` used because the supplied
contracts were already compiled and the task forbids network access:

```sh
HARDHAT_FORK=false HARDHAT_DISABLE_TELEMETRY_PROMPT=true \
  ./node_modules/.bin/hardhat test --no-compile test/Ownership.cwa16.test.js
HARDHAT_FORK=false HARDHAT_DISABLE_TELEMETRY_PROMPT=true \
  npm run test:contracts -- --no-compile
```

- Focused new suite: **46 passing, 0 failing**.
- Initial full-suite attempt: **1,044 passing, 1 failing**. The existing Builder
  generated-contract test timed out acquiring the global Hardhat compiler-list
  download mutex. That test compiles generated contracts internally even with
  `--no-compile`.
- Offline Builder verification: **9 passing, 0 failing**, using existing cached
  solc-js 0.8.20/0.8.28 bundles by explicit compiler paths. Both bundles' SHA-256
  hashes matched the existing local Hardhat compiler list. A temporary preload
  under `/tmp` assigned only `compiler.path` to every configured compiler and
  override; compiler versions/settings and all tests were unchanged. This avoids
  the downloader and its global mutex without writing global caches or using the
  network.
- Full contract suite with offline compiler paths: **1,045 passing, 0 failing**
  (999 existing tests plus 46 new CWA-16 tests).
- Precompiled-artifact provenance: all **26 non-mock contract sources** matched
  their embedded compiler inputs in `artifacts/build-info/`; no source drift was
  found. This comparison is local and does not establish deployed bytecode parity.
- JavaScript syntax and the new Markdown file's lint check passed; Markdown lint
  used the repository's existing disabled-rule policy.
- `npm run check:markdownlint`: **blocked by the existing file-count baseline**,
  `243 -> 244`, solely because this new Markdown file is included. There are no
  new lint findings. Updating `audit/markdownlint-baseline.json` is outside this
  task's two owned files, so the coordinator must handle that baseline adjustment
  before the documentation CI gate can pass.

The full command uses the existing package script's `test/*.test.js` and
`test/library/*.test.js` globs, including the new file. This task adds no fork
suite or external-network check and makes no claim of live deployment validation.

To reproduce the offline run on this machine, preload a temporary module that
imports this worktree's `hardhat.config.js` and assigns `path` on each member of
`config.solidity.compilers` and `Object.values(config.solidity.overrides)`:

| Compiler version | Existing local bundle |
| --- | --- |
| 0.8.20 | `/Users/gio/Library/Caches/hardhat-nodejs/compilers-v3/wasm/soljson-v0.8.20+commit.a1b79de6.js` |
| 0.8.28 | `/Users/gio/Library/Caches/hardhat-nodejs/compilers-v3/wasm/soljson-v0.8.28+commit.7893614a.js` |

```sh
HARDHAT_FORK=false HARDHAT_DISABLE_TELEMETRY_PROMPT=true \
  NODE_OPTIONS='--import=/tmp/inferno-cwa16-offline-compilers.mjs' \
  npm run test:contracts -- --no-compile
```

The preload is verification-only and is removed after use; it is not a repository
change or a skipped test.
