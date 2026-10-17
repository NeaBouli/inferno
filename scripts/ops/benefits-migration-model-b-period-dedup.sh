#!/usr/bin/env bash
# Reviewed Model B cutover. See docs/BENEFITS_MIGRATION_MODEL_B_PERIOD_DEDUP.md.
set +x
set +v
set -euo pipefail
umask 077
export GIT_OPTIONAL_LOCKS=0

MODE=${1:-plan}
[[ $# -le 1 && ( "$MODE" == plan || "$MODE" == apply || "$MODE" == rehearse ) ]] || {
  printf 'Usage: benefits-migration-model-b-period-dedup.sh [plan|apply|rehearse]\n' >&2
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
# Release identities and SQL are deliberately not configurable.
readonly TARGET_RELEASE=3842f8ae4237ede7eadfc66c2887e3410026145b
readonly PREVIOUS_RELEASE=5468f561f98c2250eb210ace1bb42dc442bd5fc8
readonly MIGRATION_ID=20261017120000_model_b_period_dedup
readonly SQL_SHA256=dcc7e7a0fe9ec9ebfc6b015b4f1c99b4ad0d1dcaf5437e963fe9250e35c83c28
SOURCE_DIR=${MIGRATION_SOURCE_DIR:-/opt/inferno/benefits-network}
FRONTEND_URL=${MIGRATION_FRONTEND_URL:-https://shop.ifrunit.tech/}
COMPOSE_DIR=$(dirname "$COMPOSE_FILE")
scratch=
volume_name=
volume_path=
runtime_mounts=
phase=configuration
maintenance=0
lock_owned=0
backup=

say() { [[ "$MODE" != rehearse ]] || return 0; printf '[benefits-migration] %s\n' "$1"; }
refuse() { say "status=STOP reason=$1" >&2; exit 2; }
docker_cmd() {
  local seconds=$1
  shift
  timeout --foreground --kill-after=5 "$seconds" docker "$@"
}
compose() {
  local seconds=30
  case "$1" in build) seconds=900 ;; stop|up) seconds=90 ;; esac
  (cd "$COMPOSE_DIR" && docker_cmd "$seconds" compose --project-directory "$COMPOSE_DIR" --file "$COMPOSE_FILE" \
    --env-file "$ENV_FILE" "$@")
}

# Same content-only sync and exclusions as deploy-benefits-network.sh. No
# --delete-excluded: host-only env, databases and build outputs stay on the host.
EXCLUDES=(node_modules .next dist '*.db' '*.db-journal' '*.db-wal' '*.db-shm' .env .env.local .env.production)
RSYNC_EXCLUDES=()
TAR_EXCLUDES=()
for x in "${EXCLUDES[@]}"; do
  RSYNC_EXCLUDES+=(--exclude "$x")
  TAR_EXCLUDES+=(--exclude "$x")
done

resolve_volume() {
  local mount discovered consumers mount_type
  # Inspect mount metadata only, including API volume options (subpaths are not
  # consistently exposed in .Mounts). Never dump container env/config.
  runtime_mounts=$(docker_cmd 30 inspect --format '{"mounts":{{json .Mounts}},"host_mounts":{{json .HostConfig.Mounts}},"tmpfs":{{json .HostConfig.Tmpfs}},"volumes_from":{{json .HostConfig.VolumesFrom}}}' "$BACKEND_CONTAINER")
  mount=$(python3 -I -B -c '
import json, sys
mounts=[v for v in json.loads(sys.argv[1])["mounts"] if v["Destination"] == "/data"]
assert len(mounts) == 1
v=mounts[0]
print("|".join([v["Type"], v.get("Name", ""), v["Source"]]))
' "$runtime_mounts")
  IFS='|' read -r mount_type volume_name volume_path <<< "$mount"
  [[ "$mount_type" == volume && "$volume_name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]
  discovered=$(docker_cmd 30 volume inspect --format '{{.Mountpoint}}' "$volume_name")
  [[ "$mount" == "volume|$volume_name|$discovered" && "$DB_FILE" == "$discovered/benefits.db" ]]
  [[ -d "$volume_path" && ! -L "$volume_path" ]]
  [[ "$BACKUP_ROOT/" != "$volume_path/"* && "$SOURCE_DIR/" != "$volume_path/"* ]]
  consumers=$(docker_cmd 30 ps -a --filter "volume=$volume_name" --format '{{.Names}}')
  [[ "$consumers" == "$BACKEND_CONTAINER" ]]
}

# Read Compose privately, never print environment/config JSON. Build via Compose
# exactly as the deploy helper does, retaining ALL configured frontend build args.
compose_model() {
  compose config --format json | python3 -I -B -c '
import json, pathlib, posixpath, sys
m=json.load(sys.stdin); source=pathlib.Path(sys.argv[1]); mode=sys.argv[2]
assert m["volumes"]["benefits-data"]["name"] == sys.argv[3]
for name, part in [("benefits-backend", "backend"), ("benefits-frontend", "frontend")]:
    s=m["services"][name]; build=s["build"]
    assert pathlib.Path(build["context"]).resolve() == (source / part).resolve()
    assert build.get("dockerfile", "Dockerfile") == "Dockerfile"
    assert not build.get("dockerfile_inline") and not build.get("target")
backend=m["services"]["benefits-backend"]
frontend=m["services"]["benefits-frontend"]
assert backend["environment"]["DATABASE_URL"] == "file:/data/benefits.db"
assert str(backend["environment"]["CHAIN_ID"]) == "1"
assert backend.get("user", "node") in ("node", "1000", "1000:1000")
assert not backend.get("command") and not backend.get("entrypoint")
assert str(frontend["build"]["args"]["NEXT_PUBLIC_CHAIN_ID"]) == "1"
assert frontend["build"]["args"]["BENEFITS_API_INTERNAL_URL"] == "http://benefits-backend:3001"
# All effective mounts must match the model. Refuse implicit/alternate mount
# mechanisms rather than guessing how Compose will combine them.
assert not any(backend.get(k) for k in ["volumes_from", "tmpfs", "configs", "secrets"])
def no_subpaths(value):
    if isinstance(value, dict):
        for k, v in value.items():
            if k.lower().replace("_", "").replace("-", "") == "subpath":
                assert v in (None, "")
            no_subpaths(v)
    elif isinstance(value, list):
        for v in value:
            no_subpaths(v)
def destination(value):
    assert isinstance(value, str) and value.startswith("/")
    return posixpath.normpath("/"+value.lstrip("/"))
def protected(value):
    return value in ("/", "/data") or value.startswith("/data/")
expected={}
for v in backend.get("volumes", []):
    no_subpaths(v)
    target=destination(v["target"]); kind=v["type"]
    assert target not in expected and kind in ("volume", "bind", "tmpfs")
    if protected(target):
        assert v["target"] == "/data" and kind == "volume" and v["source"] == "benefits-data"
        assert not v.get("read_only", False)
    src=v.get("source", "")
    if kind == "volume": src=m["volumes"][src]["name"]
    if kind == "bind": src=posixpath.normpath(src)
    expected[target]=(kind, src, not v.get("read_only", False))
assert "/data" in expected
runtime=json.loads(sys.argv[4]); no_subpaths(runtime)
assert not runtime["tmpfs"] and not runtime["volumes_from"]
actual={}
for v in runtime["mounts"]:
    target=destination(v["Destination"]); kind=v["Type"]
    assert target not in actual
    if protected(target):
        assert v["Destination"] == "/data" and kind == "volume"
        assert v["Name"] == sys.argv[3] and v["Source"] == sys.argv[5] and v["RW"] is True
    src=v.get("Name", "") if kind == "volume" else v.get("Source", "")
    if kind == "bind": src=posixpath.normpath(src)
    actual[target]=(kind, src, v["RW"])
assert actual == expected
for v in runtime["host_mounts"] or []:
    target=destination(v["Target"])
    assert target in actual and v["Type"] == actual[target][0]
    if protected(target):
        assert v["Target"] == "/data" and v["Type"] == "volume" and v["Source"] == sys.argv[3]
if mode == "images":
    for name in ["benefits-backend", "benefits-frontend"]:
        tag=m["services"][name].get("image") or m["name"] + "-" + name
        assert tag and not any(c.isspace() for c in tag)
        print(tag)
' "$SOURCE_DIR" "$1" "$volume_name" "$runtime_mounts" "$volume_path"
}

check_artifacts() {
  python3 -I -B - "$REPO" "$EXPECTED_SHA" "$PREVIOUS_SHA" "$MIGRATION_ID" "$SQL_SHA256" "$SOURCE_DIR" <<'PYARTIFACT'
import hashlib, pathlib, subprocess, sys
repo, target, previous, migration, digest, live = sys.argv[1:]
base="apps/benefits-network/backend/prisma/migrations/"
def git(*args):
    return subprocess.check_output(["git", "-C", repo, *args], stderr=subprocess.DEVNULL)
def manifest(sha):
    names=git("ls-tree", "-r", "--name-only", sha, "--", base).decode().splitlines()
    assert names
    return {n[len(base):]: hashlib.sha256(git("show", sha+":"+n)).hexdigest() for n in names}
old, new=manifest(previous), manifest(target)
assert set(new)-set(old) == {migration+"/migration.sql"}
assert not set(old)-set(new) and all(new[k] == v for k,v in old.items())
assert new[migration+"/migration.sql"] == digest
root=pathlib.Path(live)/"backend/prisma/migrations"
actual={str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob("*") if p.is_file()}
assert actual == old
assert (pathlib.Path(live)/"RELEASE_SHA").read_text().strip() == previous
PYARTIFACT
}

# Counts for application tables must be identical. Prisma's ledger is the sole
# expected +1 row; recording the migration necessarily changes its row count.
database_invariants() {
  python3 -I -B - "$1" "$DB_FILE" "$backup" "$MIGRATION_ID" "$SQL_SHA256" <<'PYDB'
import json, pathlib, sqlite3, sys
mode, filename, evidence, migration, digest = sys.argv[1:]
c=sqlite3.connect(pathlib.Path(filename).as_uri()+"?mode=ro", uri=True)
try:
    assert c.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
    assert c.execute("PRAGMA foreign_key_check").fetchall() == []
    assert c.execute("SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL").fetchone()[0] == 0
    records=c.execute("SELECT finished_at, rolled_back_at, checksum FROM _prisma_migrations WHERE migration_name=?", (migration,)).fetchall()
    counts={name: c.execute('SELECT count(*) FROM "'+name.replace('"', '""')+'"').fetchone()[0]
            for (name,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")}
    ledger=counts.pop("_prisma_migrations")
    f=pathlib.Path(evidence)/"counts-before.json"
    if mode == "before":
        assert not records
        assert not {"rewardPeriod", "rewardDedupKey"} & {r[1] for r in c.execute("PRAGMA table_info(RewardEvent)")}
        f.write_text(json.dumps({"tables": counts, "migration_records": ledger}, sort_keys=True)+"\n")
    else:
        assert len(records) == 1 and records[0][0] is not None and records[0][1] is None and records[0][2] == digest
        before=json.loads(f.read_text())
        assert counts == before["tables"] and ledger == before["migration_records"]+1
        columns={r[1]: r for r in c.execute("PRAGMA table_info(RewardEvent)")}
        for name in ["rewardPeriod", "rewardDedupKey"]:
            assert columns[name][2].upper() == "TEXT" and columns[name][3] == 0 and columns[name][4] is None
        indexes={r[1]: r for r in c.execute("PRAGMA index_list(RewardEvent)")}
        index="RewardEvent_partner_period_dedup_key"
        assert indexes[index][2] == 1 and indexes[index][4] == 0
        assert [r[2] for r in c.execute('PRAGMA index_info("'+index+'")')] == ["partnerId", "rewardPeriod", "rewardDedupKey"]
        assert c.execute("SELECT count(*) FROM RewardEvent WHERE rewardPeriod IS NOT NULL OR rewardDedupKey IS NOT NULL").fetchone()[0] == 0
        (pathlib.Path(evidence)/"invariants-after.json").write_text(json.dumps({"tables": counts, "migration_records": ledger, "integrity": "ok", "foreign_key_violations": 0, "migration": "finished_once", "backfill_rows": 0}, sort_keys=True)+"\n")
finally:
    c.close()
PYDB
}

checkpoint() {
  python3 -I -B - "$DB_FILE" <<'PYCHECKPOINT'
import pathlib, sqlite3, sys
c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=rw", uri=True)
try:
    result=c.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
    assert result[0] == 0 and result[1] == result[2]
finally:
    c.close()
PYCHECKPOINT
}

cleanup_oneoff() {
  [[ -n "$scratch" && -f "$scratch/oneoff-name" ]] || return 0
  local name remaining
  name=$(cat "$scratch/oneoff-name")
  # A timed-out client is not evidence that its container exited. Isolate the
  # persisted one-off identity before removal; retain it if absence is unproven.
  docker_cmd 30 kill "$name" >/dev/null 2>&1 || true
  docker_cmd 30 rm --force "$name" >/dev/null 2>&1 || return 1
  remaining=$(docker_cmd 30 ps -a --filter "name=^/$name$" --format '{{.Names}}') || return 1
  [[ -z "$remaining" ]] || return 1
  rm -- "$scratch/oneoff-name"
}

run_migration() {
  local image=$1 mount=$2 name=$3 result
  # Persist identity before create: cleanup can isolate a writer even if start/wait
  # fails. No --rm: inspect Exited/0 before explicitly removing and proving absence.
  printf '%s\n' "$name" >"$scratch/oneoff-name"
  docker_cmd 30 create --name "$name" --network none --user 1000:1000 \
    --mount "$mount" --env DATABASE_URL=file:/data/benefits.db \
    --entrypoint npx "$image" prisma migrate deploy >/dev/null
  docker_cmd 30 start "$name" >/dev/null
  result=$(docker_cmd 300 wait "$name")
  [[ "$result" == 0 ]]
  result=$(docker_cmd 30 inspect --format '{{.State.Status}} {{.State.ExitCode}}' "$name")
  [[ "$result" == 'exited 0' ]]
  cleanup_oneoff
  checkpoint
}

migration_hook() {
  case "$1" in
    check)
      [[ "$EXPECTED_SHA" == "$TARGET_RELEASE" && "$PREVIOUS_SHA" == "$PREVIOUS_RELEASE" ]]
      [[ "$BACKEND_SERVICE" == benefits-backend && "$FRONTEND_SERVICE" == benefits-frontend ]]
      [[ "$BACKEND_CONTAINER" == inferno-benefits-backend && "$FRONTEND_CONTAINER" == inferno-benefits-frontend ]]
      [[ -f "$script_dir/benefits-backend-volume-ownership.sh" && ! -L "$script_dir/benefits-backend-volume-ownership.sh" ]]
      check_artifacts
      resolve_volume
      compose_model check
      bash "$script_dir/benefits-backend-volume-ownership.sh" plan
      ;;
    prepare)
      resolve_volume
      compose_model check
      mkdir "$scratch/source"
      git -C "$REPO" archive --format=tar "$EXPECTED_SHA:apps/benefits-network" >"$scratch/source.tar"
      tar -xf "$scratch/source.tar" -C "$scratch/source"
      rsync -rl --checksum --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
        "${RSYNC_EXCLUDES[@]}" "$scratch/source/" "$SOURCE_DIR/"
      printf '%s\n' "$EXPECTED_SHA" >"$SOURCE_DIR/RELEASE_SHA"
      compose build "$BACKEND_SERVICE" "$FRONTEND_SERVICE"
      compose_model images >"$backup/candidate-tags"
      local tag id
      : >"$backup/candidate-images"
      while IFS= read -r tag; do
        id=$(docker_cmd 30 image inspect --format '{{.Id}}' "$tag")
        [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]]
        printf '%s\n' "$id" >>"$backup/candidate-images"
      done <"$backup/candidate-tags"
      id=$(docker_cmd 30 image inspect --format '{{.Config.User}}' "$(head -n 1 "$backup/candidate-images")")
      [[ "$id" == node ]]
      (cd "$backup" && sha256sum candidate-tags candidate-images >>SHA256SUMS)
      ;;
    migrate)
      resolve_volume
      compose_model check
      bash "$script_dir/benefits-backend-volume-ownership.sh" apply
      run_migration "$(head -n 1 "$backup/candidate-images")" "type=volume,src=$volume_name,dst=/data" \
        "benefits-model-b-migrate-$(basename "$backup" | tr '[:upper:]' '[:lower:]')"
      ;;
    *) return 1 ;;
  esac
}

verify_candidate_images() {
  local tag id index=1
  while IFS= read -r tag; do
    id=$(docker_cmd 30 image inspect --format '{{.Id}}' "$tag")
    [[ "$id" == "$(sed -n "${index}p" "$backup/candidate-images")" ]]
    index=$((index+1))
  done <"$backup/candidate-tags"
  [[ "$index" == 3 ]]
}

probe() {
  local code
  code=$(curl -q --silent --output /dev/null --write-out '%{http_code}' --request "$1" \
    --connect-timeout 5 --max-time 15 --proto '=http,https' --url "$2")
  [[ "$code" == "$3" ]]
}

invariant_hook() {
  case "$1" in
    check) python3 -I -B -c 'import sqlite3; assert sqlite3.sqlite_version_info >= (3,26,0)' ;;
    before) database_invariants before ;;
    after) database_invariants after; verify_candidate_images ;;
    online)
      resolve_volume
      compose_model check
      check_endpoints
      probe GET "$FRONTEND_URL" 200
      probe POST "${FRONTEND_URL%/}/api/sessions/cutover-smoke/redeem" 410
      probe GET "${FRONTEND_URL%/}/api/customer/history" 410
      local container result index=1
      result=$(docker_cmd 30 exec "$BACKEND_CONTAINER" id -u)
      [[ "$result" == 1000 ]]
      for container in "$BACKEND_CONTAINER" "$FRONTEND_CONTAINER"; do
        result=$(docker_cmd 30 inspect --format '{{.Image}}' "$container")
        [[ "$result" == "$(sed -n "${index}p" "$backup/candidate-images")" ]]
        index=$((index+1))
      done
      ;;
    *) return 1 ;;
  esac
}

on_exit() {
  local rc=$?
  trap - EXIT HUP INT TERM
  if ! cleanup_oneoff >/dev/null 2>&1; then
    rc=1
    say 'status=HALTED oneoff_cleanup_unproven isolate_writer_before_restore' >&2
  fi
  if [[ -n "$scratch" && ! -f "$scratch/oneoff-name" ]]; then
    rm -r -- "$scratch" >/dev/null 2>&1 || rc=1
  fi
  if [[ "$MODE" == rehearse ]]; then
    if [[ "$rc" == 0 ]]; then printf 'rehearsal=PASS\n'; else printf 'rehearsal=FAIL\n'; fi
  fi
  if [[ "$rc" != 0 ]]; then
    say "status=FAILED phase=$phase" >&2
    if [[ "$maintenance" == 1 ]]; then
      # Also stop a newly started release after a failed postcheck. Never guess a rollback.
      if compose stop "$FRONTEND_SERVICE" "$BACKEND_SERVICE" >/dev/null 2>&1; then
        say 'status=HALTED verify_all_writers_stopped_before_restore' >&2
      else
        docker_cmd 30 kill "$FRONTEND_CONTAINER" "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
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

for value in "$SOURCE_DIR" "$REPO" "$DB_FILE" "$BACKUP_ROOT" "$COMPOSE_FILE" "$ENV_FILE"; do
  [[ "$value" == /* && "$value" != *$'\n'* ]] || refuse ABSOLUTE_PATH_REQUIRED
done
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ && "$PREVIOUS_SHA" =~ ^[0-9a-f]{40}$ ]] || refuse FULL_SHA_REQUIRED
[[ "$DISK_FLOOR_MIB" =~ ^[1-9][0-9]{0,6}$ ]] || refuse INVALID_DISK_FLOOR
for value in "$BACKEND_SERVICE" "$FRONTEND_SERVICE" "$BACKEND_CONTAINER" "$FRONTEND_CONTAINER"; do
  [[ "$value" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || refuse INVALID_SERVICE_OR_CONTAINER
done
[[ "$BACKEND_SERVICE" != "$FRONTEND_SERVICE" && "$BACKEND_CONTAINER" != "$FRONTEND_CONTAINER" ]] || refuse DUPLICATE_SERVICE
for value in "$FRONTEND_URL" "$HEALTH_URL" "$READY_URL"; do
  [[ "$value" =~ ^https?://[^/]+/ && "$value" != *'@'* && "$value" != *'?'* && "$value" != *'#'* ]] || refuse PUBLIC_PROBE_URL_REQUIRED
done
for tool in git docker curl df awk tar sha256sum python3 cp chmod mkdir mktemp date rmdir dirname basename tr sleep cat rsync timeout head sed rm id chown; do
  command -v "$tool" >/dev/null 2>&1 || refuse MISSING_TOOL
done
REPO=$(cd "$REPO" 2>/dev/null && pwd -P) || refuse REPO_UNAVAILABLE
BACKUP_ROOT=$(cd "$BACKUP_ROOT" 2>/dev/null && pwd -P) || refuse BACKUP_ROOT_UNAVAILABLE
[[ "$BACKUP_ROOT/" != "$REPO/"* ]] || refuse BACKUPS_MUST_BE_OUTSIDE_CHECKOUT
[[ -d "$SOURCE_DIR" && ! -L "$SOURCE_DIR" ]] || refuse RUNTIME_SOURCE_UNAVAILABLE
SOURCE_DIR=$(cd "$SOURCE_DIR" && pwd -P)
[[ "$SOURCE_DIR" != / && "$SOURCE_DIR/" != "$REPO/"* && "$REPO/" != "$SOURCE_DIR/"* ]] || refuse UNSAFE_SOURCE_DIRECTORY
[[ "$BACKUP_ROOT/" != "$SOURCE_DIR/"* && "$SOURCE_DIR/" != "$BACKUP_ROOT/"* ]] || refuse UNSAFE_BACKUP_DIRECTORY
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
script_path=$script_dir/$(basename "${BASH_SOURCE[0]}")
# The reviewed operator-tool commit is separate from the immutable app release.
TOOL_REPO=$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null) || refuse TOOL_CHECKOUT_REQUIRED
[[ ! -L "$script_path" ]] || refuse SCRIPT_SYMLINK
for tool_path in "$script_path" "$script_dir/benefits-backend-volume-ownership.sh"; do
  git -C "$TOOL_REPO" ls-files --error-unmatch -- "${tool_path#"$TOOL_REPO/"}" >/dev/null 2>&1 || refuse TOOL_MUST_BE_TRACKED
done
[[ -z "$(git -C "$TOOL_REPO" status --porcelain --untracked-files=all --ignore-submodules=none)" ]] || refuse DIRTY_TOOL_CHECKOUT
[[ "$MODE" == plan || "$(id -u 2>/dev/null)" == 0 ]] || refuse ROOT_OPERATOR_REQUIRED

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
  [[ "$MODE" != rehearse ]] || return 0
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
    state=$(docker_cmd 30 inspect --format '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null) || return 1
    [[ "$state" == 'true healthy' ]] || return 1
    id=$(docker_cmd 30 inspect --format '{{.Id}}' "$container" 2>/dev/null) || return 1
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
  for path in "$REPO" "$SOURCE_DIR" "$(dirname "$DB_FILE")" "$BACKUP_ROOT"; do
    free_kib=$(df -Pk "$path" 2>/dev/null | awk 'NR==2 {print $4}') || refuse DISK_CHECK_FAILED
    [[ "$free_kib" =~ ^[0-9]+$ ]] || refuse DISK_CHECK_FAILED
    (( free_kib >= DISK_FLOOR_MIB * 1024 )) || refuse DISK_FLOOR
  done
  check_containers || refuse CONTAINERS_OR_REPLICAS_UNHEALTHY
  check_endpoints || refuse ENDPOINT_UNHEALTHY
  say 'preflight=PASS exact_sha clean_tree disk containers health ready'
}

preflight
phase=migration_hook_check
(migration_hook check) >/dev/null 2>&1
phase=invariant_hook_check
(invariant_hook check) >/dev/null 2>&1
if [[ "$MODE" == rehearse ]]; then
  phase=rehearsal
  # No lock, runtime source sync, ownership of live data, service stop or restart.
  # A private new image is built from the exact archive; no backend secrets needed.
  # Keep cleanup identity in the parent for failure and signal traps as well.
  scratch=$(mktemp -d "${TMPDIR:-/tmp}/benefits-model-b-rehearse.XXXXXXXX" 2>/dev/null)
  backup=$scratch
  rehearse_copy() {
    # A function-local database path cannot affect the subsequent apply path.
    local DB_FILE=$DB_FILE image user
    mkdir "$scratch/source" "$scratch/data"
    git -C "$REPO" archive --format=tar "$EXPECTED_SHA:apps/benefits-network" >"$scratch/source.tar"
    tar -xf "$scratch/source.tar" -C "$scratch/source"
    # --quiet returns an immutable ID without changing the production image tags.
    image=$(docker_cmd 900 build --quiet "$scratch/source/backend")
    [[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]]
    user=$(docker_cmd 30 image inspect --format '{{.Config.User}}' "$image")
    [[ "$user" == node ]]
    python3 -I -B - "$DB_FILE" "$scratch/data/benefits.db" <<'PYBACKUP'
import pathlib, sqlite3, sys, time
source=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro", uri=True)
target=sqlite3.connect(sys.argv[2])
deadline=time.monotonic()+120
def progress(*args):
    if time.monotonic() > deadline:
        raise TimeoutError("backup deadline")
try:
    source.backup(target, pages=256, progress=progress)
finally:
    target.close(); source.close()
PYBACKUP
    DB_FILE=$scratch/data/benefits.db
    database_invariants before
    # Only the private copy changes owner; the live volume is never chowned here.
    chown 1000:1000 "$scratch/data" "$DB_FILE"
    run_migration "$image" "type=bind,src=$scratch/data,dst=/data" "benefits-model-b-$(basename "$scratch" | tr '[:upper:]' '[:lower:]')"
    database_invariants after
  }
  (rehearse_copy) >/dev/null 2>&1
  exit 0
fi
if [[ "$MODE" == plan ]]; then
  say 'mode=plan read_only=true hook_checks=PASS'
  say 'steps=hook_checks backup_source_config_images prepare maintenance backup_database migrate invariants start postcheck'
  say 'rollback=verify_checksums restore_database_source_config_and_old_images_as_one_release'
  say 'status=PLAN_ONLY apply_requires_reviewed_hooks_and_separate_owner_authorization'
  exit 0
fi

# Direct subshell calls preserve errexit inside hooks; never wrap them in if/!.
phase=lock
mkdir "$BACKUP_ROOT/.benefits-migration.lock" 2>/dev/null || refuse MIGRATION_LOCKED
lock_owned=1
preflight
(migration_hook check) >/dev/null 2>&1
scratch=$(mktemp -d "${TMPDIR:-/tmp}/benefits-model-b-apply.XXXXXXXX")

phase=backup
backup=$(mktemp -d "$BACKUP_ROOT/benefits-migration-$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX")
chmod 0700 "$backup"
git -C "$REPO" archive --format=tar.gz "$PREVIOUS_SHA" >"$backup/previous-source.tgz" 2>/dev/null
tar "${TAR_EXCLUDES[@]}" -czf "$backup/runtime-source.tgz" -C "$SOURCE_DIR" . 2>/dev/null
cp -- "$COMPOSE_FILE" "$backup/compose.yml" 2>/dev/null
cp -- "$ENV_FILE" "$backup/runtime.env" 2>/dev/null
printf '%s\n' "$PREVIOUS_SHA" >"$backup/previous-sha"
printf '%s\n' "$EXPECTED_SHA" >"$backup/target-sha"
: >"$backup/images.tsv"
index=0
for container in "$BACKEND_CONTAINER" "$FRONTEND_CONTAINER"; do
  image=$(docker_cmd 30 inspect --format '{{.Image}}' "$container" 2>/dev/null)
  [[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]] || refuse INVALID_IMAGE_ID
  tag="benefits-migration-rollback-$(basename "$backup" | tr '[:upper:]' '[:lower:]')-$index:retained"
  docker_cmd 30 image tag "$image" "$tag" >/dev/null 2>&1
  retained_image=$(docker_cmd 30 image inspect --format '{{.Id}}' "$tag" 2>/dev/null)
  [[ "$retained_image" == "$image" ]] || refuse ROLLBACK_IMAGE_MISMATCH
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
4. Extract runtime-source.tgz into an isolated directory and restore via the documented
   content-only rsync/exclusions; verify RELEASE_SHA against previous-sha. The separate
   previous-source.tgz uses repository layout (apps/benefits-network). Restore compose.yml
   and runtime.env without displaying their contents. Pin BOTH old images
   from images.tsv in a reviewed Compose override and verify the exact image IDs.
   Never pair old code with the new schema, or start the new image on restored old data.
5. Recheck integrity and expected counts, then start only the proven old release with
   --no-build --pull never. Require container health, health/ready HTTP 200 and the old
   release's invariants. Keep maintenance active if any check fails.
6. Record outcome and sanitized evidence in BRIDGE. Release the migration lock only after
   recovery is verified. Backups contain private data; retain/delete per owner acceptance.
See docs/BENEFITS_MIGRATION_TEMPLATE.md for review and restore rehearsal requirements.
RESTORE
(cd "$backup" && sha256sum previous-source.tgz runtime-source.tgz compose.yml runtime.env images.tsv previous-sha target-sha RESTORE.txt >SHA256SUMS) 2>/dev/null
chmod 0600 "$backup/"*
(cd "$backup" && sha256sum --check --status SHA256SUMS) >/dev/null 2>&1
say 'backup=source_config_images_verified restore_instructions=RESTORE.txt'

phase=prepare
(migration_hook prepare) >/dev/null 2>&1
check_checkout

phase=maintenance
(resolve_volume; compose_model check) >/dev/null 2>&1
maintenance=1
compose stop "$FRONTEND_SERVICE" "$BACKEND_SERVICE" >/dev/null 2>&1
for container in "$BACKEND_CONTAINER" "$FRONTEND_CONTAINER"; do
  running=$(docker_cmd 30 inspect --format '{{.State.Running}}' "$container" 2>/dev/null)
  [[ "$running" == false ]] || refuse WRITER_STILL_RUNNING
done
remaining=$(compose ps --quiet "$BACKEND_SERVICE" "$FRONTEND_SERVICE" 2>/dev/null)
[[ -z "$remaining" ]] || refuse SERVICE_STILL_RUNNING

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
[[ "$(sha256sum <"$DB_FILE" 2>/dev/null)" == "$(sha256sum <"$backup/database.sqlite" 2>/dev/null)" ]] || refuse DATABASE_BACKUP_MISMATCH
(cd "$backup" && sha256sum database.sqlite >>SHA256SUMS && sha256sum --check --status SHA256SUMS) >/dev/null 2>&1
say 'backup=database_verified sha256 integrity row_counts'

phase=invariants_before
(invariant_hook before) >/dev/null 2>&1
phase=migrate
(migration_hook migrate) >/dev/null 2>&1
phase=invariants_after
(invariant_hook after) >/dev/null 2>&1
phase=start
(verify_candidate_images) >/dev/null 2>&1
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
