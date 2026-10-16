#!/usr/bin/env bash
# Copy and review the hooks for each migration. See docs/BENEFITS_MIGRATION_TEMPLATE.md.
set +x
set +v
set -euo pipefail
umask 077
export GIT_OPTIONAL_LOCKS=0

MODE=${1:-plan}
[[ $# -le 1 && ( "$MODE" == plan || "$MODE" == apply ) ]] || {
  printf 'Usage: benefits-migration-template.sh [plan|apply]\n' >&2
  exit 64
}

# Configuration contains paths, public probe URLs and release IDs, never credentials.
REPO=${MIGRATION_REPO:-}
EXPECTED_SHA=${MIGRATION_EXPECTED_SHA:-}
PREVIOUS_SHA=${MIGRATION_PREVIOUS_SHA:-}
DB_FILE=${MIGRATION_DB_FILE:-}
BACKUP_ROOT=${MIGRATION_BACKUP_ROOT:-}
COMPOSE_FILE=${MIGRATION_COMPOSE_FILE:-}
ENV_FILE=${MIGRATION_ENV_FILE:-}
HEALTH_URL=${MIGRATION_HEALTH_URL:-}
READY_URL=${MIGRATION_READY_URL:-}
DISK_FLOOR_MIB=${MIGRATION_DISK_FLOOR_MIB:-4096}
BACKEND_SERVICE=${MIGRATION_BACKEND_SERVICE:-benefits-backend}
FRONTEND_SERVICE=${MIGRATION_FRONTEND_SERVICE:-benefits-frontend}
BACKEND_CONTAINER=${MIGRATION_BACKEND_CONTAINER:-inferno-benefits-backend}
FRONTEND_CONTAINER=${MIGRATION_FRONTEND_CONTAINER:-inferno-benefits-frontend}
phase=configuration
maintenance=0
lock_owned=0
backup=

say() { printf '[benefits-migration] %s\n' "$1"; }
refuse() { say "status=STOP reason=$1" >&2; exit 2; }
compose() {
  (cd "$REPO" && docker compose --project-directory "$REPO" --file "$COMPOSE_FILE" \
    --env-file "$ENV_FILE" "$@")
}

# -------- REQUIRED MIGRATION HOOK: replace this entire function in a reviewed copy. --------
migration_hook() {
  # $1 = check: read-only validation of artifacts, prerequisites and hook completeness.
  # $1 = prepare: build/stage the exact release images; old containers keep serving.
  # $1 = migrate: run the bounded migration in an isolated one-off container, wait for
  # completion and prove that container exited. Never start the application here.
  # Every phase refuses until implemented. Do not turn this into a generic command flag.
  return 1
}

# -------- REQUIRED INVARIANT HOOK: counts only, never row contents or secrets. --------
invariant_hook() {
  # $1 = check: read-only validation that the remaining phases are implemented.
  # $1 = before: read-only guards/counts against the stopped, backed-up database.
  # $1 = after: migration history, integrity, foreign keys and intended count deltas;
  #             runs before traffic. Include migration-specific privacy scans here.
  # $1 = online: read-only application invariants after health/ready checks.
  # Save only reviewed, aggregate evidence in $backup; output is suppressed by the caller.
  return 1
}

on_exit() {
  local rc=$?
  trap - EXIT HUP INT TERM
  if [[ "$rc" != 0 ]]; then
    say "status=FAILED phase=$phase" >&2
    if [[ "$maintenance" == 1 ]]; then
      # Also stop a newly started release after a failed postcheck. Never guess a rollback.
      if compose stop "$FRONTEND_SERVICE" "$BACKEND_SERVICE" >/dev/null 2>&1; then
        say 'status=HALTED verify_all_writers_stopped_before_restore' >&2
      else
        say 'status=HALTED stop_failed_operator_must_isolate_all_writers' >&2
      fi
      say 'rollback=manual use_backup_RESTORE.txt keep_maintenance_until_pairing_verified' >&2
    fi
  fi
  if [[ "$lock_owned" == 1 && "$maintenance" == 0 ]]; then
    rmdir "$BACKUP_ROOT/.benefits-migration.lock" >/dev/null 2>&1 || true
  fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

for value in "$REPO" "$DB_FILE" "$BACKUP_ROOT" "$COMPOSE_FILE" "$ENV_FILE"; do
  [[ "$value" == /* && "$value" != *$'\n'* ]] || refuse ABSOLUTE_PATH_REQUIRED
done
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ && "$PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]] || refuse FULL_SHA_REQUIRED
[[ "$DISK_FLOOR_MIB" =~ ^[1-9][0-9]{0,6}$ ]] || refuse INVALID_DISK_FLOOR
for value in "$BACKEND_SERVICE" "$FRONTEND_SERVICE" "$BACKEND_CONTAINER" "$FRONTEND_CONTAINER"; do
  [[ "$value" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || refuse INVALID_SERVICE_OR_CONTAINER
done
[[ "$BACKEND_SERVICE" != "$FRONTEND_SERVICE" && "$BACKEND_CONTAINER" != "$FRONTEND_CONTAINER" ]] || refuse DUPLICATE_SERVICE
for value in "$HEALTH_URL" "$READY_URL"; do
  [[ "$value" =~ ^https?://[^/]+/ && "$value" != *'@'* && "$value" != *'?'* && "$value" != *'#'* ]] || refuse PUBLIC_PROBE_URL_REQUIRED
done
for tool in git docker curl df awk tar sha256sum python3 cp chmod mkdir mktemp date rmdir dirname basename tr sleep cat; do
  command -v "$tool" >/dev/null 2>&1 || refuse MISSING_TOOL
done
REPO=$(cd "$REPO" 2>/dev/null && pwd -P) || refuse REPO_UNAVAILABLE
BACKUP_ROOT=$(cd "$BACKUP_ROOT" 2>/dev/null && pwd -P) || refuse BACKUP_ROOT_UNAVAILABLE
[[ "$BACKUP_ROOT/" != "$REPO/"* ]] || refuse BACKUPS_MUST_BE_OUTSIDE_CHECKOUT
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
script_path=$script_dir/$(basename "${BASH_SOURCE[0]}")
[[ "$script_path" == "$REPO/"* && ! -L "$script_path" ]] || refuse SCRIPT_MUST_BE_IN_CHECKOUT
git -C "$REPO" ls-files --error-unmatch -- "${script_path#"$REPO/"}" >/dev/null 2>&1 || refuse SCRIPT_MUST_BE_TRACKED

check_checkout() {
  local head dirty top
  top=$(git -C "$REPO" rev-parse --show-toplevel 2>/dev/null) || refuse NOT_A_CHECKOUT
  [[ "$top" == "$REPO" ]] || refuse REPO_ROOT_REQUIRED
  head=$(git -C "$REPO" rev-parse HEAD 2>/dev/null) || refuse NO_HEAD
  [[ "$head" == "$EXPECTED_SHA" ]] || refuse EXACT_SHA_MISMATCH
  git -C "$REPO" cat-file -e "$PREVIOUS_SHA^{commit}" >/dev/null 2>&1 || refuse PREVIOUS_SOURCE_MISSING
  dirty=$(git -C "$REPO" status --porcelain --untracked-files=all --ignore-submodules=none 2>/dev/null) || refuse STATUS_FAILED
  [[ -z "$dirty" ]] || refuse DIRTY_CHECKOUT
}

check_database_file() {
  [[ -f "$DB_FILE" && ! -L "$DB_FILE" ]] || refuse DATABASE_UNAVAILABLE
  # A raw SQLite copy is supported only without sidecars, even after writers stop.
  local suffix
  for suffix in -wal -shm -journal; do
    [[ ! -e "$DB_FILE$suffix" ]] || refuse SQLITE_SIDECAR_PRESENT
  done
}

check_containers() {
  local service container state id replicas
  for service in "$BACKEND_SERVICE" "$FRONTEND_SERVICE"; do
    container=$BACKEND_CONTAINER
    [[ "$service" == "$BACKEND_SERVICE" ]] || container=$FRONTEND_CONTAINER
    state=$(docker inspect --format '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null) || return 1
    [[ "$state" == 'true healthy' ]] || return 1
    id=$(docker inspect --format '{{.Id}}' "$container" 2>/dev/null) || return 1
    replicas=$(compose ps --all --quiet "$service" 2>/dev/null) || return 1
    [[ -n "$id" && "$replicas" == "$id" ]] || return 1
  done
}

check_endpoints() {
  local url code
  for url in "$HEALTH_URL" "$READY_URL"; do
    code=$(curl -q --silent --output /dev/null --write-out '%{http_code}' \
      --connect-timeout 5 --max-time 15 --proto '=http,https' --url "$url" 2>/dev/null) || return 1
    [[ "$code" == 200 ]] || return 1
  done
}

preflight() {
  phase=preflight
  check_checkout
  check_database_file
  [[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" ]] || refuse RUNTIME_FILES_UNAVAILABLE
  local path free_kib
  for path in "$REPO" "$(dirname "$DB_FILE")" "$BACKUP_ROOT"; do
    free_kib=$(df -Pk "$path" 2>/dev/null | awk 'NR==2 {print $4}') || refuse DISK_CHECK_FAILED
    [[ "$free_kib" =~ ^[0-9]+$ ]] || refuse DISK_CHECK_FAILED
    (( free_kib >= DISK_FLOOR_MIB * 1024 )) || refuse DISK_FLOOR
  done
  check_containers || refuse CONTAINERS_OR_REPLICAS_UNHEALTHY
  check_endpoints || refuse ENDPOINT_UNHEALTHY
  say 'preflight=PASS exact_sha clean_tree disk containers health ready'
}

preflight
if [[ "$MODE" == plan ]]; then
  say 'mode=plan read_only=true hooks_executed=false'
  say 'steps=hook_checks backup_source_config_images prepare maintenance backup_database migrate invariants start postcheck'
  say 'rollback=verify_checksums restore_database_source_config_and_old_images_as_one_release'
  say 'status=PLAN_ONLY apply_requires_reviewed_hooks_and_separate_owner_authorization'
  exit 0
fi

# Direct subshell calls preserve errexit inside hooks; do not wrap them in an if/! test.
phase=migration_hook_check
(migration_hook check) >/dev/null 2>&1
phase=invariant_hook_check
(invariant_hook check) >/dev/null 2>&1
phase=lock
mkdir "$BACKUP_ROOT/.benefits-migration.lock" 2>/dev/null || refuse MIGRATION_LOCKED
lock_owned=1
preflight

phase=backup
backup=$(mktemp -d "$BACKUP_ROOT/benefits-migration-$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX")
chmod 0700 "$backup"
git -C "$REPO" archive --format=tar.gz "$PREVIOUS_SHA" >"$backup/previous-source.tgz" 2>/dev/null
cp -- "$COMPOSE_FILE" "$backup/compose.yml" 2>/dev/null
cp -- "$ENV_FILE" "$backup/runtime.env" 2>/dev/null
printf '%s\n' "$PREVIOUS_SHA" >"$backup/previous-sha"
printf '%s\n' "$EXPECTED_SHA" >"$backup/target-sha"
: >"$backup/images.tsv"
index=0
for container in "$BACKEND_CONTAINER" "$FRONTEND_CONTAINER"; do
  image=$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null)
  [[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]] || refuse INVALID_IMAGE_ID
  tag="benefits-migration-rollback-$(basename "$backup" | tr '[:upper:]' '[:lower:]')-$index:retained"
  docker image tag "$image" "$tag" >/dev/null 2>&1
  [[ "$(docker image inspect --format '{{.Id}}' "$tag" 2>/dev/null)" == "$image" ]] || refuse ROLLBACK_IMAGE_MISMATCH
  printf '%s\t%s\t%s\n' "$container" "$image" "$tag" >>"$backup/images.tsv"
  index=$((index + 1))
done
cat >"$backup/RESTORE.txt" <<'RESTORE'
MANUAL ROLLBACK ONLY: separate owner approval is required to restore production data.
1. Keep maintenance active. Stop ALL database writers, including any one-off migration
   container from the hook. Confirm they exited; a timeout alone does not prove this.
2. In this backup directory run: sha256sum --check --status SHA256SUMS
   Require a database.sqlite entry. If absent, no verified database backup was completed;
   do not run a migration or start a different release. Investigate before proceeding.
3. Restore database.sqlite through a sibling temporary file and atomic rename on the same
   filesystem, with writers stopped. Handle SQLite sidecars only after checking for live
   writers. Compare the restored SHA-256 to the backup and run read-only integrity_check.
4. Extract previous-source.tgz into an isolated directory; verify previous-sha. Restore
   compose.yml and runtime.env without displaying their contents. Pin BOTH old images
   from images.tsv in a reviewed Compose override and verify the exact image IDs.
   Never pair old code with the new schema, or start the new image on restored old data.
5. Recheck integrity and expected counts, then start only the proven old release with
   --no-build --pull never. Require container health, health/ready HTTP 200 and the old
   release's invariants. Keep maintenance active if any check fails.
6. Record outcome and sanitized evidence in BRIDGE. Release the migration lock only after
   recovery is verified. Backups contain private data; retain/delete per owner acceptance.
See docs/BENEFITS_MIGRATION_TEMPLATE.md for review and restore rehearsal requirements.
RESTORE
(cd "$backup" && sha256sum previous-source.tgz compose.yml runtime.env images.tsv previous-sha target-sha RESTORE.txt >SHA256SUMS)
chmod 0600 "$backup/"*
(cd "$backup" && sha256sum --check --status SHA256SUMS) >/dev/null 2>&1
say 'backup=source_config_images_verified restore_instructions=RESTORE.txt'

phase=prepare
(migration_hook prepare) >/dev/null 2>&1
check_checkout

phase=maintenance
maintenance=1
compose stop "$FRONTEND_SERVICE" "$BACKEND_SERVICE" >/dev/null 2>&1
for container in "$BACKEND_CONTAINER" "$FRONTEND_CONTAINER"; do
  [[ "$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null)" == false ]] || refuse WRITER_STILL_RUNNING
done
[[ -z "$(compose ps --quiet "$BACKEND_SERVICE" "$FRONTEND_SERVICE" 2>/dev/null)" ]] || refuse SERVICE_STILL_RUNNING

phase=database_backup
check_database_file
cp -- "$DB_FILE" "$backup/database.sqlite" 2>/dev/null
chmod 0600 "$backup/database.sqlite"
python3 -I -B - "$DB_FILE" "$backup/database.sqlite" >/dev/null 2>&1 <<'PY'
import pathlib
import sqlite3
import sys

connections = [sqlite3.connect(pathlib.Path(p).as_uri() + "?mode=ro", uri=True) for p in sys.argv[1:]]
try:
    counts = []
    for connection in connections:
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise RuntimeError("integrity check failed")
        tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
        counts.append({name: connection.execute('SELECT count(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0] for (name,) in tables})
    if counts[0] != counts[1]:
        raise RuntimeError("backup row counts differ")
finally:
    for connection in connections:
        connection.close()
PY
[[ "$(sha256sum <"$DB_FILE")" == "$(sha256sum <"$backup/database.sqlite")" ]] || refuse DATABASE_BACKUP_MISMATCH
(cd "$backup" && sha256sum database.sqlite >>SHA256SUMS && sha256sum --check --status SHA256SUMS) >/dev/null 2>&1
say 'backup=database_verified sha256 integrity row_counts'

phase=invariants_before
(invariant_hook before) >/dev/null 2>&1
phase=migrate
(migration_hook migrate) >/dev/null 2>&1
phase=invariants_after
(invariant_hook after) >/dev/null 2>&1
phase=start
compose up -d --no-build --pull never "$BACKEND_SERVICE" "$FRONTEND_SERVICE" >/dev/null 2>&1
phase=postcheck
healthy=0
for ((attempt=0; attempt<60; attempt++)); do
  if check_containers && check_endpoints; then healthy=1; break; fi
  sleep 5
done
[[ "$healthy" == 1 ]] || refuse POSTCHECK_FAILED
(invariant_hook online) >/dev/null 2>&1
maintenance=0
say 'status=PASS backup_retained record_acceptance_and_expiry_in_BRIDGE'
