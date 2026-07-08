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
