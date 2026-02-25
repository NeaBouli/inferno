# Patch Guidelines — Inferno ($IFR)

## Patch-Prozess (Schritt fuer Schritt)

### Schritt 1: Problem identifizieren

- Bug-Report via GitHub Issue
- Klassifizierung: Critical / High / Medium / Low
- Entscheidung: Hotfix (direkt) oder geplanter Fix

| Severity | Reaktionszeit | Beispiel |
|----------|---------------|----------|
| Critical | Sofort (< 1h) | Funds at risk, reentrancy, overflow |
| High | < 24h | Governance bypass, fee calculation error |
| Medium | < 1 Woche | UI bug, wrong error message |
| Low | Naechster Sprint | Typo, cosmetic issue |

### Schritt 2: Fix entwickeln

- Branch: `fix/issue-{nummer}-kurze-beschreibung`
- Tests zuerst schreiben (TDD wenn moeglich)
- Fix implementieren
- Alle bestehenden Tests muessen gruen bleiben

### Schritt 3: Review

- Selbst-Review: Diff nochmal lesen
- Bei Critical/High: zweite Person (wenn verfuegbar)
- Slither pruefen: `npx slither .` (fuer Solidity-Aenderungen)
- Hardhat Tests: `npx hardhat test`

### Schritt 4: Commit & Push

**Konventionen (STRIKT):**

| Prefix | Verwendung |
|--------|------------|
| `feat:` | Neues Feature |
| `fix:` | Bugfix |
| `docs:` | Nur Dokumentation |
| `test:` | Nur Tests |
| `ops:` | Operations (Deploy, Governance) |
| `refactor:` | Refactoring ohne Behavior-Aenderung |

**VERBOTEN:**

- Kein `force-push` auf main
- Kein `rebase` auf main
- Kein `--amend` auf bereits gepushte Commits
- Kein `--no-verify` bei Commits
- Keine AI-generierten Commit-Messages ohne Review

### Schritt 5: Smart Contract Patches (KRITISCH)

Fuer Solidity-Aenderungen IMMER:

1. Neue Contract-Version deployen (niemals in-place patchen)
2. Governance Proposal fuer Migration erstellen
3. 48h Timelock abwarten
4. Execute Proposal
5. Alte Contract-Adresse als deprecated markieren
6. Alle Docs + Wiki aktualisieren

**Beispiel:** PartnerVault v1 → v2
- Proposal #2 (alte Adresse) → cancelled
- Neue v2 deployed + verified
- Proposal #3 (neue Adresse) → pending execution

### Schritt 6: Dokumentation

Nach jedem Fix:

- `docs/CHANGELOG.md` — Eintrag mit Datum
- `docs/DOCS.md` — Changelog-Sektion
- Betroffene Wiki-Seiten aktualisieren
- `README.md` falls Test-Count oder Features sich aendern

## Versionierung

Semantisches Versioning: `MAJOR.MINOR.PATCH`

| Typ | Wann | Beispiel |
|-----|------|----------|
| MAJOR | Breaking Change | Neuer Contract, neue API |
| MINOR | Neue Features (rueckwaertskompatibel) | Neuer Hardhat Task, Dashboard Feature |
| PATCH | Bugfix (keine API-Aenderung) | Fee-Berechnung korrigiert |

**Aktuell:** v0.1.x (Testnet, Pre-Mainnet)

## Notfall-Patches

Bei Critical-Severity Bugs in Smart Contracts:

1. **Guardian** kann Contracts pausieren (sofort, kein Timelock)
2. **Governance** deployt Fix-Contract
3. **Proposal** mit 48h Timelock (oder kuerzerer Delay via Governance-Anpassung)
4. Post-Mortem dokumentieren

## Checkliste vor Merge

- [ ] Alle Tests gruen (`npx hardhat test`)
- [ ] Slither clean (keine neuen High/Critical)
- [ ] README.md aktualisiert (falls noetig)
- [ ] docs/DOCS.md aktualisiert
- [ ] CHANGELOG.md Eintrag
- [ ] Betroffene Wiki-Seiten aktualisiert
- [ ] Kein `.env` oder Secrets im Diff

---
*Stand: Februar 2026 | Version 1.0*
