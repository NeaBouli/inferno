# GitHub Repository Setup

Stand: 26. Februar 2026

## Discussions

GitHub Discussions aktiviert via `gh api repos/NeaBouli/inferno -X PATCH -f has_discussions=true`.

### Empfohlene Kategorien

| Kategorie | Zweck |
|-----------|-------|
| Ideas | Feature Requests |
| Q&A | Fragen zum Protokoll |
| Announcements | Projekt-Updates |
| Show and tell | Community Integrationen |
| Partners | Partner Onboarding Fragen |

Kategorien unter: https://github.com/NeaBouli/inferno/discussions/categories

## GitHub Pages

| Setting | Wert |
|---------|------|
| Source | Deploy from branch |
| Branch | main |
| Folder | /docs |
| URL | https://neabouli.github.io/inferno/ |

## Topics

Gesetzt via `gh api repos/NeaBouli/inferno/topics`:
- ethereum, defi, erc20, solidity, web3, token, hardhat, typescript

## Repository Settings Checkliste

- [x] Discussions aktiviert
- [x] Pages aktiviert (docs/)
- [x] Topics gesetzt (8 Tags)
- [x] Issue Templates (.github/ISSUE_TEMPLATE/)
- [x] PR Template (.github/pull_request_template.md)
- [x] Security Advisories (privat)
- [x] Secret Scanning aktiviert
- [x] Push Protection aktiviert
- [ ] Branch Protection Rules (empfohlen fuer Mainnet)
- [ ] Required Reviews (empfohlen fuer Mainnet)

---
*Inferno ($IFR) — GitHub Repository Setup*
