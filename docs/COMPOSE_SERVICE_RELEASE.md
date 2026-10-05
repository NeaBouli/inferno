# Compose Service Release (telegram-bot, points-backend, ai-copilot)

The Telegram verify bot, the Points backend and the AI Copilot run as services of the compose
project `inferno` on the production host (`/opt/inferno/docker-compose.yml`, not in this repo).
Their build contexts `/opt/inferno/<service>/` are plain copies of the repo app dirs. A merge to
`main` does **not** update them. On 2026-09-30 the removed Telegram route
`https://verify-api.ifrunit.tech/api/verify/status/1` still returned 200 (CWA-34).

`scripts/deploy-compose-service.sh` releases exactly one reviewed commit of one service. It is
operator-run: the Fleet diagnosis identity has no Docker and no write access to `/opt/inferno`.

| Service | Repo dir | Host source dir | Public check |
| --- | --- | --- | --- |
| `telegram-bot` | `apps/telegram/telegram-bot` | `/opt/inferno/telegram-bot` | `verify-api.ifrunit.tech/` 404 **and** `/api/verify/status/1` 404 (CWA-34) |
| `points-backend` | `apps/points-backend` | `/opt/inferno/points-backend` | `points-api.ifrunit.tech/health` 200 |
| `ai-copilot` | `apps/ai-copilot` | `/opt/inferno/ai-copilot` | `copilot-api.ifrunit.tech/api/health` 200 |

## What a release changes

| Target | Change | Not changed |
| --- | --- | --- |
| `/opt/inferno/<service>/` | app dir of the release commit (`git archive`, never the working tree) plus `RELEASE_SHA`; rsync `--delete` | `.env*` and `*.db*` at any depth and the root `node_modules/`, `dist/`, `data/` are excluded and never deleted (no `--delete-excluded`); nested dirs such as `src/data/` ship |
| image `inferno-<service>` | current `latest` tagged `rollback-<UTC>`, then `docker compose up -d --build --no-deps <service>` | no other service, no volume, no env file, no prune |
| `/opt/inferno/backups/<service>-<UTC>/` | new, never reused: `source.tgz` (same excludes) and `image-id` | earlier backups |

`deploy` refuses a dirty tree, a different `HEAD`, a short or unknown SHA, a missing source dir
or compose file, a missing `inferno-<service>:latest` image (nothing to roll back to) and less
than **4096 MB** free on `/mnt/HC_Volume_106164848`. The floor is fixed. The script never prunes;
free space by hand (see `docs/BENEFITS_CAPACITY_RUNBOOK.md`) and rerun.

After the backup, any failure — rsync, build, the container not reaching `healthy` within
`HEALTH_ATTEMPTS` x `HEALTH_INTERVAL` seconds (default 36 x 5), or a public check — triggers the
automatic rollback: the source dir is restored from `source.tgz`, `rollback-<UTC>` is retagged
`latest`, the container is recreated with `up -d --no-build --no-deps` and must become healthy
again. The script then exits non-zero.

Transfers are content-only (`rsync -rl --checksum`, never `-t`/`-a`/`-g`/`-o`/`-p`, T-255). The
v1 deploy user writes under `/opt/inferno` through an ACL but may not set times, owner, group or
mode on root-owned inodes; metadata flags made rsync exit 23 on 2026-10-05. Changed files are
rewritten as new inodes owned by the deployer with their previous mode; unchanged files are left
alone. No right is widened, and every rsync error still fails the run and rolls back.

## Run

```bash
git fetch origin && git checkout --detach <release-sha>   # clean checkout, nothing uncommitted
export EXPECTED_SHA=<release-sha>                          # full 40 characters
scripts/deploy-compose-service.sh telegram-bot plan       # read-only: state, free space, rsync dry run
scripts/deploy-compose-service.sh telegram-bot deploy     # backup -> sync -> build -> healthy -> public checks
scripts/deploy-compose-service.sh telegram-bot verify     # public HTTP only; safe from any machine
```

`SSH_HOST` defaults to the operator alias `hetzner`. `plan` prints the container state, free
space, the live `RELEASE_SHA` and the itemized file changes, and warns when `deploy` would refuse.

## Rollback

```bash
scripts/deploy-compose-service.sh <service> rollback /opt/inferno/backups/<service>-<UTC>
```

Restores the source dir from the backup (content-only), retags `rollback-<UTC>` as `latest` and
recreates the container without building. The automatic and the manual rollback then prove the
restore; the excluded env/SQLite/runtime entries are neither restored nor compared:

| Check | Pass condition |
| --- | --- |
| (a) content | same directories and files as the extracted backup, every file byte-identical (`cmp`; `diff -rq -x` cannot anchor the root-only excludes, so nested `src/data` is compared) |
| (b) symlinks | sorted `path -> target` lists of both trees are identical |
| (c) access | every file the backup let others read (`o+r`) and every directory others could traverse (`o+rx`) still allows it |
| (d) health | the recreated container reaches `healthy` |

Any failed step or check stops with `ROLLBACK CHECK FAILED: <check>` and a non-zero exit. Only
timestamped backup paths of the same service are accepted.
Rollback tags are kept (each holds the previous image's layers); remove old ones by hand once a
release is confirmed.

## Host assumptions (read-only, 2026-09-30)

- Compose project `inferno`, run as `cd /opt/inferno && docker compose ...`; build contexts
  `./<service>`; containers `inferno-<service>`; images `inferno-<service>:latest`.
- Env files live outside the source dirs (`/opt/inferno/.env.production`, `.env.points-backend`,
  `.env.ai-copilot`); data lives in the named volumes `points-data` and `copilot-data`.
- All three Dockerfiles define `HEALTHCHECK`; only `healthy` counts as success.
- GNU `tar`, `rsync` and `df -BM` are available on the host.

## Tests

`npm run test:release-guards` also runs `scripts/test-deploy-compose-service.sh` against a
temporary copy of the host layout (remote commands really run there; docker, df and curl are
fakes with file-backed image and container state): SHA/checkout guards, env allow-list, plan
leaves the host byte-identical, capacity refusal without prune, backup before the first write,
excludes protect env/SQLite/data files, failed health, sync or build roll back automatically, a
Telegram status route answering 200 fails the release, rollback path validation, a fake rsync
that refuses any metadata flag on a host write (as the v1 user does) with every host-writing rsync
asserted content-only, and a restore that fails on a tampered file, symlink, lost `o+r`, failed
restore sync or unhealthy container. Each guard
is mutation-checked.
