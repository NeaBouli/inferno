# Restart Snapshot — 2026-06-14 02:25 PDT

## Purpose
This file preserves the current IFR / Inferno project state before restarting the Mac.

## Last Known Git State
- Repository: `/Users/gio/Desktop/repos/inferno`
- Branch: `main`
- Last pushed commit known from previous completed task:
  - `7cd356cb6e0652d5b5c1cb4e25a9ab9dcf5deffe`
  - `feat: contributor runbook + generalized scripts + blockaid retest`
- Verified by reading Git ref files directly:
  - `.git/refs/heads/main` = `7cd356cb6e0652d5b5c1cb4e25a9ab9dcf5deffe`
  - `.git/refs/remotes/origin/main` = `7cd356cb6e0652d5b5c1cb4e25a9ab9dcf5deffe`
- Remote push result was successful:
  - `922989a0..7cd356cb main -> main`
- GitHub reported default-branch Dependabot alerts on push:
  - 109 vulnerabilities total
  - 4 critical, 32 high, 54 moderate, 19 low

## Known Untracked / Local Files
- `docs/REDESIGN_SAFETY_AUDIT.md`
  - Was present before the contributor runbook task.
  - Intentionally left untracked and untouched.
- This snapshot file:
  - `docs/RESTART_SNAPSHOT_2026-06-14.md`

## Local Backup Archive
- Archive created before restart:
  - `/Users/gio/Desktop/repos/_backups/inferno-restart-2026-06-14-0225.tar.gz`
- Archive size:
  - `337M` via `du -sh`
- Archive SHA-256:
  - `b8f8a2b4d370d4529af465d8a39f8175973c6485640288e0c622a90cd763b622`
- Checksum file:
  - `/Users/gio/Desktop/repos/_backups/inferno-restart-2026-06-14-0225.tar.gz.sha256`
- Repo directory size:
  - `805M` via `du -sh`

## Completed Immediately Before Restart
- Generalized contributor lock script:
  - `scripts/contributors-lock.js`
  - Reads `CONTRIBUTOR_ADDR`
  - Reads live IFR balance
  - Creates 10 `TIME_ONLY` tranches
  - Default `LOCK_BPS=10000`
  - Optional `LOCK_BPS=5000` for lock + lending split
- Generalized contributor lending script:
  - `scripts/contributors-lending-offer.js`
  - Reads `CONTRIBUTOR_ADDR`
  - Uses `LENDING_BPS=5000` by default
  - Runs `approve(LendingVault, amount)`
  - Runs `createOffer(amount)` or `increaseOffer(amount)`
- Contributor runbook:
  - `docs/CONTRIBUTOR_RUNBOOK.md`
- Blockaid retest checklist:
  - `BRIDGE.md`
- TODO sync:
  - `docs/TODO.md`
  - `docs/TODO.html`
- Website quick check fixes:
  - `docs/index.html`
  - `docs/wiki/ecosystem.html`
  - `docs/wiki/protocol-plan.html`

## Contributor Addresses Verified On-chain
| Contributor | Address | IFR | ETH at check time |
|---|---|---:|---:|
| C1 | `0x4f632748460E5277bF8435259cADce440AbAC254` | 33,333,333.333333333 | 0.001055298994466727 |
| C2 | `0x80fF32c5441cBCbFa5c3ce0dC70359BDD05B6958` | 33,333,333.333333333 | 0.004243668025184632 |
| C3 | `0xf556cCe85128c93AC6A7e088cF334180F2D3905B` | 33,333,333.333333333 | 0.004617965521402287 |

## Important Operational Note
Do not run a 100% lock and then expect LendingVault to work from the same wallet balance.

Use one of these modes:
- Full lock only: default `LOCK_BPS=10000`
- Lock + lending split: `LOCK_BPS=5000`, then default lending `LENDING_BPS=5000`
- Lending only: skip lock and run `scripts/contributors-lending-offer.js`

## Verified Commands Before Snapshot
```bash
node --check scripts/contributors-lock.js
node --check scripts/contributors-lending-offer.js
```

Dry runs completed successfully for all three contributor wallets:
```bash
DRY_RUN=true CONTRIBUTOR_ADDR=0x4f632748460E5277bF8435259cADce440AbAC254 node scripts/contributors-lock.js
DRY_RUN=true CONTRIBUTOR_ADDR=0x80fF32c5441cBCbFa5c3ce0dC70359BDD05B6958 node scripts/contributors-lock.js
DRY_RUN=true CONTRIBUTOR_ADDR=0xf556cCe85128c93AC6A7e088cF334180F2D3905B node scripts/contributors-lock.js

DRY_RUN=true CONTRIBUTOR_ADDR=0x4f632748460E5277bF8435259cADce440AbAC254 node scripts/contributors-lending-offer.js
DRY_RUN=true CONTRIBUTOR_ADDR=0x80fF32c5441cBCbFa5c3ce0dC70359BDD05B6958 node scripts/contributors-lending-offer.js
DRY_RUN=true CONTRIBUTOR_ADDR=0xf556cCe85128c93AC6A7e088cF334180F2D3905B node scripts/contributors-lending-offer.js
```

Website stale-copy check completed with 0 matches:
```bash
grep -rn "accepting contributions\|Bootstrap.*LIVE\|Pre-Launch\|contribute.*ETH.*now" docs/ --include="*.html"
```

## Next Steps After Restart
1. Re-open `/Users/gio/Desktop/repos/inferno`.
2. Run:
   ```bash
   git status --short --branch
   git log -1 --oneline --decorate
   ```
3. Confirm whether `docs/RESTART_SNAPSHOT_2026-06-14.md` should be committed or deleted.
4. Leave `docs/REDESIGN_SAFETY_AUDIT.md` untouched unless explicitly handling redesign audit work.
5. For contributor execution, follow `docs/CONTRIBUTOR_RUNBOOK.md`.

## Current Concern
At snapshot time, local `git status` / `git log` calls unexpectedly did not return promptly in the shell session, despite the previous commit and push completing successfully. After restart, verify Git responsiveness before new commits.
