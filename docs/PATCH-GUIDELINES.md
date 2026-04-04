# Patch Guidelines — Inferno ($IFR)

## Patch Process (Step by Step)

### Step 1: Identify the Problem

- Bug report via GitHub Issue
- Classification: Critical / High / Medium / Low
- Decision: Hotfix (immediate) or scheduled fix

| Severity | Response Time | Example |
|----------|---------------|---------|
| Critical | Immediately (< 1h) | Funds at risk, reentrancy, overflow |
| High | < 24h | Governance bypass, fee calculation error |
| Medium | < 1 week | UI bug, wrong error message |
| Low | Next sprint | Typo, cosmetic issue |

### Step 2: Develop the Fix

- Branch: `fix/issue-{number}-short-description`
- Write tests first (TDD when possible)
- Implement fix
- All existing tests must remain green

### Step 3: Review

- Self-review: Re-read the diff
- For Critical/High: second person (if available)
- Run Slither: `npx slither .` (for Solidity changes)
- Run Hardhat tests: `npx hardhat test`

### Step 4: Commit & Push

**Conventions (STRICT):**

| Prefix | Usage |
|--------|-------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `test:` | Tests only |
| `ops:` | Operations (deploy, governance) |
| `refactor:` | Refactoring without behavior change |

**FORBIDDEN:**

- No `force-push` to main
- No `rebase` on main
- No `--amend` on already pushed commits
- No `--no-verify` on commits
- No AI-generated commit messages without review

### Step 5: Smart Contract Patches (CRITICAL)

For Solidity changes ALWAYS:

1. Deploy new contract version (never patch in-place)
2. Create Governance Proposal for migration
3. Wait for 48h Timelock
4. Execute Proposal
5. Mark old contract address as deprecated
6. Update all docs + wiki

**Example:** PartnerVault v1 -> v2
- Proposal #2 (old address) -> cancelled
- New v2 deployed + verified
- Proposal #3 (new address) -> executed (26.02.2026)

### Step 6: Documentation

After every fix:

- `docs/CHANGELOG.md` — Entry with date
- `docs/DOCS.md` — Changelog section
- Update affected wiki pages
- `README.md` if test count or features change

## Versioning

Semantic Versioning: `MAJOR.MINOR.PATCH`

| Type | When | Example |
|------|------|---------|
| MAJOR | Breaking change | New contract, new API |
| MINOR | New features (backward compatible) | New Hardhat task, dashboard feature |
| PATCH | Bug fix (no API change) | Fee calculation corrected |

**Current:** v1.0.x (Mainnet deployed 2026-03-05)

## Emergency Patches

For critical-severity bugs in smart contracts:

1. **Guardian** can pause contracts (immediately, no timelock)
2. **Governance** deploys fix contract
3. **Proposal** with 48h Timelock (or shorter delay via Governance adjustment)
4. Document post-mortem

## Checklist Before Merge

- [ ] All tests green (`npx hardhat test` — 544 total)
- [ ] Slither clean (no new High/Critical)
- [ ] README.md updated (if needed)
- [ ] docs/DOCS.md updated
- [ ] CHANGELOG.md entry
- [ ] Affected wiki pages updated
- [ ] No `.env` or secrets in diff

---
*As of: March 2026 | Version 1.1*
