# GitHub Repository Setup

As of: 26 February 2026

## Discussions

GitHub Discussions enabled via `gh api repos/NeaBouli/inferno -X PATCH -f has_discussions=true`.

### Recommended Categories

| Category | Purpose |
|----------|---------|
| Ideas | Feature requests |
| Q&A | Questions about the protocol |
| Announcements | Project updates |
| Show and tell | Community integrations |
| Builders | Builder onboarding questions |

Categories at: https://github.com/NeaBouli/inferno/discussions/categories

## GitHub Pages

| Setting | Value |
|---------|-------|
| Source | Deploy from branch |
| Branch | main |
| Folder | /docs |
| URL | https://ifrunit.tech/ |

## Topics

Set via `gh api repos/NeaBouli/inferno/topics`:
- ethereum, defi, erc20, solidity, web3, token, hardhat, typescript

## Repository Settings Checklist

- [x] Discussions enabled
- [x] Pages enabled (docs/)
- [x] Topics set (8 tags)
- [x] Issue Templates (.github/ISSUE_TEMPLATE/)
- [x] PR Template (.github/pull_request_template.md)
- [x] Security Advisories (private)
- [x] Secret Scanning enabled
- [x] Push Protection enabled
- [ ] Branch Protection Rules (recommended)
- [ ] Required Reviews (recommended)

## Branch Protection Rules (recommended)

The `main` branch should be protected:

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

### Recommended Settings

| Rule | Value | Reason |
|------|-------|--------|
| Require PR reviews | 1 approval | Four-eyes principle |
| Dismiss stale reviews | true | Re-review on new pushes |
| Require status checks | `test` | CI must pass |
| Require up-to-date | true | Branch must be current |
| Enforce admins | false | Owner can push directly in emergencies |
| Allow force push | false | Protect history |
| Allow deletions | false | Branch cannot be deleted |

### Manual via GitHub UI

1. Settings → Branches → Add branch protection rule
2. Branch name pattern: `main`
3. Check boxes: Require pull request, Require status checks, Require linear history
4. Save changes

## Git Author Configuration

For consistent commit metadata:

```bash
# Local (this repo only)
git config user.name "IFR Protocol"
git config user.email "noreply@inferno-protocol.xyz"

# Verify
git config user.name   # → IFR Protocol
git config user.email  # → noreply@inferno-protocol.xyz
```

All future commits in this repo will then use `IFR Protocol <noreply@inferno-protocol.xyz>` as the author.

---
*Inferno ($IFR) — GitHub Repository Setup*
