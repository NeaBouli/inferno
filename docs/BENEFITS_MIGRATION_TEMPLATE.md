# Benefits migration template

`scripts/ops/benefits-migration-template.sh` is the reusable EXT-07 cutover skeleton for a
single-instance Benefits deployment with SQLite and Docker Compose. Its default `plan` mode
performs read-only checks. `apply` refuses before backup or downtime until both required hooks
are implemented in a reviewed copy. This template does not authorize a production migration.

The normal deployment script rejects schema migrations. Use a separate migration release,
following the [privacy migration runbook](BENEFITS_CUSTOMER_PRIVACY_MIGRATION.md) and
[capacity runbook](BENEFITS_CAPACITY_RUNBOOK.md). No live deployment behavior is changed here.

## Instantiate a migration

1. Copy the script to a migration-specific name inside the repository. Implement the hooks
   below, commit the copy and obtain review for that exact commit. The executing script must
   be tracked in the clean target checkout; an edited or untracked copy is refused.
2. Establish the Definition of Ready: named owner, operator and independent reviewer;
   exact target and previous release SHAs; immutable image identities; migration scope and
   expected count deltas; all writers and jobs; capacity evidence; backup/restore rehearsal;
   maintenance window; rollback decision; and the owner's explicit action-specific approval.
   An implementation review or successful plan is not that production approval.
3. Prepare a recent database copy in a non-production environment. Rehearse the complete
   cutover and restore, including failure after a partial migration and after restart.
   Preserve aggregate counts and integrity results, not customer rows or proofs.
4. Set the configuration below in a clean operator shell. Values are non-secret paths,
   release IDs and public probe URLs. Keep credentials in the existing Compose env file;
   do not source, display or copy its contents into terminal output or BRIDGE.
5. Run `bash scripts/ops/<reviewed-copy>.sh` (equivalent to `plan`). Record its result and
   inspect capacity and rollback evidence. Plan never calls either hook, creates a backup,
   tags an image or stops a service; it therefore does not certify the custom hooks.
6. After the owner approves this specific migration, run the same copy with `apply` in an
   operator-managed durable session. The template exits on HUP/INT/TERM. Plan and apply
   repeat the core checks; apply also acquires an exclusive lock in the backup root.
7. Record postchecks and the owner's acceptance/backup expiry. Keep backup data and rollback
   tags until that decision. Retention and deletion are separate operator actions.

### Configuration

All variables use the `MIGRATION_` prefix. Required paths must be absolute. Create the backup
root beforehand, restrict its access, and place it outside the checkout. The script never
prints configuration values, endpoint bodies, raw tool errors or hook output.

| Variable suffix | Required value or default |
| --- | --- |
| `REPO` | Clean target repository root containing the reviewed script |
| `EXPECTED_SHA` | Full 40-character lowercase target commit SHA |
| `PREVIOUS_SHA` | Full previous release SHA, available as a local Git object |
| `DB_FILE` | Existing SQLite database file, not a symlink |
| `BACKUP_ROOT` | Existing protected backup directory outside the checkout |
| `COMPOSE_FILE` | Runtime Compose file to back up and use |
| `ENV_FILE` | Existing Compose env file; never displayed or sourced |
| `HEALTH_URL` | Public HTTP(S) health URL without credentials, query or fragment |
| `READY_URL` | Public HTTP(S) readiness URL with the same restrictions |
| `DISK_FLOOR_MIB` | `4096`, checked on source, database and backup filesystems |
| `BACKEND_SERVICE` | `benefits-backend` |
| `FRONTEND_SERVICE` | `benefits-frontend` |
| `BACKEND_CONTAINER` | `inferno-benefits-backend` |
| `FRONTEND_CONTAINER` | `inferno-benefits-frontend` |

For example, after supplying the required paths and SHAs:

```sh
export MIGRATION_HEALTH_URL=https://shop.ifrunit.tech/api/health
export MIGRATION_READY_URL=https://shop.ifrunit.tech/api/ready
bash scripts/ops/<reviewed-copy>.sh plan
```

Use Bash, Python 3 with SQLite, Git, Docker Compose, curl, GNU-compatible `sha256sum`, and
the standard filesystem utilities used by the script. The operator needs only the approved
filesystem and Docker access. The template does not grant or expand host permissions.

### Hook contracts

Edit the functions in the reviewed copy; there is no arbitrary command argument, external
hook loader or env-file evaluation. Each phase must fail with a nonzero status when its
contract is not proven. The caller suppresses stdout/stderr to prevent data disclosure;
write only reviewed aggregate evidence files into `$backup` after it exists. Do not log
credentials, database rows, signatures, wallet addresses or raw migration errors there.

| Function and phase | Required behavior |
| --- | --- |
| `migration_hook check` | Read-only validation of migration prerequisites, artifact identities, all hook implementations and rollback compatibility. `$backup` is not yet set. |
| `migration_hook prepare` | Stage/build the exact candidate images while old containers serve. Do not start new containers or migrate. Do not modify the tracked checkout. Runtime Compose changes must be covered by the saved original. |
| `migration_hook migrate` | Run the bounded migration with the reviewed image, without starting the application; wait for completion and prove all one-off writers exited. Perform required checkpoints/VACUUM here. |
| `invariant_hook check` | Read-only confirmation that the remaining invariant phases are implemented and supported. |
| `invariant_hook before` | Check pre-migration guards/counts against the stopped database after its backup is verified. |
| `invariant_hook after` | Verify migration history, integrity, foreign keys, intended row-count changes and any privacy scan before traffic resumes. |
| `invariant_hook online` | Verify application invariants after restart, plus migration-specific smoke checks. |

The `check` phases must not simply bypass the default refusal: they must validate the actual
implementation and required artifacts. In particular, prepare/migrate must establish that
Compose will start the intended images, including any automatic migration in their startup
command. The template cannot infer release compatibility from an image tag.

All database writers must be enumerated and quiesced. The core stops frontend/backend and
verifies both containers stopped, but it cannot discover an external worker or cron job.
The lock serializes template runs sharing one backup root; it does not lock SQLite against
other programs. Use that same root for this deployment and prevent concurrent deploy/prune
jobs. Hooks must use bounded timeouts and clean up or isolate a timed-out migration container.

## Backup, maintenance and rollback

The apply sequence is:

1. Verify exact target SHA, tracked/untracked cleanliness (including submodules), disk floor,
   exactly one healthy container per service, and health/ready HTTP 200.
2. Validate hooks, acquire `.benefits-migration.lock`, and repeat preflight.
3. Create a private `benefits-migration-<UTC timestamp>.<random>` backup directory (0700).
   Archive the previous committed source and copy runtime Compose/env files (0600). Save
   previous/target SHAs and running image IDs; retain and verify rollback image tags. Verify
   the `SHA256SUMS` manifest. The previous SHA must already have been checked against the
   deployed release by the operator; the template records the running image IDs independently.
4. Prepare candidate images, then recheck the target checkout. Stop both services and confirm
   they stopped. This begins maintenance/downtime. Raw SQLite backup is refused if any
   `-wal`, `-shm` or `-journal` file exists, both at preflight and after stop. Handle such
   databases through a separately reviewed SQLite backup/checkpoint strategy.
5. Copy the stopped database, compare SHA-256, run read-only integrity checks on both files,
   compare every table's row count, and add `database.sqlite` to the checksum manifest.
6. Run before-invariants, migration, and after-invariants. Start the prepared images with
   `--no-build --pull never`. Poll container health and both endpoints, then run online
   invariants. Only then report PASS and release the lock.

`RESTORE.txt` in each backup describes manual recovery. A failure after maintenance begins
attempts to stop both services, retains the lock and exits nonzero; stop success still needs
operator confirmation that all writers exited. HUP/INT/TERM use the same failure path.
Power loss/SIGKILL cannot run cleanup, so treat an interrupted apply as an incident and
verify service state before any restart. A preparation failure also needs review of staged
artifacts and runtime configuration before retrying.

For rollback, keep maintenance active and isolate every writer, including one-off containers.
Run `sha256sum --check --status SHA256SUMS` inside the backup; require the database entry.
Restore it using a sibling temporary file and atomic rename, then compare its hash and
read-only integrity results. Restore the previous source and runtime Compose/env files,
and pin both old image IDs from `images.tsv` in a reviewed Compose override. Prove the old
database/code/image pairing before starting with `--no-build --pull never`. Repeat old-release
health, readiness and invariants before reopening traffic. Remove the empty lock directory
with `rmdir` only after verified recovery. Never automatically mix old images with a new
schema or run a new image against restored old data.

The directory contains credentials and pre-migration customer data. Do not attach it, its env
file, database, or raw logs to BRIDGE or an issue. The template retains files and image tags;
the owner sets the access policy, acceptance window and deletion schedule.

## Review and evidence checklist

- The migration author supplies the exact diff, image/source identities, hook contracts,
  expected invariants and a successful copy rehearsal with a demonstrated restore.
- An independent database/backend reviewer checks SQL guards, transaction boundaries,
  migration history handling, expected count deltas, privacy checks and rollback pairing.
- The operations/release reviewer checks capacity, permissions, all writers, maintenance,
  one-off container cleanup, backup checksums, protected retention and restore/start commands.
- Gio (owner) approves the specific production action, downtime, rollback policy and backup
  acceptance/expiry. Record the named author/reviewers/operator and their decisions; do not
  infer approval from a green test or an earlier deployment approval.
- Append to local `BRIDGE.md`: migration ID, target/previous full SHAs, script digest, reviewer
  decisions and owner approval reference; image IDs/digests; sanitized capacity and plan
  results; rehearsal and restore results; protected backup reference, checksum-verification
  status and retention deadline; before/after aggregate counts, history/integrity/foreign-key
  results; maintenance times; endpoint status codes; final acceptance or rollback outcome.
  Store customer data and credentials only in the protected backup, never in this evidence.

## Worked mapping: owner-B cutover of 2026-10-11

This mapping describes the supplied one-off source script's checks and commands, not an
execution transcript. It targets release `262a2dcc184e0cfc4c8ab3c5a517f66027dd257e` from
`7a7828e9f47d0e2da2b8ea80788741b740859cc0` and migration
`20261006120000_owner_b_customer_session_privacy`, with public probes on `shop.ifrunit.tech`.

| Template step | What the source script specifies |
| --- | --- |
| Preflight / hook check | Requires root, the previous `RELEASE_SHA`, healthy backend/frontend, one backend replica, 4096 MiB on the data volume and 2048 MiB on the root filesystem. Checks required env keys and secret length without displaying values, absence of SQLite sidecars, zero unfinished rewards, zero invalid audit JSON and no existing owner-B migration record. |
| Artifact checks / prepare | Downloads the exact target Git archive; verifies the app file manifest and proof-context checker digest; patches the frontend chain build argument; checks proof context in a restricted pinned Node 22 container. Backs up source, env and Compose, retains old image tags, syncs target source, writes `RELEASE_SHA` and builds while old containers serve. |
| Maintenance / database backup | Stops frontend/backend, copies SQLite, checks backup integrity and equal table counts before migration. |
| Migration hook | Runs `npx prisma migrate deploy` in a named one-off backend container with a timeout, checks its removal and success output; requires one finished migration record, zero foreign-key violations and integrity `ok`; checkpoints WAL, runs VACUUM and scans for customer addresses with the target verifier before starting traffic. |
| Postcheck | Starts without rebuilding, waits for container health, requires HTTP 200 for `/`, `/api/health`, `/api/ready`; requires HTTP 410 for `POST /api/sessions/cutover-smoke/redeem` and `GET /api/customer/history`. |
| Rollback | Stops services and the migration container, restores a touched database with equal hash and integrity `ok`, restores source/Compose, verifies retagged old image IDs, restarts and waits for health; halts if pairing or restore is not proven. Marks the backup as containing customer data with deletion after owner acceptance. |

The reusable template deliberately uses a clean Git checkout, strict shell error handling,
a SHA-256 backup manifest, required custom hooks and manual rollback. The source script used
a verified downloaded archive and automatic rollback. Its volume/host paths and one-off
commands are not copied into defaults. Its control flow is not a drop-in hook implementation:
each future migration needs its own artifact, invariant and restore review.

## Local verification

```sh
bash -n scripts/ops/benefits-migration-template.sh
node scripts/ops/test-benefits-migration-template.cjs
node scripts/check-markdownlint-baseline.cjs
```

The fixture uses a temporary Git checkout and SQLite database with Docker/curl/disk PATH
shims. It checks read-only plan/default refusal, guard failures, private verified backups,
successful cutover and failure isolation. No production service or network is contacted.
After adding a Markdown file to Git, regenerate the tracked-file baseline with
`node scripts/check-markdownlint-baseline.cjs --write-baseline` and confirm that its only
change is the file count, with no new findings.
