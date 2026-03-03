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

## Branch Protection Rules (empfohlen)

Vor Mainnet sollte `main` geschuetzt werden:

```bash
gh api repos/NeaBouli/inferno/branches/main/protection -X PUT \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["test"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null
}
EOF
```

### Empfohlene Einstellungen

| Regel | Wert | Grund |
|-------|------|-------|
| Require PR reviews | 1 Approval | Vier-Augen-Prinzip |
| Dismiss stale reviews | true | Bei neuen Pushes erneut reviewen |
| Require status checks | `test` | CI muss gruen sein |
| Require up-to-date | true | Branch muss aktuell sein |
| Enforce admins | false | Owner kann im Notfall direkt pushen |
| Allow force push | false | History schuetzen |
| Allow deletions | false | Branch nicht loeschbar |

### Manuell via GitHub UI

1. Settings → Branches → Add branch protection rule
2. Branch name pattern: `main`
3. Haken setzen: Require pull request, Require status checks, Require linear history
4. Save changes

## Git Author Konfiguration

Fuer konsistente Commit-Metadaten:

```bash
# Lokal (nur dieses Repo)
git config user.name "IFR Protocol"
git config user.email "noreply@inferno-protocol.xyz"

# Verifizieren
git config user.name   # → IFR Protocol
git config user.email  # → noreply@inferno-protocol.xyz
```

Alle zukuenftigen Commits in diesem Repo verwenden dann `IFR Protocol <noreply@inferno-protocol.xyz>` als Author.

---
*Inferno ($IFR) — GitHub Repository Setup*
