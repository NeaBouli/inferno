# Major-Upgrade-Status

> Erstellt: 2026-04-14 | Alle PRs geschlossen mit Verweis auf diese Datei.

## Inferno

| PR | Package | Von | Zu | Aufwand | Priorität |
|----|---------|-----|----|---------|-----------|
| #2 | actions/setup-node | 4 | 6 | Gering | 1 |
| #3 | actions/checkout | 4 | 6 | Gering | 1 |
| #8 | hardhat | 2.28.6 | 3.11.1 | Erledigt 29.07.2026 | - |
| #5 | @nomicfoundation/hardhat-verify | 2.1.3 | 3.0.21 | Erledigt 29.07.2026 | - |
| #7 | chai | 4.5.0 | 6.2.2 | Erledigt 29.07.2026 | - |
| #4 | ethers | 5.8.0 | 6.17.0 | Erledigt 29.07.2026 | - |

## Migrationsreihenfolge

1. **#2 + #3 — GitHub Actions v6** — EINFACH
   - Node.js Runtime-Update, keine Code-Änderungen nötig
   - Kann sofort gemacht werden

2. **#4 — ethers v6** — ERLEDIGT
   - Alle Root-Tests, Admin-Tasks und Hardhat-/Governance-Skripte auf
     native `bigint` und die Ethers-6-APIs migriert
   - Root bleibt fuer diesen isolierten Schritt auf Hardhat 2.28.6
   - Vollstaendige Contract-, Generator-, SDK- und Wallet-UI-Gates bestanden

3. **#8 + #5 + #7 — Hardhat 3 + Verify 3 + Chai 6** — ERLEDIGT
   - Root-Projekt auf ESM und Node.js `>=22.13.0` umgestellt
   - Hardhat-Plugins, Config, Tasks, Tests und Laufzeitskripte migriert
   - Native Hardhat-3-Coverage ersetzt die alte `solidity-coverage`-Abhängigkeit

## Hinweise

- Dependabot wird diese PRs erneut öffnen — ggf. `ignore` Regeln in `.github/dependabot.yml` setzen
- Vor jeder Migration: lokalen Branch erstellen, vollständige Testsuite durchlaufen

## 2026-07-08 Operational Note

The root audit backlog is still mostly toolchain debt, not production contract runtime code.

Current constraints:

- `hardhat@2`
- `ethers@5`
- `@nomiclabs/hardhat-waffle`
- `ethereum-waffle`
- Ganache/transitive test dependencies

Do not run `npm audit fix --force` on `main`. A forced fix would cross multiple breaking boundaries at once and would likely touch Hardhat config, test helpers, scripts, deploy flows, and ethers BigNumber usage.

Recommended separate branch:

```bash
git checkout -b chore/dependency-modernization
```

Suggested order:

1. Remove Waffle usage from tests and replace matcher assumptions with Hardhat/Chai equivalents.
2. Remove Ganache/Waffle transitive dependency path.
3. Migrate Hardhat plugins to the current Nomic Foundation stack.
4. Migrate ethers v5 scripts/tests to ethers v6 or confirm Hardhat plugin compatibility first.
5. Run the full contract suite after each step:
   - `npm ci`
   - `npx hardhat test`
   - `npx hardhat test test/*.test.js`
   - `node scripts/docs-validator.js`

Keep this separate from protocol governance and Web3 UX changes.

## 2026-07-19 Benefits Network Update

The production Shop dependency slice is separated from the root contract toolchain migration:

- Frontend upgraded to Next.js 15.5 and wagmi 3 with direct injected, Coinbase Wallet and
  optional WalletConnect connectors. RainbowKit was removed from this surface.
- Frontend clean install and `npm audit --audit-level=low`: no known vulnerabilities.
- Backend migrated its isolated runtime from Ethers 5 to Ethers 6.17. The former
  `@ethersproject/signing-key -> elliptic` tree is absent after a clean install, and
  `npm audit --audit-level=low` reports no known vulnerabilities.
- Direct local JSON-RPC coverage verifies native-`bigint` IFRLock thresholds, reward tuple
  decoding, real chain-ID comparison, zero-beneficiary handling and read-only reward checks.
- Benefits CI enforces the low-severity audit threshold for both frontend and backend before
  typechecks, tests and builds.

The root Hardhat migration remains separate. Waffle/Ganache have since been removed and all
active app manifests now use Ethers 6. Do not apply the Shop lockfile changes to the contract
toolchain and do not use `npm audit fix --force`.

## 2026-07-29 Root Ethers 6 Completion

- Root runtime: `ethers@6.17.0` with `@nomicfoundation/hardhat-ethers@3.1.3`.
- Hardhat remained at `2.28.6` for this isolated step and was migrated separately afterward.
- The obsolete Ethers 5 formatter patches and direct `@ethersproject/providers` dependency
  were removed.
- Verification: clean install, compile, 642 contract tests, 30 generator tests, 36 SDK tests,
  12 vote-announcement tests, Lending price self-test and all three Benefits Wallet UI paths.
- Remaining root audit findings are transitive Hardhat 2 / coverage toolchain debt. There are
  no critical findings; do not use `npm audit fix --force`.

## 2026-07-29 Hardhat 3 Completion

- Root toolchain: `hardhat@3.11.1`, `@nomicfoundation/hardhat-ethers@4.0.15`,
  `@nomicfoundation/hardhat-ethers-chai-matchers@3.0.11`,
  `@nomicfoundation/hardhat-mocha@3.0.21`,
  `@nomicfoundation/hardhat-verify@3.0.21`, `chai@6.2.2` and `mocha@11.7.6`.
- Root package and Hardhat configuration use ESM. Explicit nested CommonJS package boundaries
  preserve legacy scripts and non-Hardhat tests.
- Contract tests use explicit Hardhat 3 network connections and the new asynchronous revert
  matchers. Existing Hardhat scripts connect through the shared runtime adapter.
- Contract-related CI uses Node.js 22. `solidity-coverage` was removed in favor of Hardhat 3's
  built-in `--coverage` mode.
- The unrelated root browser-test dependency remains pinned to `@playwright/test@1.58.2`.
  This preserves the previously green browser matrix and prevents a Hardhat lockfile refresh
  from silently advancing Playwright across its separate browser/platform boundary.
- The current root audit backlog is limited to transitive upstream packages; no Critical
  finding remains and no force-upgrade or untested override is permitted.

## 2026-07-19 Critical Patch Update

Two repository-wide critical alerts can be removed without a breaking migration:

- AI Copilot overrides the exact `concurrently` pin from vulnerable `shell-quote@1.8.3` to
  patched `1.8.4`. A clean install reports 22 remaining findings, with zero critical.
- Creator Gateway resolves the `ts-jest` development dependency from vulnerable
  `handlebars@4.7.8` to patched `4.7.9`. A clean install reports 29 remaining findings, with
  zero critical; TypeScript build and all 41 tests pass.

The remaining root critical alert cannot be fixed by the existing global `elliptic@6.6.1`
override. `@ethereum-waffle/provider@4.0.5` pins `ganache@7.4.3`, and Ganache bundles its own
`secp256k1 -> elliptic@6.5.4` tree. Even `ganache@7.9.2` still ships that bundled vulnerable
path, so a Ganache override would not close the alert and would create broad unrelated lockfile
churn. Remove Waffle/Ganache as described above; do not claim the root alert fixed before that
migration and its full contract-suite evidence exist.
