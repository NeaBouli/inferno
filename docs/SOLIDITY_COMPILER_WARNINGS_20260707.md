# Solidity Compiler Warning Review - 2026-07-07

This note reviews the generic Solidity compiler warnings shown by Etherscan/Sourcify for IFR contracts.

## Scope

- Reported warning set:
  - `LostStorageArrayWriteOnSlotOverflow`
  - `VerbatimInvalidDeduplication`
  - `FullInlinerNonExpressionSplitArgumentEvaluationOrder`
  - `MissingSideEffectsOnSelectorAccess`
- Local repo checks:
  - `hardhat.config.js`
  - `artifacts/build-info/*.json`
  - `contracts/**/*.sol`
- Official references:
  - Solidity known bugs: https://docs.soliditylang.org/en/latest/bugs.html
  - `bugs.json`: https://raw.githubusercontent.com/argotorg/solidity/develop/docs/bugs.json
  - `bugs_by_version.json`: https://raw.githubusercontent.com/argotorg/solidity/develop/docs/bugs_by_version.json

## Compiler Versions

- Hardhat config contains two compilers:
  - `0.8.20`, `evmVersion: paris`
  - `0.8.28`, `evmVersion: cancun`
- All IFR Solidity source files use `pragma solidity ^0.8.20`.
- Current local build-info artifact:
  - `solcVersion: 0.8.28`
  - `solcLongVersion: 0.8.28+commit.7893614a`
  - optimizer disabled
  - `viaIR` unset/null
  - `evmVersion: cancun`
- The four reported Explorer warnings match the official `bugs_by_version.json` entry for Solidity `0.8.20`.

## Pattern Checks

Commands run:

```sh
rg -n "\\bverbatim\\b|\\.selector\\b|\\bassembly\\b|\\bviaIR\\b|optimizerSteps|optimizer_steps|transient|tstore|tload|delete\\s+[^;]*\\[|delete\\s+\\w+" contracts hardhat.config.js test scripts
rg -n "\\[\\]|\\[[0-9]+\\]|mapping|delete|push\\(|pop\\(|\\.selector|assembly|verbatim|transient|tstore|tload" contracts
```

Results:

- No `verbatim`.
- No inline `assembly`.
- No `.selector` use in project Solidity contracts.
- No `viaIR` setting.
- No custom `optimizerSteps` / `optimizer_steps`.
- No transient storage syntax or `tstore` / `tload`.
- `delete` appears only on mapping values:
  - `contracts/lock/IFRLock.sol`
  - `contracts/library/HardLockModule.sol`
- Dynamic storage arrays exist and are appended with `.push()`, but there is no project-specific evidence of the storage-boundary layout needed to trigger `LostStorageArrayWriteOnSlotOverflow`.

## Warning Assessment

| Warning | Official trigger | IFR-specific assessment |
| --- | --- | --- |
| `LostStorageArrayWriteOnSlotOverflow` | Clearing/copying arrays that straddle the end of storage. Fixed in `0.8.32`. Severity: low. | Generic compiler-version warning. IFR uses ordinary storage layout. No evidence of a project-specific trigger; accidental trigger is effectively unrealistic because it requires an array placed at the storage boundary. |
| `VerbatimInvalidDeduplication` | Yul `verbatim` blocks under opcode optimizer deduplication. Fixed in `0.8.23`. Severity: low. | Not affected. IFR Solidity sources do not use Yul `verbatim`; official bug description states Solidity sources are not affected. |
| `FullInlinerNonExpressionSplitArgumentEvaluationOrder` | Custom Yul optimizer sequence with FullInliner not preceded by ExpressionSplitter. Fixed in `0.8.21`. Severity: low. | Not affected. Optimizer is disabled in current build-info and no custom optimizer sequence is configured. |
| `MissingSideEffectsOnSelectorAccess` | `.selector` access on complex expressions with side effects in legacy codegen. Fixed in `0.8.21`. Severity: low. | Not affected. IFR contracts do not use `.selector`; current build-info also has no `viaIR` override. |

## Additional Note For Local `0.8.28`

Official `bugs_by_version.json` lists `TransientStorageClearingHelperCollision` and `LostStorageArrayWriteOnSlotOverflow` for `0.8.28`.

IFR-specific assessment:

- `TransientStorageClearingHelperCollision` requires `viaIR: true`, `evmVersion >= cancun`, and `delete` on transient storage. IFR does not use transient storage and `viaIR` is unset/null, so this is not triggered.
- `LostStorageArrayWriteOnSlotOverflow` remains the same low-severity generic storage-boundary warning discussed above.

## Conclusion

The Explorer warnings are generic compiler-version warnings, not evidence of an exploitable IFR code issue.

No deployed IFR contract needs a redeploy solely because of these low-severity generic warnings. For the next contract release, prefer the latest stable Solidity `0.8.x` that is compatible with the codebase and re-run the full test/security suite before deployment.
