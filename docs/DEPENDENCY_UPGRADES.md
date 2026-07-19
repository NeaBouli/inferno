# Ausstehende Major Upgrades

> Erstellt: 2026-04-14 | Alle PRs geschlossen mit Verweis auf diese Datei.

## Inferno

| PR | Package | Von | Zu | Aufwand | Priorität |
|----|---------|-----|----|---------|-----------|
| #2 | actions/setup-node | 4 | 6 | Gering | 1 |
| #3 | actions/checkout | 4 | 6 | Gering | 1 |
| #8 | hardhat | 2.28.6 | 3.1.12 | Mittel | 3 |
| #5 | @nomicfoundation/hardhat-verify | 2.1.3 | 3.0.12 | Mittel | 3 |
| #7 | chai | 4.5.0 | 6.2.2 | Mittel | 3 |
| #4 | ethers | 5.8.0 | 6.16.0 | Gross | 4 |

## Migrationsreihenfolge

1. **#2 + #3 — GitHub Actions v6** — EINFACH
   - Node.js Runtime-Update, keine Code-Änderungen nötig
   - Kann sofort gemacht werden

2. **#8 + #5 + #7 — Hardhat 3 + Verify 3 + Chai 6** — MITTEL
   - Hardhat 3: neues Plugin-System, Config-Format ändert sich
   - Chai 6: ESM-only, `expect` Import-Änderungen
   - hardhat-verify 3 hängt von Hardhat 3 ab → zusammen migrieren
   - Alle Tests müssen angepasst werden

3. **#4 — ethers v6** — GROSS
   - `BigNumber` → native `bigint`
   - `Provider`/`Signer` API komplett überarbeitet
   - Alle Contract-Interaktionen und Tests betroffen
   - Nach Hardhat 3 Migration durchführen

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
- Backend pins the patched `ws` release through an npm override. Clean install and
  `npm audit --audit-level=moderate`: no moderate, high or critical findings.
- The remaining backend low findings are in the ethers v5 elliptic dependency path and require
  a separately tested ethers v6 migration.
- Benefits CI enforces those two audit thresholds before typechecks, tests and builds.

The root Hardhat/Waffle/Ganache lock remains a separate migration. Do not apply the Shop lockfile
changes to the contract toolchain and do not use `npm audit fix --force`.

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
