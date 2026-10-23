# JUL-21 Mainnet Compiler and Source Provenance Evidence

Evidence date: 2026-10-23. JUL-21 remains **Accepted or monitored**.

## Evidence and scope

Claude fetched Sourcify v2 responses for all 15 contracts in
[`deployments/mainnet.json`](../../deployments/mainnet.json) on 2026-10-23.
This offline review checked the cached chain IDs and addresses against the
manifest and derived
[`audit/compiler-provenance-mainnet.json`](../../audit/compiler-provenance-mainnet.json).
The derived file stores settings, fully qualified names, reported creation/runtime
matches and SHA-256 hashes without source contents. The raw
`.provenance-cache/<ContractName>.json` responses remain untracked. No network
request, compilation or independent on-chain bytecode verification was performed.

Every response reports `exact_match` for both creation and runtime. Fourteen
contracts used `0.8.20+commit.a1b79de6`, optimizer disabled with 200 runs, and
EVM `paris`. CommitmentVaultV2 used `0.8.28+commit.7893614a`, optimizer disabled
with 200 runs, and `cancun`. None records an explicit `viaIR` setting.

Project hashes cover exact UTF-8 source contents, including whitespace and line
endings. Dependency sources under `@openzeppelin/` or `npm/` are excluded.
CommitmentVaultV2's source path is `project/contracts/vault/CommitmentVault.sol`;
the hash record retains that `sourcePath` and maps it to
`contracts/vault/CommitmentVault.sol` for comparison. Its fully qualified name
remains `project/contracts/vault/CommitmentVault.sol:CommitmentVault`.

## Per-contract result

The current config selects solc `0.8.28`, optimizer `off/200`, EVM `cancun` for
each root source. `Config` compares version, optimizer enabled/runs and EVM.
`Source drift` counts differing or missing project files over recorded project
files. Compiler versions below use the commit hashes given above.
`exact/exact` means Sourcify creation/runtime `exact_match`.

| Contract | Deployed solc | Optimizer | EVM | Sourcify creation/runtime | Config | Source drift |
| --- | --- | --- | --- | --- | --- | --- |
| InfernoToken | 0.8.20 | off/200 | paris | exact/exact | DRIFT | 0/1 |
| Governance | 0.8.20 | off/200 | paris | exact/exact | DRIFT | 1/1 |
| IFRLock | 0.8.20 | off/200 | paris | exact/exact | DRIFT | 0/1 |
| BurnReserve | 0.8.20 | off/200 | paris | exact/exact | DRIFT | 0/1 |
| BuybackVault | 0.8.20 | off/200 | paris | exact/exact | DRIFT | 1/1 |
| PartnerVault | 0.8.20 | off/200 | paris | exact/exact | DRIFT | 0/1 |
| FeeRouterV1 | 0.8.20 | off/200 | paris | exact/exact | DRIFT | 0/1 |
| Vesting | 0.8.20 | off/200 | paris | exact/exact | DRIFT | 0/1 |
| LiquidityReserve | 0.8.20 | off/200 | paris | exact/exact | DRIFT | 0/1 |
| BootstrapVaultV3 | 0.8.20 | off/200 | paris | exact/exact | DRIFT | 1/1 |
| CommitmentVault | 0.8.20 | off/200 | paris | exact/exact | DRIFT | 1/1 |
| LendingVault | 0.8.20 | off/200 | paris | exact/exact | DRIFT | 1/1 |
| BuilderRegistry | 0.8.20 | off/200 | paris | exact/exact | DRIFT | 0/1 |
| BuybackController | 0.8.20 | off/200 | paris | exact/exact | DRIFT | 1/1 |
| CommitmentVaultV2 | 0.8.28 | off/200 | cancun | exact/exact | MATCH | 0/1 |

## Source comparison conclusion

Nine deployed project sources are byte-identical to the current repository:

| Contract | Identical repository file |
| --- | --- |
| InfernoToken | `contracts/token/InfernoToken.sol` |
| IFRLock | `contracts/lock/IFRLock.sol` |
| BurnReserve | `contracts/burnreserve/BurnReserve.sol` |
| PartnerVault | `contracts/partner/PartnerVault.sol` |
| FeeRouterV1 | `contracts/FeeRouterV1.sol` |
| Vesting | `contracts/vesting/Vesting.sol` |
| LiquidityReserve | `contracts/liquidity/LiquidityReserve.sol` |
| BuilderRegistry | `contracts/BuilderRegistry.sol` |
| CommitmentVaultV2 | `contracts/vault/CommitmentVault.sol` |

Six deployed project sources differ from the current repository:

| Contract | Differing repository file |
| --- | --- |
| Governance | `contracts/governance/Governance.sol` |
| BuybackVault | `contracts/buyback/BuybackVault.sol` |
| BootstrapVaultV3 | `contracts/bootstrap/BootstrapVaultV3.sol` |
| CommitmentVault (V1) | `contracts/vault/CommitmentVault.sol` |
| LendingVault | `contracts/vault/LendingVault.sol` |
| BuybackController | `contracts/buyback/BuybackController.sol` |

No project files are missing. V1 and V2 share the repository path but have
different deployed hashes; today's file matches V2 only. The 15 comparisons
cover 14 distinct repository files. These hashes establish exact source equality
or inequality without classifying semantic impact or comparing dependency hashes.

## What the drifted files contain

Reviewed by comparing the Sourcify sources with the repository files. Every
difference is a repository-only hardening that is **not live** on Mainnet; the
deployed contracts keep the verified, older behaviour:

| File | Repository-only change | Tracked as |
| --- | --- | --- |
| `Governance.sol` | `setOwner` restricted to `onlySelf` (timelocked); deployed is immediate `onlyOwner` | CWA-25, GovernanceV2 spec G-04 |
| `BuybackVault.sol` | fee-on-transfer swap variant, balance-diff accounting, parameter bounds | JUL-08, CWA-19 |
| `BuybackController.sol` | balance-diff accounting and parameter bounds | JUL-08, CWA-19 |
| `BootstrapVaultV3.sol` | one-time refund guard (`hasRefundOccurred`) | finalized contract; no live effect |
| `CommitmentVault.sol` | only `TIME_ONLY` locks accepted until a price oracle exists; superseded by CommitmentVaultV2 | CWA-03 |
| `LendingVault.sol` | `call` instead of `transfer` for ETH payouts, zero-address checks | LendingVaultV2 |

Public documentation must therefore never describe these repository fixes as
deployed behaviour of the V1 addresses.

## Redeployment requirements

A redeploy from the current config would **NOT reproduce deployed bytecode** for
the 14 historical solc 0.8.20/paris contracts. Listing 0.8.20 among the compilers
does not pin these sources: the highest root-pragma-compatible compiler is
selected unless a source override applies.

To reproduce historical builds, pin `version: "0.8.20"` and
`settings: { evmVersion: "paris", optimizer: { enabled: false, runs: 200 } }`
via Hardhat overrides for the relevant historical sources. Restore deployment-era
contents for the six changed files and preserve original dependencies, source
paths, remappings, libraries, metadata settings, any IR settings and
constructor/immutable inputs. Pinning solc alone does not prove reproducibility.

CommitmentVault V1 and V2 require separate historical build inputs/configurations:
they share a source path but differ in source contents and compiler/EVM settings.
Preserve V2's 0.8.28/cancun settings and original `project/` paths/remappings when
reproducing its verified input. Its config `MATCH` and identical project source
do not establish identical dependencies, metadata paths or complete bytecode.

Alternatively, accept new bytecode from the reviewed current source/config,
perform fresh explorer verification and preserve complete standard JSON compiler
input and build metadata as a new deployment record. This evidence authorizes
no deployment or on-chain action.

## Offline verification

`npm run test:compiler-provenance` runs fixture regressions and the Mainnet report;
`node scripts/check-compiler-provenance.cjs` runs the report alone. The checker
loads no Hardhat, plugins, credentials or `.env`, selects source overrides or the
highest root-pragma-compatible compiler, and recomputes SHA-256 against the working
tree rather than trusting snapshot `repoMatch` values. It does not compile
dependency graphs or compare deployed bytecode.

Historical `DRIFT` is informational and exits zero. Missing provenance records
produce `UNKNOWN` and a nonzero exit; malformed data also fails. A missing current
source or non-explicit current EVM target yields `UNKNOWN` for config selection
without inventing a match. Fixtures cover MATCH, compiler/optimizer/EVM DRIFT,
overrides, fresh hashes, missing files/records, malformed records and CLI exits.

The July register's status and remaining action stay unchanged. Full build
reproduction remains required before claiming bytecode reproducibility.
