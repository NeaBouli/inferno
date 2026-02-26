# Page Update Checklist

Welche Dateien bei welchem Event aktualisiert werden muessen.

---

## Nach jedem Commit

| Datei | Was aktualisieren |
|-------|-------------------|
| `README.md` | Test-Anzahl, Contract-Anzahl, neue Features |
| `docs/DOCS.md` | Chronik-Eintrag, Dateistruktur, Module, Test-Anzahl |
| `docs/CHANGELOG.md` | [Unreleased] Section ergaenzen |

## Nach Contract-Aenderung

| Datei | Was aktualisieren |
|-------|-------------------|
| `README.md` | Contract-Liste, Architektur-Beschreibung |
| `docs/DOCS.md` | Modul-Status, LOC, Test-Anzahl |
| `docs/index.html` | Stats (Contract-Anzahl, Test-Anzahl) |
| `docs/wiki/contracts.html` | Contract-Beschreibung, Funktionen |
| `docs/wiki/security.html` | Slither Findings, Test Coverage |
| `docs/TRANSPARENCY.md` | On-Chain Checks aktualisieren |
| `docs/wiki/transparency.html` | HTML-Version synchronisieren |
| `docs/WHITEPAPER.md` | Architektur-Section, Sicherheit |

## Nach Governance-Aktion

| Datei | Was aktualisieren |
|-------|-------------------|
| `docs/TRANSPARENCY.md` | Proposal Status (Pending → Executed) |
| `docs/wiki/transparency.html` | Status-Badges aktualisieren |
| `docs/wiki/governance.html` | Proposal-Liste ergaenzen |
| `CLAUDE.md` | Governance Proposals Tabelle |
| `docs/DEPLOYMENTS.md` | Neue Adressen falls relevant |

## Nach Test-Aenderung

| Datei | Was aktualisieren |
|-------|-------------------|
| `README.md` | Test-Anzahl |
| `docs/DOCS.md` | Test-Anzahl pro Datei + Gesamt |
| `docs/index.html` | Stats-Bereich (X tests) |
| `docs/WHITEPAPER.md` | Sicherheit-Section |
| `docs/ONE-PAGER.md` | Key Numbers |

## Nach App-Aenderung (Dashboard/Copilot/Points/Benefits)

| Datei | Was aktualisieren |
|-------|-------------------|
| `docs/DOCS.md` | App-Status, Dateistruktur |
| `docs/DASHBOARD_TEST_RESULTS.md` | Build-Ergebnisse |
| `docs/BENEFITS_E2E_RESULTS.md` | E2E-Ergebnisse |
| `README.md` | App-Erwaehnungen |

## Nach On-Chain Event (Deploy, Transfer, Burn)

| Datei | Was aktualisieren |
|-------|-------------------|
| `docs/TRANSPARENCY.md` | Zahlen aktualisieren (Supply, Burned, Balances) |
| `docs/wiki/transparency.html` | HTML-Version synchronisieren |
| `docs/DEPLOYMENTS.md` | Neue Contract-Adressen |
| `docs/ONE-PAGER.md` | Key Numbers |
| `docs/PROJECT-SUMMARY.md` | Zahlen aktualisieren |

## Nach Wiki-Seite hinzufuegen

| Datei | Was aktualisieren |
|-------|-------------------|
| Alle `docs/wiki/*.html` | Sidebar-Links ergaenzen |
| `docs/wiki/index.html` | Quick Stats (Seiten-Anzahl) |
| `docs/DOCS.md` | Wiki-Seiten-Anzahl, Dateistruktur |

## Nach Deploy (Sepolia oder Mainnet)

| Datei | Was aktualisieren |
|-------|-------------------|
| `docs/DEPLOYMENTS.md` | Alle Adressen + Constructor Args |
| `docs/TRANSPARENCY.md` | Kompletter On-Chain Audit |
| `CLAUDE.md` | Adress-Tabelle |
| `docs/MAINNET_CHECKLIST.md` | Status aktualisieren |
| `docs/index.html` | Contract-Adressen (wenn angezeigt) |

---
*Stand: 26. Februar 2026*
