# Compose Service Release (telegram-bot, points-backend, data-api)

The Telegram verify bot, the Points backend and the protocol Data API run as services of the compose
project `inferno` on the production host (compose file under the operator deployment root
`$REMOTE_ROOT`, not in this repo). Their build contexts `$REMOTE_ROOT/<service>/` are plain copies
of the repo app dirs. A merge to `main` does **not** update them. On 2026-09-30 the removed
Telegram route `https://verify-api.ifrunit.tech/api/verify/status/1` still returned 200 (CWA-34).

`scripts/deploy-compose-service.sh` releases exactly one reviewed commit of one service. It is
operator-run: a read-only diagnosis identity has no Docker and no write access to the deployment
root. The script ships no host defaults: set `SSH_HOST`, `REMOTE_ROOT` and `REMOTE_VOLUME` to the
operator connection and layout (paths below use `$REMOTE_ROOT`).

| Service | Repo dir | Host source dir | Public check |
| --- | --- | --- | --- |
| `telegram-bot` | `apps/telegram/telegram-bot` | `$REMOTE_ROOT/telegram-bot` | `verify-api.ifrunit.tech/` 404 **and** `/api/verify/status/1` 404 (CWA-34) |
| `points-backend` | `apps/points-backend` | `$REMOTE_ROOT/points-backend` | `points-api.ifrunit.tech/health` 200 |
| `data-api` | `apps/data-api` | `$REMOTE_ROOT/data-api` | `copilot-api.ifrunit.tech/api/health` 200 |
| `creator-gateway` (prepared, not deployed) | `apps/creator-gateway` | proposed `$REMOTE_ROOT/creator-gateway` | proposed `creator-api.ifrunit.tech`: `/health` 200, `/auth/siwe/nonce` 200, `POST /auth/wallet` 404, `/access/check` 401, `/auth/google/callback` 400 |

Creator Gateway is a prepared client target, not an existing production service.
See [its first-release runbook](CREATOR_GATEWAY_DEPLOY.md) for owner decisions,
Google membership blockers, host gate onboarding and the separate bootstrap
procedure. The normal direct path requires a genuine prior image/source baseline
and intentionally refuses a first bootstrap. `CREATOR_GATEWAY_HOST` overrides
the proposed hostname for public checks after owner approval.

## Data API cutover

The source now uses `data-api`. The public data hostname stays unchanged for SDK,
bot and page compatibility; a neutral hostname migration is a later step.
Deploy cleaned pages, Web3 and Benefits first, then have an authorized operator
switch the host Compose service `ai-copilot` to `data-api` on the same router,
hostname and port 3003. Preserve the bootstrap vote archive and existing mounts.
Remove the old container/image only after verified backup and rollback preparation.
The first rename needs operator bootstrap: this helper requires an existing image
and source baseline and does not edit the host Compose definition.

See [retirement, checks and rollback](COPILOT_CHAT_RETIREMENT.md). The helper keeps
`ai-copilot` for rollback/inspection only; it rejects new plans and deployments
for that name. Host gate allowlists and required checks need a separate cutover.
The generalized historical example below describes the old service layout. It is
not evidence of the current runtime; verify the operator layout before using it.

## What a release changes

| Target | Change | Not changed |
| --- | --- | --- |
| `$REMOTE_ROOT/<service>/` | app dir of the release commit (`git archive`, never the working tree) plus `RELEASE_SHA`; rsync `--delete` | `.env*` and `*.db*` at any depth and the root `node_modules/`, `dist/`, `data/` are excluded and never deleted (no `--delete-excluded`); nested dirs such as `src/data/` ship |
| image `inferno-<service>` | current `latest` tagged `rollback-<UTC>`, then `docker compose up -d --build --no-deps <service>` | no other service, no volume, no env file, no prune |
| `$REMOTE_ROOT/backups/<service>-<UTC>/` | new, never reused: `source.tgz` (same excludes) and `image-id` | earlier backups |

`deploy` refuses a dirty tree, a different `HEAD`, a short or unknown SHA, a missing source dir
or compose file, a missing `inferno-<service>:latest` image (nothing to roll back to) and less
than **4096 MB** free on the configured capacity volume (`REMOTE_VOLUME`). The floor is fixed. The
script never prunes; free space by hand (see `docs/BENEFITS_CAPACITY_RUNBOOK.md`) and rerun.

After the backup, any failure — rsync, build, the container not reaching `healthy` within
`HEALTH_ATTEMPTS` x `HEALTH_INTERVAL` seconds (default 36 x 5), or a public check — triggers the
automatic rollback: the source dir is restored from `source.tgz`, `rollback-<UTC>` is retagged
`latest`, the container is recreated with `up -d --no-build --no-deps` and must become healthy
again. The script then exits non-zero.

Transfers are content-only (`rsync -rl --checksum`, never `-t`/`-a`/`-g`/`-o`/`-p`, T-255). The
v1 deploy user writes under `$REMOTE_ROOT` through an ACL but may not set times, owner, group or
mode on root-owned inodes; metadata flags made rsync exit 23 on 2026-10-05. Changed files are
rewritten as new inodes owned by the deployer with their previous mode; unchanged files are left
alone. No right is widened, and every rsync error still fails the run and rolls back.

## Run

```bash
git fetch origin && git checkout --detach <release-sha>   # clean checkout, nothing uncommitted
export EXPECTED_SHA=<release-sha>                          # full 40 characters
export SSH_HOST=<operator-ssh-alias> REMOTE_ROOT=<deploy-root> REMOTE_VOLUME=<capacity-volume>   # required, no defaults
scripts/deploy-compose-service.sh telegram-bot plan       # read-only: state, free space, rsync dry run
scripts/deploy-compose-service.sh telegram-bot deploy     # backup -> sync -> build -> healthy -> public checks
scripts/deploy-compose-service.sh telegram-bot verify     # public HTTP only; safe from any machine
```

`verify` needs no host connection. `plan` prints the container state, free
space, the live `RELEASE_SHA` and the itemized file changes, and warns when `deploy` would refuse.

## Rollback

```bash
scripts/deploy-compose-service.sh <service> rollback $REMOTE_ROOT/backups/<service>-<UTC>
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

## Gate mode

Once the scoped deploy gate (inferno-deploy v2) is installed on the host, all three release
scripts can run through it instead of raw ssh, docker and rsync. The switch is one variable:

```bash
export DEPLOY_MODE=gate    # unset = the direct ssh path described above
```

Every host action is then one `ssh -F "$DEPLOY_GATE_SSH_CONFIG" "$DEPLOY_GATE_HOST" <subcommand> ...`
call (both operator-supplied; the client ships no alias or config-path defaults). The forced command
only runs whitelisted subcommands of the reviewed root tool; the upload is a tar on stdin whose
SHA-256 the tool checks before it changes anything, and only regular files and directories are
accepted. No secret is ever passed.

| Script and mode | Gate call |
| --- | --- |
| `deploy-compose-service.sh <svc> plan` | `service-plan <svc> <sha> <tar-sha256>` with `git archive <sha>:<app dir>` on stdin |
| `deploy-compose-service.sh <svc> deploy` | `service-deploy <svc> <sha> <tar-sha256>`, then the local public verify |
| `deploy-compose-service.sh <svc> rollback <stamp>` | `service-rollback <svc> <stamp>` |
| `deploy-compose-service.sh <svc> status` / `health` / `logs [n]` / `backups` | `status` / `health <svc>` / `logs <svc> [n]` / `backups <svc>` |
| `deploy-web3-site.sh plan` / `deploy` | `web3-plan` / `web3-deploy <sha> <tar-sha256> [delete]` with the staged docroot on stdin (`.nginx/web3-security-headers.conf` at its root; `DELETE=1` adds `delete`) |
| `deploy-web3-site.sh rollback <stamp>` / `status` / `health` / `backups` | `web3-rollback <stamp>` / `status` / `health web3-site` / `backups web3-site` |
| `deploy-benefits-network.sh frontend` / `backend` / `all` | `benefits-deploy <mode> <sha> <tar-sha256>` with `git archive <sha>:apps/benefits-network` on stdin; gate mode never prunes (the Docker daemon is shared) and refuses a set `ALLOW_PRUNE` |
| `deploy-benefits-network.sh status` / `capacity` | `benefits-status` |
| `deploy-benefits-network.sh env-vault-v2 <address>` | `env-set .env.benefits COMMITMENT_VAULT_V2_ADDRESS <address>` (the only env key the host accepts) |
| `deploy-benefits-network.sh rollback <stamp>` / `env-restore <stamp>` | `benefits-rollback <stamp>` / `benefits-env-restore <stamp>` (stamp validated locally; available once the host tool with benefits support is installed) |

Unchanged on this side: `EXPECTED_SHA` must be a full commit of a clean checkout at that commit,
the web3 header and wallet-runtime tests run before a deploy, and `verify` is public HTTP only.
The client refuses before sourcing `scripts/deploy-gate-lib.sh` if that helper or the calling
script has local changes.

Server-side behaviour (backup, health wait, public checks, automatic restore on failure) is
defined by the accepted inferno-deploy v2 tool, not by this client, and may differ per service.
Until the installed tool's failure behaviour is accepted per service, treat automatic restore as
unverified and use `rollback <stamp>` explicitly; the tool prints the backup stamp
(`YYYYMMDDTHHMMSSZ`), and `backups` lists the available stamps. Gate mode stays unused until the
v2 installation and its authorization/restore behaviour are accepted.

## Historical host assumptions (2026-09-30, generalized paths)

- Compose project `inferno`, run as `cd $REMOTE_ROOT && docker compose ...`; build contexts
  `./<service>`; containers `inferno-<service>`; images `inferno-<service>:latest`.
- Env files live outside the source dirs (`$REMOTE_ROOT/.env.production`, `.env.points-backend`,
  `.env.ai-copilot`); data lives in the named volumes `points-data` and `copilot-data`.
- All three Dockerfiles define `HEALTHCHECK`; only `healthy` counts as success.
- GNU `tar`, `rsync` and `df -BM` are available on the host.

## Tests

`npm run test:release-guards` also runs `scripts/test-deploy-compose-service.sh` against a
temporary copy of a modelled host layout (remote commands really run there; docker, df and curl are
fakes with file-backed image and container state): SHA/checkout guards, env allow-list, plan
leaves the host byte-identical, capacity refusal without prune, backup before the first write,
excludes protect env/SQLite/data files, failed health, sync or build roll back automatically, a
Telegram status route answering 200 fails the release, rollback path validation, a fake rsync
that refuses any metadata flag on a host write (as the v1 user does) with every host-writing rsync
asserted content-only, and a restore that fails on a tampered file, symlink, lost `o+r`, failed
restore sync or unhealthy container. Each guard
is mutation-checked.
