# Contributing to Inferno ($IFR)

## Willkommen

Inferno ist ein Open-Source-Projekt. Contributions sind willkommen —
von Bug-Reports bis zu Feature-Requests und Code-Beitraegen.

## Wie du beitragen kannst

### Bug Reports
1. GitHub Issues: https://github.com/NeaBouli/inferno/issues
2. Template verwenden (Bug Report)
3. Reproduktions-Schritte angeben
4. Environment: Node.js Version, OS, Network (Sepolia/Mainnet)

### Feature Requests
1. GitHub Issues: Feature Request Template
2. Problem beschreiben (nicht nur die Loesung)
3. Use Case erklaeren

### Code Contributions
1. Fork des Repos
2. Branch: `feat/kurze-beschreibung` oder `fix/issue-nummer`
3. Tests schreiben (TDD bevorzugt)
4. Alle bestehenden Tests muessen gruen bleiben: `npx hardhat test`
5. Pull Request mit Beschreibung

## Code Standards

### Solidity
- Pragma: `^0.8.20`
- OpenZeppelin v5 fuer Standard-Patterns
- NatDoc Kommentare fuer alle public Functions
- Keine magic numbers — Konstanten verwenden
- Slither muss 0 High/Critical zeigen

### TypeScript/JavaScript
- TypeScript bevorzugt
- Strict Mode
- Keine `any` types (ausser unvermeidbar)
- Jest fuer Tests

### Git Konventionen (STRIKT)

Commit-Prefixe:
- `feat:` neues Feature
- `fix:` Bugfix
- `docs:` nur Dokumentation
- `test:` nur Tests
- `ops:` Operations (Deploy, Governance)
- `refactor:` Refactoring

**VERBOTEN:**
- Kein force-push auf main
- Kein rebase auf gepushte Commits
- Keine `--amend` auf gepushte Commits

## Smart Contract Aenderungen

Fuer Solidity-Aenderungen gilt:
1. Neue Contract-Version deployen (niemals in-place patchen)
2. Governance Proposal fuer Migration (48h Timelock)
3. Tests: `npx hardhat test` (alle 321+ muessen gruen sein)
4. Coverage: `npx hardhat coverage` (>80% Branch Coverage)
5. Dokumentation aktualisieren

## Review Prozess

- PRs werden innerhalb 48h reviewed
- Bei Security-relevanten Aenderungen: extra Pruefzeit
- Mainnet-relevante Aenderungen: zwei Reviews erforderlich

## Verhaltenskodex

- Respektvolle Kommunikation
- Keine Spam-Issues
- Keine unsolicited DMs an Maintainer
- Security-Issues: privat via GitHub Security Advisory

## Links

- Docs: https://neabouli.github.io/inferno/wiki/
- Issues: https://github.com/NeaBouli/inferno/issues
- Security: [docs/SECURITY_POLICY.md](SECURITY_POLICY.md)

---
*Version 1.0 | Februar 2026*
