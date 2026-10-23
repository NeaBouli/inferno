# BuilderRegistry Post-Deployment Rights Review

Review date: 23 October 2026. Repository baseline:
`0c80df349bda926639a960d76927bde23778d7ac`.

## Scope and conclusion

This is an offline reconciliation of the open BuilderRegistry review request,
the repository source and tests, recorded deployments, compiler provenance and
audit registers. It is not a fresh chain-state attestation or an independent
external audit. No contract changes, network queries or actions on deployed
networks were performed. Recorded observations retain their original dates/blocks.

The reviewed contract has **five owner-only mutating functions**, including two
inherited ownership functions. Governance can change registry records and its
owner; it cannot upgrade this implementation's code. The source and committed
ABI contain no proxy, implementation slot, delegatecall, upgrade entry point,
pause, guardian role, token custody or reward-payment function.

Evidence reviewed:

- [BuilderRegistry source](../../contracts/BuilderRegistry.sol),
  [committed ABI/artifact](../../abi/BuilderRegistry.json),
  [original 27 tests](../../test/BuilderRegistry.test.js) and
  [CWA-16 ownership tests](../../test/Ownership.cwa16.test.js).
- [Mainnet manifest](../../deployments/mainnet.json),
  [Sepolia manifest](../../deployments/sepolia.json),
  [deployment/ownership documentation](../DEPLOYMENTS.md),
  [deployment checklist](../BUILDER_REGISTRY_DEPLOY.md) and
  [Wiki contract entry](../wiki/contracts.html#builder-registry).
- [Existing 22 October source review](../BUILDER_REGISTRY_REVIEW.md),
  [compiler provenance](../../audit/compiler-provenance-mainnet.json),
  [JUL-21 evidence](JUL-21-COMPILER-PROVENANCE-EVIDENCE.md),
  [CWA-16 evidence](CWA-16-OWNERSHIP-EVIDENCE.md), and the
  [July](JULY_2026_REMEDIATION_REGISTER.md) and
  [CWA](CWA_REMEDIATION_REGISTER.md) remediation registers.

## Recorded authority and actual call path

| Principal | Repository record | Consequence |
| --- | --- | --- |
| Mainnet BuilderRegistry | `0xdfe6636DA47F8949330697e1dC5391267CEf0EE3`; deployment documentation says 20 March 2026 | This is the address matched by the Mainnet provenance record. The manifest has null deployer, transaction and timestamp fields. |
| Registry owner | Governance, `0xc43d48E7FDA576C5022d0670B652A622E8caD041`, in the deployment ownership table and September protocol audit | Only calls whose immediate sender equals the registry's current `owner()` pass `onlyOwner`. This is a recorded holder, not an October live read. |
| Governance owner | Treasury Safe, `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`, 3-of-5 at block `25971217` | The Safe proposes and executes Governance calls. Safe signers and the Safe itself have no direct registry rights while Governance owns it. |
| Governance guardian | Deployer EOA in the same recorded block snapshot | Can cancel Governance proposals, not propose/execute them or directly mutate BuilderRegistry. There is no registry guardian or emergency removal path. |

The authority snapshot is the
[14 September protocol audit](CWA_IFR_Protocol_Audit_2026-09-14.md), pinned to
Mainnet block `25971217` (13 September 2026). It records Governance delay
`172800` seconds (48 hours), with configurable bounds of 1 hour to 30 days.
These values are historical evidence, not guarantees of today's configuration.

The normal recorded path is Treasury Safe -> `Governance.propose(registry, data)`
-> wait until proposal ETA -> owner-only `Governance.execute(id)` -> registry
`onlyOwner`. Governance checks proposal existence, execution/cancellation flags
and ETA before calling the target. Its owner and guardian can cancel. Registry
authorization checks the immediate caller, not `tx.origin`, the builder wallet,
a Safe signer, or a separate governance role.

The constructor `BuilderRegistry(governance_)` merely passes its argument to
OpenZeppelin `Ownable`. It rejects zero and emits
`OwnershipTransferred(address(0), governance_)`; any nonzero address is accepted.
It does not check contract code, Governance identity or timelock support, and the
deployer receives no special right unless selected as owner. All five mutations
use the **current** owner; transfer can therefore remove Governance protection.

Important source-era qualification: the provenance records a different deployed
Governance source hash. JUL-21 documents deployed V1 `setOwner(nonzero)` as
immediate `onlyOwner`, whereas today's
[Governance source](../../contracts/governance/Governance.sol) uses `onlySelf`.
Changing the controlling Governance owner is not the same as changing registry
ownership. Do not infer that the deployed Governance owner's replacement is
timelocked from current source or the older CWA-16 inventory wording.

## Every privileged function

All five functions reject non-owners with
`OwnableUnauthorizedAccount(caller)` in the installed OpenZeppelin implementation
(package-lock version 5.6.1). The registry has no role-specific exceptions.
`wallet` is indexed in each builder event; both ownership event addresses are
indexed. Internal `_transferOwnership` is not an external entry point.

| Function | Authorized caller | State and existing checks | Event | Missing checks / consequences |
| --- | --- | --- | --- | --- |
| `registerBuilder(wallet, name, url, category)` | Current owner; recorded Governance via execution | Requires nonzero wallet, `isBuilder[wallet] == false`, nonempty name, and exact lowercase `creator`, `integration`, `tooling` or `dao`. Sets membership true; replaces all `BuilderInfo` fields, sets timestamp/active, and appends wallet to `_builderList`. | `BuilderRegistered(wallet, name, category, block.timestamp)` | No proof of wallet control, unique historical-wallet check, name/URL size bound, whitespace-only name check or URL-scheme validation. Re-registration after removal is permitted. URL is omitted from the event. |
| `removeBuilder(wallet)` | Current owner; recorded Governance via execution | Requires current membership. Sets `isBuilder[wallet]` and `builders[wallet].active` false. Retains name, URL, category, registration time and historical list entries. | `BuilderRemoved(wallet, block.timestamp)` | No independent zero-address check; an unregistered zero address fails membership. No metadata erasure, list pruning, reason field or registry emergency role. |
| `updateBuilder(wallet, name, url, category)` | Current owner; recorded Governance via execution | Requires current membership, nonempty name and valid category. Writes name, URL and category only; preserves membership, active flag, registration time and list. | `BuilderUpdated(wallet, name, url, category)` | No builder self-service/consent, URL validation or metadata length limits. No independent zero-address check; membership rejects zero. |
| Inherited `transferOwnership(newOwner)` | Current owner; recorded Governance via execution | Rejects zero with `OwnableInvalidOwner(address(0))`; immediately writes the new owner. Registry records remain unchanged. | `OwnershipTransferred(previousOwner, newOwner)` | No pending-owner acceptance, delay inside the registry, contract/Governance identity check, self-transfer restriction or recovery. A non-Governance successor receives all five rights immediately. |
| Inherited `renounceOwnership()` | Current owner; recorded Governance via execution | Sets owner to zero immediately, leaving registry records readable. | `OwnershipTransferred(previousOwner, address(0))` | No confirmation, recovery or override disabling renunciation. All five owner functions then become unreachable through ordinary transactions; even the former owner cannot restore control. |

The public read surface is `owner`, `builders`, `isBuilder`, `getBuilderInfo`,
`getBuilderCount`, `getBuilderAt` and `getActiveBuilders`. None changes state.
Out-of-range `getBuilderAt` reverts. There is no permissionless registration,
builder metadata edit or callable ownership acceptance function.

## Repository versus recorded deployed source and compiler

The Mainnet provenance entry names
`contracts/BuilderRegistry.sol:BuilderRegistry`, chain ID 1, at the registry
address above. It records Sourcify v2 evidence fetched **23 October 2026**:

| Item | Recorded deployment | Current repository / offline result |
| --- | --- | --- |
| Compiler | `0.8.20+commit.a1b79de6` | Highest compatible configured compiler is `0.8.28`; there is no BuilderRegistry override. |
| Optimizer | Disabled, 200 runs | Disabled, 200 runs by default; no drift on these two fields. |
| EVM target | `paris` | `cancun`; configuration drift. |
| Creation/runtime match | Both `exact_match` | These are recorded Sourcify results, not bytecode comparisons repeated by this review. |
| Project source SHA-256 | `c827253ea9feea41a395a2c65e73a587ae00a66b4c1f447398a4e45e3510a540` | Fresh SHA-256 of `contracts/BuilderRegistry.sol` equals this value; project-source drift is `0/1`. |

The source match covers exact UTF-8 contents, including whitespace. The record
does **not** include dependency source hashes. Installed Ownable behavior and the
committed ABI agree on the five mutations, but this alone does not establish the
deployed OpenZeppelin version, complete compiler input or reproducible bytecode.
The raw `.provenance-cache/BuilderRegistry.json` response is absent in this
worktree, so the recorded match claim cannot be independently reconstructed here.

For comparison, the recorded deployed Governance project hash is
`e394aeb057ee4145dbf70f3a097d2acb32ceb0a4bf8330366e36fe14ecd51fa5`;
the fresh repository hash is
`4f47edfb749e212756f1d5c6893c39e746c0d15c44027feafe66dbf474bf172b`.
This confirms source inequality; the semantic `setOwner` difference above comes
from the retained JUL-21 analysis, not from reconstructing missing source bodies.

Reproducing the historical registry build requires a dedicated 0.8.20/Paris
configuration plus deployment-era dependencies, source paths, metadata settings
and constructor inputs. The current configuration is not a historical build
recipe. Do not change the contract or compiler configuration as part of this
review; preserve complete inputs for a separately reviewed future deployment.

## Findings and recommendations

Severity reflects the demonstrated scope. No unprivileged write, direct fund-loss
path, or Critical/High/Medium issue was established by this bounded review.
Owner-authorized behavior is not described as a permission bypass.

| ID | Severity | Finding and evidence | Recommendation / register relationship |
| --- | --- | --- | --- |
| BR-01 | Low | The open operations request says the contract is "upgradeable via Governance", but the reviewed source/ABI exposes record changes and ownership changes only. Wiki "Governance (Timelock)" wording omits transferable ownership and renunciation. | Correct the task wording to registry administration review. Document all five rights and conditional timelock protection; a code change requires a new deployment/migration. This report reconciles the claim without marking an external audit complete. |
| BR-02 | Low | Single-step ownership transfer can strand control or move all rights to an arbitrary nonzero address; renunciation permanently freezes administration. Requires the current owner, with the upstream delay while Governance owns the registry. | Preserve monitoring of ownership proposals/events; use reviewed two-step ownership and an explicit renunciation policy in a future version. Existing **CWA-16** remains governance/owner gated; these tests are evidence, not remediation. |
| BR-03 | Low | Owner removal followed by re-registration appends the same wallet again. Both historical entries pass the current-membership filter, so `getActiveBuilders()` returns duplicates and `getBuilderCount()` counts registration entries, not unique wallets. History and both enumeration passes grow without a bound. | Deduplicate consumers and use direct membership reads for authorization. A future version should track unique historical membership and support bounded enumeration. No duplicate reward payment is established. |
| BR-04 | Low | Current 0.8.28/Cancun build selection differs from recorded 0.8.20/Paris despite identical registry project source. Dependency/compiler-input coverage is incomplete. | Preserve and reproduce the historical build before claiming bytecode parity. This remains part of **JUL-21**, accepted/monitored; do not close it from the project hash match. |
| BR-05 | Informational | Metadata is owner-supplied without size/scheme checks; removal retains it, and registration events omit URL. An event-only mirror cannot reconstruct complete metadata from logs alone. | Treat metadata as untrusted display data; apply output encoding/link policy and resource bounds in consumers. Read metadata at the registration block or decode transaction input; do not promise erasure. No consumer injection vulnerability was validated in this scope. |

## Open request and audit-register reconciliation

The precise open request is in
[operations TODO, Core Developer](../../internal/operations/TODO.md), currently
"BuilderRegistry audit (post-deploy — contract is upgradeable via Governance)".
The [deployment checklist](../BUILDER_REGISTRY_DEPLOY.md) also leaves
"Audit completed" unchecked while marking deployment and explorer verification
complete. The [22 October review](../BUILDER_REGISTRY_REVIEW.md) already identifies
the five rights and enumeration risk; this report adds explicit provenance,
recorded authority, severity and focused access-control coverage.

The September contract deep audit labels BuilderRegistry CLEAN and reports a
source match; that historical result is compatible with documenting intended
owner powers and lifecycle/operational limitations here. Explorer verification,
a matching project hash, or passing rights tests does not convert this bounded
internal review into an external certification or automatically close a checkbox.

- CWA-16: retain **governance or owner gated**; the registry continues to inherit
  single-step Ownable and renunciation.
- JUL-21: retain **accepted or monitored**; compiler drift is documented rather
  than resolved, and complete bytecode reproduction remains outstanding.
- CWA-56: retain **informational, no action**; being listed as a builder product
  does not imply on-chain registry activation or reward eligibility being funded.

Registration itself grants no PartnerVault funds, budget or milestone. As the
existing review notes, PartnerVault has separate administration and no direct
registry call. Telegram configuration/whitelists are separate authorization
inputs. No runtime integration or reward activation was tested here.

## Test coverage and verification

The original suite has 27 cases, but non-owner rejection is tested only for
`registerBuilder` and `removeBuilder`. It lacks non-owner `updateBuilder` coverage
and dedicated coverage of both inherited mutations. CWA-16 separately exercises
legacy ownership behavior; it does not replace a complete registry rights suite.

[BuilderRegistry.rights.test.js](../../test/BuilderRegistry.rights.test.js) adds
24 cases using local simulated accounts, with no hardcoded wallet addresses:

- Each of the five functions rejects the deployer, an outsider and a registered
  builder with exact caller/error checks and unchanged registry state.
- Each accepts the explicit constructor owner, checks the resulting state and
  exact event arguments, and transfers that right immediately to a successor
  while rejecting the former owner.
- Zero initial/successor owners are rejected; renunciation disables all five
  mutations for every fixture principal while preserving readable records.
- Removal/re-registration reproduces duplicate active enumeration; this records
  existing behavior, not a fixed contract.
- Each function is exercised through locally deployed repository Governance:
  direct Safe-owner/guardian equivalents are rejected, guardian proposal and
  execution attempts fail, early execution fails, and execution after ETA emits
  the registry event and `ProposalExecuted`.

Local Governance tests establish today's source behavior only. They do not prove
parity with deployed Governance V1 or the historical compiler/dependency set.

| Check | Result |
| --- | --- |
| `npx hardhat test test/BuilderRegistry*.js` | Blocked before compilation/tests: `MultiProcessMutexTimeoutError`, waiting 60000 ms for the global `compiler-download-list` lock under `/Users/gio/Library/Caches/hardhat-nodejs/compilers-v3`. This is the observed cache-lock failure; no solc download failure was observed. |
| Direct local-compiler CLI fallback, same two test files | PASS, exit 0: **51 passing (51 mocha)** in 10 seconds: 27 existing + 24 new cases. Hardhat compiled 44 Solidity files with solc 0.8.28, EVM Cancun. |
| `node scripts/check-markdownlint-baseline.cjs` | Exit 1 solely for `tracked-files COUNT: 248 -> 249` after adding this required report. No changed/new lint fingerprints were reported. The baseline was not modified. |
| Direct markdownlint on this report, using the baseline's disabled rules | PASS, exit 0, no findings. |
| `node scripts/test-docs-truth.cjs` | PASS, exit 0. Its retained canonical 700-test evidence is historical; this does not assert a new full-suite run. |
| `node --check test/BuilderRegistry.rights.test.js` | PASS, exit 0. |
| `node scripts/check-compiler-provenance.cjs` | PASS: 15/15 records, 1 MATCH / 14 informational DRIFT / 0 UNKNOWN; BuilderRegistry config DRIFT with source `0/1`. |

Tests use `HARDHAT_FORK=false`, `DOTENV_CONFIG_PATH=/dev/null` and
`npm_config_offline=true`. Both solc versions are present in the read-only local
cache. An additional run with a temporary Hardhat configuration points directly
to those compiler files, preserving repository version/settings selection and
placing all build outputs under `/private/tmp` to avoid the global download lock.
The successful command was
`node node_modules/hardhat/dist/src/cli.js test --config .builder-registry-offline.config.mjs test/BuilderRegistry*.js`.
The temporary configuration imported `hardhat.config.js` and added a local `path`
to every configured compiler and override, pointing at the cached WASM solc
0.8.20/0.8.28 files. All version and optimizer/EVM settings stayed unchanged.
The temporary configuration and build outputs were removed after verification;
the repository compiler configuration and committed ABI/artifact were unchanged.

## Unverifiable offline

- Current registry `owner()`, Governance owner/guardian/delay, Safe membership and
  threshold, pending proposals, builder membership/counts and events after the
  recorded snapshots. In particular, this review makes no current "zero builders"
  assertion.
- Independent on-chain creation/runtime bytecode equality, explorer/Sourcify
  response authenticity or freshness, complete deployed dependency sources and
  compiler input, and whether the committed artifact reproduces deployed code.
- Exact registry deployment transaction, deployment block, deploying account,
  constructor encoding and timestamp: the manifest leaves these unknown. A date
  in deployment prose cannot substitute for a verified deployment receipt.
- Sepolia BuilderRegistry provenance: the Sepolia manifest contains no registry
  entry and the Mainnet provenance file cannot authenticate another chain. Follow
  the Wiki's canonical testnet record; do not copy historical cross-chain address
  reuse claims into a new deployment assertion.
- Actual production bot/consumer configuration, metadata rendering, event-indexer
  completeness, reward allocation or settlement, and subsequent governance
  changes. These need separately authorized current evidence.

The work closes the requested offline rights reconciliation. Live-state
attestation, external review and contract remediation remain separate work.
