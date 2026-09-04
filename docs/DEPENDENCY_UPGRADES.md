# Major-Upgrade-Status

> Erstellt: 2026-04-14 | Alle PRs geschlossen mit Verweis auf diese Datei.

## Inferno

| PR | Package | Von | Zu | Aufwand | Priorität |
|----|---------|-----|----|---------|-----------|
| #2 | actions/setup-node | 4/5/6 | 7 | Erledigt 26.08.2026 | - |
| #3 | actions/checkout | 4 | 7.0.1 | Erledigt | - |
| #8 | hardhat | 2.28.6 | 3.12.0 | Erledigt 29.07.2026 | - |
| #5 | @nomicfoundation/hardhat-verify | 2.1.3 | 3.0.22 | Erledigt 29.07.2026 | - |
| #7 | chai | 4.5.0 | 6.2.2 | Erledigt 29.07.2026 | - |
| #4 | ethers | 5.8.0 | 6.17.0 | Erledigt 29.07.2026 | - |
| #74 | hardhat | 3.12.0 | 3.15.0 | Lokal verifiziert 04.09.2026; CI offen | - |
| #76 | @nomicfoundation/hardhat-verify | 3.0.22 | 3.1.0 | Lokal verifiziert 04.09.2026; CI offen | - |

## Migrationsreihenfolge

1. **#2 + #3 — GitHub Actions** — ERLEDIGT
   - `actions/checkout` ist auf den geprüften v7.0.1-Commit gepinnt.
   - `actions/setup-node` ist auf den geprüften v7-Commit gepinnt.
   - Keine beweglichen Major-Tags verbleiben in den aktiven Workflows.

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

## Historical Operational Note — 2026-07-08

At that date, the root audit backlog was mostly toolchain debt, not production
contract runtime code. The constraints and migration plan below are retained
as historical rationale; the completion sections dated 2026-07-29 are
authoritative.

Constraints at that time:

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

## 2026-08-09 Playwright Compatibility Update

- The isolated browser-test dependency is updated from `@playwright/test@1.58.2` to
  `@playwright/test@1.61.1`, with matching `playwright` and `playwright-core` lock entries.
- `1.61.1` is the newest tested release that still installs Chromium on the required macOS
  12.7.6 x86_64 development host. The current `1.62.1` release rejects that platform, so it
  is intentionally deferred until the development host operating system is upgraded.
- Local verification passed all 15 wallet-connect and 11 Web3 write-flow browser tests,
  routing and documentation gates, the static Benefits preflight, 642 contract tests,
  30 generator tests and 36 SDK tests. Exact-head Linux CI remains mandatory before merge.

## 2026-08-01 Root Security Patch

- Hardhat was updated from `3.11.1` to `3.12.0`, which replaces vulnerable
  `adm-zip@0.4.16` with patched `adm-zip@0.6.0`.
- Mocha's transitive `serialize-javascript` is pinned through npm overrides to
  patched `7.0.5`. The repository already requires Node.js `>=22.13.0`, above
  that package's Node.js 20 minimum.
- The nested `serve-handler` path now resolves patched
  `brace-expansion@1.1.18`.
- A clean local installation reports 10 low findings and no moderate, high or
  critical findings. The remaining Ethers-5 verification-plugin/`elliptic`
  and Mocha `diff` paths have no current non-breaking upstream fix and remain
  monitored.
- Contract and Security workflows enforce `npm audit --audit-level=moderate`,
  preventing future moderate, high or critical regressions while the
  documented upstream-only low findings remain visible.
- The scheduled Security workflow additionally runs
  `npm run test:dependency-advisories`. This gate permits only the known
  `GHSA-848j-6mx2-7j84` chain from `@nomicfoundation/hardhat-verify` through
  Ethers 5 to `elliptic@6.6.1`, verifies that every affected lockfile package
  remains development-only, and fails when the advisory set changes or a fix
  becomes available. Hardhat 3 and the root contract toolchain's direct
  Ethers 6 dependency are already active; the remaining root-lockfile
  remediation depends on an upstream Verify release that removes or patches
  this internal Ethers 5 path. The separately vendored browser bundle used by
  legacy static pages is outside npm/Dependabot coverage and requires its own
  wallet-regression migration before it can be removed.

## 2026-08-01 Creator Gateway Security Patch

- Creator Gateway remains on Express 4 and now declares `^4.22.2`; this pulls
  patched `body-parser@1.20.6`, `qs@6.15.3` and
  `path-to-regexp@0.1.13` without an Express 5 migration.
- Patched development paths resolve `form-data@4.0.6`, `js-yaml@3.15.1`,
  `brace-expansion@5.0.9` and `1.1.18`, `picomatch@2.3.2` and `4.0.5`,
  `@babel/core@7.29.7`, plus `tsx@4.23.1` with `esbuild@0.28.1`.
- Registry and lockfile integrity values match for both `brace-expansion`
  lines, `path-to-regexp@0.1.13` and `form-data@4.0.6`. The lockfile contains
  neither blocked Axios version `0.30.4` nor `1.14.1`.
- A clean Node 20 installation reports zero production and development audit
  findings. TypeScript no-emit/build checks and all 41 Creator Gateway tests
  pass.
- Creator Gateway CI now blocks every audit severity and runs a deterministic
  lockfile baseline before TypeScript and Jest. Do not replace this bounded
  patch with `npm audit fix --force` or mix it with Express 5, googleapis,
  Jest or ts-jest migrations.

### Deterministic local networks

`MAINNET_RPC_URL` configures the named `mainnet` HTTP network but does not implicitly fork the
local `default` or `hardhat` EDR networks. Normal contract tests therefore remain local and
deterministic even when a developer's `.env` contains a Mainnet provider URL.

Forking is an explicit, block-pinned diagnostic mode:

```bash
HARDHAT_FORK=true \
HARDHAT_FORK_BLOCK_NUMBER=<positive-mainnet-block> \
npm run test:contracts
```

`MAINNET_RPC_URL` must also be present in the environment. Configuration fails before a test
starts when the opt-in flag, RPC URL or pinned block number is invalid. The offline regression
gate is `npm run test:hardhat-config`; it uses a non-routable placeholder URL and performs no
RPC request. Remove or set `HARDHAT_FORK=false` after a fork diagnostic; a stale
`HARDHAT_FORK=true` intentionally blocks every Hardhat command until a valid pinned block is
provided.

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

## 2026-08-22 Browser Ethers 6 Completion

- The static browser runtime (landing page, all wiki pages and the Web3 PWA) no
  longer ships the vendored Ethers 5.7.2 UMD bundle. Every page loads the
  self-hosted `docs/assets/vendor/ethers-6.17.0.umd.min.js` (SHA-256
  `532950515fd29ae9f7a21ceb2b68100815024d7944c3d5a92246d5b900bd703b`), a
  byte-for-byte copy of the pinned root `ethers@6.17.0` npm package. The
  cdnjs/unpkg Ethers fallbacks and the old 5.7.2 asset were removed, which also
  retires the browser-side `elliptic@6.5.4` copy that sat outside
  npm/Dependabot coverage.
- Runtime code was migrated directly to Ethers 6 without a compatibility shim:
  `BrowserProvider`/`JsonRpcProvider`, awaited `getSigner()` behind the
  unchanged synchronous cached `IFRWallet.getSigner()` API, bigint-normalized
  chain IDs, exact bigint arithmetic for all IFR base-unit values, and the
  top-level `encodeBytes32String`, `ZeroAddress` and `MaxUint256` exports.
  ABIs, contract addresses, RPC endpoints, the WalletConnect project ID and the
  WalletConnect version are unchanged.
- `docs/web3-sw.js` precaches the v6 bundle under cache `ifr-web3-v15`.
- A deterministic gate, `npm run test:browser-ethers6`
  (`scripts/check-browser-ethers6.cjs`), fails on any Ethers 5 loader/reference
  in browser-executable files, a surviving v5 asset, a hash mismatch of the
  vendored bundle, or a stale service-worker cache. It is wired into
  `package.json` and the Docs Validator workflow.
- Verification: `npm run test:browser-ethers6`, `npm run test:web3-write`
  (24 tests, including asset SHA-256, v6 script path, `window.ethers.version`
  6.17.0 and desktop/iPad/Android surfaces), `npm run test:wallet-connect`
  (20 tests, including Ethers 6 connect checks on all five wallet-active wiki
  pages), `npm run test:surface-routing`, `npm run test:wiki-heads`,
  `npm run test:docs-ci` and `git diff --check` all pass.

## 2026-08-26 Maintenance Batch

- `actions/setup-node` was updated across all active workflows to the pinned v7
  commit `820762786026740c76f36085b0efc47a31fe5020`; no mutable setup-node tag
  remains.
- Root development tooling moved to `axe-core@4.13.0`,
  `@nomicfoundation/hardhat-verify@3.0.22`, `mocha@11.8.0` and
  `@nomicfoundation/hardhat-mocha@3.1.0`.
- Playwright remains intentionally pinned at `1.61.1`; `1.62.1` cannot provide
  the required local Chromium browser on the current macOS 12 test host.
- The known Low elliptic advisory remains development-only through the
  Hardhat-Verify Ethers-5 ABI dependency and still has no bounded upstream fix.

## 2026-09-04 Registry Advisory Patch

- Newly published advisories are resolved with bounded dependency updates:
  `browserslist@4.28.7`, `qs@6.16.0`, `fast-uri@3.1.6`,
  `mysql2@3.23.1` and `postcss-selector-parser@6.1.4`.
- `qs@6.16.0` is overridden only in Creator Gateway and the Benefits backend,
  where Express 4 dependency ranges otherwise exclude the patched release.
  Their request and service suites remain the compatibility gates.
- The Points backend retains exact overrides for its established dependency
  baseline, including Prisma's transitive MySQL driver. Its active local
  datasource remains SQLite; Prisma generation, TypeScript build and the
  points test suite verify that path.
- Patch releases already accepted by upstream ranges are updated in lockfiles
  without adding permanent overrides. This keeps future compatible security
  updates available.
- The Benefits wallet prototype pins transitive `query-string@9.5.1` to remove
  `GHSA-vcc3-ghjq-m6fr` without forcing an incompatible Wagmi 3 upgrade.
  `GHSA-528h-pc64-c93x`, published on 2026-09-03, remains temporarily limited
  to `stream-json@1.9.1` through Coinbase CDP's Solana support
  (`@coinbase/cdp-core -> @solana/web3.js -> jayson`). The prototype is a
  browser-only Sepolia evaluation and its production bundle does not contain
  Jayson or stream-json; a dedicated post-build boundary check enforces that.
  The dedicated audit baseline fails closed on any different package, path,
  severity or advisory identity. Replace this narrow exception as soon as
  Coinbase/Solana/Jayson expose a compatible patched dependency; do not force
  `stream-json@3`, whose ESM API is incompatible with Jayson 4.
- The token dashboard pins transitive `query-string@9.5.1` to remove
  `GHSA-vcc3-ghjq-m6fr` without forcing the incompatible Wagmi 3 upgrade that
  npm proposes. WalletConnect 2.21 bundles the affected utility code and does
  not load `query-string` at runtime; the dashboard dependency gate enforces
  both `query-string@9.5.1` and `decode-uri-component@0.5.0`, while the full
  production build remains the compatibility gate.

## 2026-09-04 Hardhat Maintenance Candidate

- Root Hardhat is updated from `3.12.0` to `3.15.0`; the verification plugin
  is updated from `3.0.22` to `3.1.0` in the same bounded toolchain wave.
- Hardhat 3.15 updates its native EVM runtime (`@nomicfoundation/edr`) from
  `0.15.0` to `0.19.0`. Contract execution, revert paths and deterministic
  local-network behavior are therefore covered by the complete contract suite.
- EDR platform binaries are optional dependencies in the new lockfile. CI and
  development installs must not use `--omit=optional`, because Hardhat needs
  the matching native package at runtime.
- The Verify 3.1 configuration loads and its local task integration is covered;
  no Mainnet verification request was sent during this maintenance change.
- Complete local verification passes with 642 contract tests, 30 Generator
  Engine tests and 36 SDK tests. The root audit remains at eight Low
  development-only findings and zero Moderate, High or Critical findings.
- Mocha remains at `11.8.0`. Mocha 12 is not install-compatible with the
  current `@nomicfoundation/hardhat-mocha@3.1.0` peer range and must wait for
  upstream plugin support; do not use `--force` or `--legacy-peer-deps`.
- Exact-head Linux CI remains mandatory before merge.
