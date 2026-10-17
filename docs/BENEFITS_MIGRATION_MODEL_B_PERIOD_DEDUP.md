# Benefits Model B period dedup migration

This is the operator procedure for target
`3842f8ae4237ede7eadfc66c2887e3410026145b`, previously deployed Benefits release
`5468f561f98c2250eb210ace1bb42dc442bd5fc8`. This document records a prepared procedure,
not a production execution or release approval.

The only added migration is `20261017120000_model_b_period_dedup`. Its `migration.sql`
SHA-256 is `dcc7e7a0fe9ec9ebfc6b015b4f1c99b4ad0d1dcaf5437e963fe9250e35c83c28`.
It adds nullable `TEXT` columns `rewardPeriod` and `rewardDedupKey` to `RewardEvent`
and the unique index `RewardEvent_partner_period_dedup_key` over
`(partnerId, rewardPeriod, rewardDedupKey)`. It does no backfill and does not make
existing rewards payable. Existing application table counts must stay identical;
Prisma's migration ledger must gain exactly one finished row with the pinned checksum.

## Readiness and operator setup

Obtain Gio's separate approval for this release, downtime and any production restore.
Record the operator and independent database/operations reviews, exact release CI,
capacity evidence, all database writers/jobs, maintenance window, restore rehearsal,
and backup acceptance/expiry. Suspend concurrent deploy, prune and backup jobs.
Use the same backup root for every attempt. See the
[template contracts](BENEFITS_MIGRATION_TEMPLATE.md),
[non-root backend procedure](BENEFITS_CAPACITY_RUNBOOK.md#non-root-backend-one-time-volume-ownership)
and [privacy migration](BENEFITS_CUSTOMER_PRIVACY_MIGRATION.md).

Run on the Docker host as its authorized root operator, in a durable session. The
agent's diagnostic account is insufficient. Required tools include Bash, Git,
Docker Compose v2 with JSON config output, Python 3 with SQLite, rsync, curl and GNU
coreutils (`timeout`, `stat`, `sha256sum`), tar, find and flock. No env file is sourced
and no secret, row, proof, wallet address or raw migration output may be copied to logs.

Prepare two clean, reviewed Git checkouts using the approved host transfer process:

- `/opt/inferno/release-checkouts/3842f8ae4237ede7eadfc66c2887e3410026145b`:
  app repository at exactly the target SHA, with the previous commit available locally.
- `/opt/inferno/migration-tools`: the separately reviewed tooling commit containing
  `scripts/ops/benefits-migration-model-b-period-dedup.sh` and the updated
  `benefits-backend-volume-ownership.sh`. Record that commit and both script digests.

These are operator staging locations to create, not assertions about existing host
checkouts. The tooling postdates the target app commit, so requiring it inside that
commit would be impossible. Both checkouts must be clean, including untracked files;
the tools must be tracked. The script never fetches or commits. It archives the pinned
app commit, not the tooling checkout or working tree. Do not weaken cleanliness checks
to execute the uncommitted development copy.

The running source must be `/opt/inferno/benefits-network`, with `RELEASE_SHA` equal to
the previous release and every migration byte equal to that release. Compose must
resolve build contexts to its `backend` and `frontend` subdirectories, volume key
`benefits-data` to the mounted Docker volume, backend `DATABASE_URL` to
`file:/data/benefits.db`, and backend `CHAIN_ID` and frontend build argument
`NEXT_PUBLIC_CHAIN_ID` to `1`. Its frontend internal API build argument must be
`http://benefits-backend:3001`. Other frontend build arguments remain exactly those
in the host Compose configuration, as in `deploy-benefits-network.sh`; no replacement
frontend configuration or guessed image tag is used. Missing/mismatched arguments
refuse before writes. Check receipt audience/chain configuration under the existing
release process without displaying backend env values.

Create private backup directories and export every migration setting:

```bash
install -d -m 0700 /root/benefits-migration-backups /opt/inferno/backups
export MIGRATION_REPO=/opt/inferno/release-checkouts/3842f8ae4237ede7eadfc66c2887e3410026145b
export MIGRATION_EXPECTED_SHA=3842f8ae4237ede7eadfc66c2887e3410026145b
export MIGRATION_PREVIOUS_SHA=5468f561f98c2250eb210ace1bb42dc442bd5fc8
export MIGRATION_SOURCE_DIR=/opt/inferno/benefits-network
export MIGRATION_BACKUP_ROOT=/root/benefits-migration-backups
export MIGRATION_COMPOSE_FILE=/opt/inferno/docker-compose.yml
export MIGRATION_ENV_FILE=/opt/inferno/.env.benefits
export MIGRATION_HEALTH_URL=https://shop.ifrunit.tech/api/health
export MIGRATION_READY_URL=https://shop.ifrunit.tech/api/ready
export MIGRATION_FRONTEND_URL=https://shop.ifrunit.tech/
export MIGRATION_DISK_FLOOR_MIB=4096
export MIGRATION_BACKEND_SERVICE=benefits-backend
export MIGRATION_FRONTEND_SERVICE=benefits-frontend
export MIGRATION_BACKEND_CONTAINER=inferno-benefits-backend
export MIGRATION_FRONTEND_CONTAINER=inferno-benefits-frontend
# Resolve Docker's actual volume name and host mountpoint. Never guess from the key.
benefits_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}' inferno-benefits-backend)
test -n "$benefits_volume" || exit 1
benefits_mount=$(docker volume inspect --format '{{.Mountpoint}}' "$benefits_volume") || exit 1
test -d "$benefits_mount" || exit 1
export MIGRATION_DB_FILE="$benefits_mount/benefits.db"
unset benefits_volume benefits_mount
cd /opt/inferno/migration-tools
```

The script independently rechecks the volume mount, mountpoint, Compose volume name
and sole consumer. The previous image has no `USER` directive and runs as root;
the new backend uses `USER node` (uid 1000) and automatically runs migrations in its
startup CMD. Therefore do not start it before the explicit migration/ownership steps.

## Rehearse, plan and apply

While the old containers continue serving:

```bash
bash scripts/ops/benefits-migration-model-b-period-dedup.sh rehearse
bash scripts/ops/benefits-migration-model-b-period-dedup.sh plan
```

Rehearsal builds the exact target backend archive without moving production image
tags. Python opens the live SQLite file with `mode=ro` and uses SQLite's backup API
(with a 120-second progress deadline) into a private temporary directory. This supports
a live WAL database and avoids an unsafe raw copy. It checks before-invariants,
runs only `npx prisma migrate deploy` as uid/gid 1000 against the copy with
`--network none`, verifies completion/removal, checkpoints and runs after-invariants.
It removes the private copy and prints only `rehearsal=PASS` or `rehearsal=FAIL`.
It does not sync runtime source, change live ownership or stop services. Docker may
retain build cache/untagged images; use the normal capacity policy for later cleanup.
A live copy can briefly contend with writers; schedule it away from peak checkout load.

Plan is read-only and checks the real hooks, migration set/digests, running release,
Compose build/volume configuration, volume ownership prerequisites, clean checkouts,
healthy singleton containers, public health/readiness and a 4096 MiB free-space floor.
It creates no backups, tags, locks or containers. It does not run a migration.

Apply retains the template's conservative raw-backup rule: any SQLite `-wal`, `-shm`
or `-journal` sidecar at preflight or after stop causes refusal. Do not delete a live
sidecar to bypass it. A WAL-enabled production database needs a separately reviewed
stopped checkpoint/backup procedure before applying this version. A successful WAL
rehearsal alone does not satisfy the raw-backup guard.

After recording rehearsal/plan results, restore rehearsal and the specific owner approval:

```bash
bash scripts/ops/benefits-migration-model-b-period-dedup.sh apply
```

Apply locks the backup root and repeats preflight. It saves private previous Git
source, actual runtime source, Compose/env files and retained running-image IDs/tags,
with a verified checksum manifest. Runtime source backup/sync uses the deploy helper's
exclusions (`node_modules`, `.next`, `dist`, SQLite files and host env files); excluded
host-only files are preserved and never removed by rsync. It writes `RELEASE_SHA`
and builds both images through the existing Compose build configuration while old
containers continue serving. Candidate IDs are recorded and checked before start
and after restart.

It then stops both services, proves they stopped, backs up/verifies the database,
and records aggregate before-counts and zero unfinished migrations. It reuses the
ownership tool to set the resolved volume to uid/gid 1000, retaining its verified
ownership backups under `/opt/inferno/backups`. It does not restart the old image
between chown and migration. The named one-off uses the immutable new backend ID,
`--network none`, uid/gid 1000, a 300-second wait and bounded 30-second lifecycle
commands. It requires exited/0 and proves removal before WAL checkpoint and all
after-invariants. Both images then start without rebuilding or pulling. Postchecks
require container health, health/ready and `/` HTTP 200, backend uid 1000 and:

- `POST /api/sessions/cutover-smoke/redeem`: HTTP 410.
- `GET /api/customer/history`: HTTP 410.

Expected service downtime starts at the explicit Compose stop, after builds. Budget
5–10 minutes for backups, ownership, migration and health checks; the additive SQL
itself should be brief, but index creation and backups depend on database size.
Measure rehearsal/backup time to agree the actual window. Migration wait is bounded
at 300 seconds and readiness polling at 60 attempts, five seconds apart (plus probe
time); this is not a hard upper bound on total downtime. Any failed check after stop
keeps both services stopped and the lock retained. There is no automatic rollback.
If cleanup cannot prove one-off removal, its private working directory is retained
for operator isolation rather than deleting a potentially mounted database.

## Rollback and evidence

Keep maintenance active and obtain the specific restore authorization. Use the exact
backup directory created for this attempt, never a directory inferred from timestamps.
Follow its `RESTORE.txt` together with these release-specific steps:

1. Stop both services with the backed-up Compose/env configuration. Identify and
   stop/remove every `benefits-model-b-migrate-*` or rehearsal one-off; prove no writer
   remains, including cron/worker processes. A timeout is not proof of exit.
2. Inside the protected backup directory, run `sha256sum --check --status SHA256SUMS`.
   Require `database.sqlite` in the manifest. If it is absent, no verified stopped
   database backup completed; investigate without starting a different release.
3. With all writers stopped, handle sidecars only after confirming no live writer.
   Copy `database.sqlite` to a sibling temporary file beside `MIGRATION_DB_FILE`,
   set owner `1000:1000` and the backed-up database mode, and atomically rename on
   the same filesystem. Require the backup SHA-256 and read-only `integrity_check=ok`.
   Verify the saved before-counts and absence of the new migration record.
4. Extract `runtime-source.tgz` to an isolated directory, then restore its contents to
   `/opt/inferno/benefits-network` with the same content-only rsync/exclusions as apply.
   Preserve excluded host-only files. Require `RELEASE_SHA` to equal
   `5468f561f98c2250eb210ace1bb42dc442bd5fc8`. `previous-source.tgz` also contains
   the committed previous repository source (`apps/benefits-network` layout), for
   comparison/reconstruction; it is not a tar rooted at the runtime app directory.
5. Restore `compose.yml` and `runtime.env` privately to their original paths. From
   `images.tsv` create a reviewed Compose override pinning BOTH services to their
   saved immutable image IDs (or verified retained tags). Verify these IDs before
   start. Never run a new startup CMD on restored old data. The old root image can
   use the uid-1000-owned volume; no recursive chown back to root is needed.
6. Start only this old pairing with `--no-build --pull never`, using the explicit
   Compose/env files and override. Verify actual running IDs, singleton health,
   health/ready and frontend HTTP 200, and the two retired HTTP 410 routes. Compare
   old-release invariants. Keep maintenance if any proof fails. Remove the empty
   `.benefits-migration.lock` using `rmdir` only after verified recovery.

Restoring a pre-cutover database discards writes accepted after cutover; the owner must
accept that recovery point. Do not run the normal deploy rollback helper for these
migration backups: they have a different layout and require database/image pairing.
A preparation failure before stop still needs review of staged source/tags before retry.
SIGKILL or host loss cannot run traps; inspect all writers and locks before resuming.

Record only aggregate results and protected backup references in the release evidence:
reviewed tooling/script identities, app SHAs, image IDs, capacity, rehearsal/restore
results, maintenance times, before/after counts, ledger +1, integrity/foreign-key/index
results, HTTP codes, uid 1000 and acceptance/expiry. Keep databases, env files and
ownership archives private; do not attach raw artifacts. Retain backups and rollback
tags until the owner's acceptance/expiry decision, including ownership-tool backups.
