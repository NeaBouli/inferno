# Inferno — Dependency Triage

> Scope: tracked dependency manifests and CI workflows at main 26a62cef; GitHub alerts and PR metadata. Date: 2026-09-13. Result: 0 proven exploit FAIL / 4 WARN / 1 PASS. This is a dependency inventory, not a full application security audit.

## Summary

GitHub reports ten open alerts: one high and nine medium. The root npm audit independently reports eight low package findings, all from the existing elliptic chain, with no moderate/high/critical findings. These are different scopes, not contradictory results. No dependency, credential, runtime or production configuration was changed in this triage. Live exploitability has not been established or ruled out for the affected app paths.

## Findings by domain

### Creator Gateway — WARN

- **HIGH: js-yaml 3.15.1** in `apps/creator-gateway/package-lock.json`, alert #301 / GHSA-2883-xcg3-v3hh. Parent: `@istanbuljs/load-nyc-config`, development dependency. GitHub identifies 3.15.2 as patched; the parent's `^3.13.1` range permits it. Prioritize a scoped lock refresh, clean install, Gateway tests/build and its low-threshold audit. Do not describe this development path as a proven public runtime exploit.

### Dashboard and wallet prototype — WARN

- **MEDIUM: hono 4.13.1** in both `apps/dashboard/package-lock.json` and `apps/benefits-wallet-prototype/package-lock.json`. Parent: `@wagmi/connectors/node_modules/porto`; not marked dev-only. Six alerts (#294-299), patched version 4.13.5 reported by GitHub, compatible with declared `^4.10.3`. Actual browser/server reachability needs bundle inspection. Keep wallet behavior unchanged and test connection/disconnection/fallback paths after any update.
- **MEDIUM: stream-json 1.9.1**, wallet prototype, alert #290. Parent `jayson` requires `^1.9.1`; reported patched 3.5.0 is outside that range. Do not force a major override. Trace the parent upgrade/removal path and bundle boundary before implementing.

### Mythril toolchain — WARN

- **MEDIUM: eth-abi 4.2.1 and setuptools 80.10.2**, alerts #291/#292 in `audit/requirements-mythril.txt`; GitHub reports fixes 5.0.1 and 83.0.0. These belong to a separately pinned Mythril 0.24.8 environment. Re-resolve from the `.in` file with hashes and prove Mythril compatibility; do not edit generated hashes or assume major versions compatible. This is analysis tooling, not the deployed IFR token.

### CI coverage — WARN

- `.github/workflows/security-audit.yml` runs npm audit at repository root, not recursively across every app. App workflows are path-filtered. Its Python discovery matches `requirements.txt`, not `audit/requirements-mythril.txt`. Therefore a green documentation release does not certify all dependency files against current advisories.
- Next isolated work: inventory-based scheduled audits for all supported app manifests and the named Python lockfile, with explicit reviewed exceptions and failing exit-code propagation. Do not weaken current thresholds or dismiss alerts merely to make checks green.

### Root dependency audit — PASS

- Fresh `npm audit --json --ignore-scripts`: 8 low, 0 moderate, 0 high, 0 critical. All reported fixes unavailable. Root Ethers 6 is not equivalent to removal of the transitive Ethers 5 verification-tool chain. No installation performed. Initial sandbox DNS failure was retried with scoped network permission; it was not counted as a passing audit.

## Priority matrix

1. Gateway compatible js-yaml refresh, then the two compatible hono refreshes with module tests and bundle inspection.
2. Independent stream-json parent-path and Mythril compatibility blocks; no forced major overrides.
3. Scheduled complete dependency inventory coverage.
4. Maintenance PR #81 (setup-python 7), #82 (Playwright 1.63), #83 (Hardhat 3.16): inspect each complete diff and rerun exact-head tests; none is a substitute for the above fixes. No PR merged by this triage.

## Verification and limits

- Compared all ten GitHub alerts with tracked package/version/parent records and workflow scopes.
- Existing physical-device reporter remains 1/10 PASS, 9 pending; its exit 0 validates the report, not full physical acceptance. Build-bound evidence and strict completion remain separate tasks.
- Kimi review attempted through the configured wrapper; failed before work with EMFILE. No independent review claimed.
- No secrets, device identifiers, wallet proofs or private architecture included. No credential rotation, signature, transaction or production action performed.
