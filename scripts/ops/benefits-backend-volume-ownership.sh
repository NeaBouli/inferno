#!/usr/bin/env bash
# Host-only operator tool. Never starts a container, deploys, or deletes data.
set -euo pipefail

MODE="${1:-}"
CONTAINER=inferno-benefits-backend
BACKUP_DIR=/opt/inferno/backups
STOPPED=0

die() { echo "ERROR: $2" >&2; exit "$1"; }
docker_cmd() {
  local seconds=30
  [[ "$1" != stop ]] || seconds=90
  timeout --kill-after=5 "$seconds" docker "$@"
}
on_exit() {
  local status=$?
  if [[ "$STOPPED" == 1 ]]; then
    echo "Backend remains STOPPED. No automatic restart or release was performed." >&2
  fi
  if (( status != 0 )); then
    echo "Operation incomplete (exit $status). Retain any backup artifacts; inspect before retrying." >&2
  fi
}
trap on_exit EXIT

[[ $# == 1 && ( "$MODE" == plan || "$MODE" == apply ) ]] || die 64 "Usage: $0 plan|apply"
if [[ -n "${BENEFITS_VOLUME_PATH+x}${BENEFITS_BACKUP_DIR+x}" ]]; then
  [[ "${BENEFITS_OWNERSHIP_TEST_MODE:-}" == 1 && -n "${BENEFITS_VOLUME_PATH:-}" && -n "${BENEFITS_BACKUP_DIR:-}" ]] ||
    die 64 "Path overrides require BENEFITS_OWNERSHIP_TEST_MODE=1 and both test paths."
  BACKUP_DIR="$BENEFITS_BACKUP_DIR"
  echo "TEST MODE: injected volume and backup paths; use only with Docker/ownership shims."
fi
for tool in docker timeout find stat sort uniq df; do
  command -v "$tool" >/dev/null || die 69 "Missing required tool: $tool (Linux host required)."
done
if [[ "$MODE" == apply ]]; then
  [[ "$(id -u)" == 0 ]] || die 77 "apply must be run by the root operator on the Docker host."
  for tool in tar sha256sum chown chmod flock date; do
    command -v "$tool" >/dev/null || die 69 "Missing required tool: $tool"
  done
fi

# Resolve the actual volume name from the existing /data mount; Compose keys and
# project prefixes are not Docker volume names. Never guess or create a volume.
MOUNT="$(docker_cmd inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}|{{.Name}}|{{.Source}}{{end}}{{end}}' "$CONTAINER")" || die 78 "Cannot inspect backend /data mount."
IFS='|' read -r MOUNT_TYPE VOLUME MOUNT_SOURCE <<< "$MOUNT"
[[ "$MOUNT_TYPE" == volume && "$VOLUME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || die 78 "Backend /data must be a named volume."
# Inspect only selected fields: never dump container config, environment, or file contents.
DISCOVERED="$(docker_cmd volume inspect --format '{{.Mountpoint}}' "$VOLUME")" || die 78 "Cannot inspect $VOLUME."
[[ "$MOUNT_SOURCE" == "$DISCOVERED" ]] || die 78 "Backend /data source must match the complete volume mountpoint."
VOLUME_PATH="${BENEFITS_VOLUME_PATH:-$DISCOVERED}"
[[ "$VOLUME_PATH" == /* && -d "$VOLUME_PATH" && ! -L "$VOLUME_PATH" ]] || die 78 "Volume path must be an existing absolute directory, not a symlink."
VOLUME_PATH="$(cd "$VOLUME_PATH" && pwd -P)"
[[ "$VOLUME_PATH" != / ]] || die 78 "Refusing filesystem root."
[[ "$VOLUME_PATH" == "$(cd "$DISCOVERED" && pwd -P)" ]] || die 78 "Injected path does not match the inspected volume mountpoint."
MOUNT="$(docker_cmd inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}|{{.Name}}|{{.Source}}{{end}}{{end}}' "$CONTAINER")" || die 78 "Cannot inspect backend /data mount."
[[ "$MOUNT" == "volume|$VOLUME|$DISCOVERED" ]] || die 78 "Backend /data does not match the named volume and local mountpoint."
SERVICE="$(docker_cmd inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$CONTAINER")" || die 78 "Cannot inspect backend service label."
[[ "$SERVICE" == benefits-backend ]] || die 78 "Container is not the benefits-backend service."
CONSUMERS="$(docker_cmd ps -a --filter "volume=$VOLUME" --format '{{.Names}}')" || die 78 "Cannot inspect volume consumers."
[[ "$CONSUMERS" == "$CONTAINER" ]] || die 78 "Volume must be attached only to $CONTAINER (including stopped containers)."

backend_state() {
  STATE="$(docker_cmd inspect --format '{{.State.Status}}' "$CONTAINER")" || die 78 "Cannot inspect backend state."
  case "$STATE" in running|exited|created) ;; *) die 78 "Unsafe backend state: $STATE" ;; esac
}
backend_state

# No lock file is created. The advisory directory lock serializes this tool's applies.
if [[ "$MODE" == apply ]]; then
  exec 9< "$VOLUME_PATH"
  flock -n 9 || die 75 "Another ownership apply is holding the volume lock."
fi

read_paths() {
  local path complete=0
  PATHS=()
  # A terminating empty record makes find failures visible in the parent shell.
  while IFS= read -r -d '' path; do
    if [[ -z "$path" ]]; then complete=1; break; fi
    PATHS+=("$path")
  done < <(find "$VOLUME_PATH" -xdev -print0 && printf '\0')
  [[ "$complete" == 1 ]] || die 74 "Cannot inventory the complete volume."
}

read_paths
MODES=()
UIDS=()
CHANGES=0
DEVICE="$(stat -c %d -- "$VOLUME_PATH")" || die 74 "Cannot stat volume device."
echo "Volume: $VOLUME -> $VOLUME_PATH"
echo "Backend: $CONTAINER ($STATE)"
echo "Inventory (numeric uid:gid, mode, shell-quoted path; includes mountpoint):"
for path in "${PATHS[@]}"; do
  [[ ! -L "$path" && ( -f "$path" || -d "$path" ) ]] || die 78 "Symlinks and special files require separate operator review."
  metadata="$(stat -c '%u:%g %a %d %h' -- "$path")" || die 74 "Cannot stat a volume entry."
  read -r owner mode device links <<< "$metadata"
  [[ "$device" == "$DEVICE" ]] || die 78 "Nested mounts require separate operator review."
  [[ ! -f "$path" || "$links" == 1 ]] || die 78 "Hard-linked files require separate operator review."
  MODES+=("$mode")
  UIDS+=("${owner%%:*}")
  printf '  %s %s %q\n' "$owner" "$mode" "$path"
  if [[ "$owner" != 1000:1000 ]]; then CHANGES=$((CHANGES + 1)); fi
done
echo "Entries by uid (count uid; includes directories):"
printf '%s\n' "${UIDS[@]}" | sort -n | uniq -c
echo "SQLite files (metadata only):"
for path in "${PATHS[@]}"; do
  case "$path" in
    *.db|*.db-*|*.sqlite|*.sqlite-*|*.sqlite3|*.sqlite3-*) printf '  %q\n' "$path" ;;
  esac
done
echo "Free disk on the volume filesystem:"
df -h "$VOLUME_PATH"

next_commands() {
  cat <<'EOF'
Operator next steps (printed only; separate release authorization required):
  # The current release gate requires the previous backend container to be running.
  # Start the existing image, then immediately perform the reviewed gate release.
  docker start inferno-benefits-backend
  DEPLOY_MODE=gate EXPECTED_SHA=<full-reviewed-40-char-sha> scripts/deploy-benefits-network.sh backend
  curl --fail --silent --show-error https://shop.ifrunit.tech/api/health
  curl --fail --silent --show-error https://shop.ifrunit.tech/api/ready
  docker exec inferno-benefits-backend id -u   # must print 1000
EOF
}

if (( CHANGES == 0 )); then
  echo "NO-OP: every entry is already owned by 1000:1000; no backup, stop, or chown needed."
  next_commands
  exit 0
fi

echo "Apply would change $CHANGES entries to uid:gid 1000:1000 (including mountpoint as needed)."
echo "1. Create a fresh private tar and verified SHA-256 in $BACKUP_DIR/benefits-data-<UTC>-prestop.tar."
echo "2. Stop only $CONTAINER if running; leave every other container untouched."
echo "3. Create a second, stopped-backend tar and verified SHA-256: $BACKUP_DIR/benefits-data-<UTC>.tar."
printf '4. chown -R --no-dereference --preserve-root -- 1000:1000 %q\n' "$VOLUME_PATH"
echo "5. Restore any mode bits cleared by chown, verify every owner/mode, and leave the backend stopped."
if [[ "$MODE" == plan ]]; then next_commands; exit 0; fi

umask 077
# Reject backup locations within the volume, including symlinked parents.
mkdir -p -- "$BACKUP_DIR" || die 73 "Backup directory cannot be created; backend has not been stopped."
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd -P)"
case "$BACKUP_DIR/" in "$VOLUME_PATH/"*) die 78 "Backup directory must be outside the data volume." ;; esac
[[ "$(stat -c %u -- "$BACKUP_DIR")" == 0 ]] || die 73 "Backup directory must be root-owned."
backup_mode="$(stat -c %a -- "$BACKUP_DIR")"
(( (8#$backup_mode & 0022) == 0 )) || die 73 "Backup directory must not be group/world writable."
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

create_backup() {
  local suffix="$1" backup="$BACKUP_DIR/benefits-data-$STAMP$1.tar"
  # Never overwrite an existing or partial backup. Retain all artifacts on failure.
  (set -o noclobber; : > "$backup" && : > "$backup.sha256") || die 73 "Backup name already exists or cannot be reserved."
  tar --create --file "$backup" --numeric-owner --one-file-system -C "$VOLUME_PATH" . || die 73 "Tar backup failed ($suffix); ownership unchanged."
  tar --list --file "$backup" >/dev/null || die 73 "Tar verification failed; ownership unchanged."
  sha256sum "$backup" > "$backup.sha256" || die 73 "Cannot create backup checksum; ownership unchanged."
  sha256sum --check --status "$backup.sha256" || die 73 "Backup checksum verification failed; ownership unchanged."
  echo "Verified fresh backup: $backup (SHA-256: $backup.sha256)"
}

create_backup -prestop
backend_state
if [[ "$STATE" == running ]]; then
  docker_cmd stop --time 60 "$CONTAINER" >/dev/null || die 74 "Backend stop failed; ownership unchanged."
fi
STOPPED=1
backend_state
[[ "$STATE" == exited || "$STATE" == created ]] || die 74 "Backend did not stop; ownership unchanged."
# The prestop tar proves backup capability before downtime. Only this quiescent
# backup is suitable for SQLite restore (the live tar may be inconsistent).
create_backup ''
read_paths
ORIGINAL_PATHS=("${PATHS[@]}")
MODES=()
for path in "${PATHS[@]}"; do
  [[ ! -L "$path" && ( -f "$path" || -d "$path" ) ]] || die 78 "Volume entry type changed; ownership unchanged."
  metadata="$(stat -c '%a %d %h' -- "$path")" || die 74 "Cannot snapshot stopped volume."
  read -r mode device links <<< "$metadata"
  [[ "$device" == "$DEVICE" && ( ! -f "$path" || "$links" == 1 ) ]] || die 78 "Volume topology changed; ownership unchanged."
  MODES+=("$mode")
done
chown -R --no-dereference --preserve-root -- 1000:1000 "$VOLUME_PATH" || die 74 "chown failed; backend remains stopped for operator recovery."
for ((i=0; i<${#ORIGINAL_PATHS[@]}; i++)); do
  path="${ORIGINAL_PATHS[$i]}"
  mode="$(stat -c %a -- "$path")" || die 74 "Cannot read mode after chown."
  if [[ "$mode" != "${MODES[$i]}" ]]; then
    chmod -- "${MODES[$i]}" "$path" || die 74 "Cannot restore original mode bits."
  fi
  metadata="$(stat -c '%u:%g %a' -- "$path")" || die 74 "Cannot verify ownership."
  [[ "$metadata" == "1000:1000 ${MODES[$i]}" ]] || die 74 "Owner/mode verification failed; backend remains stopped."
done
read_paths
[[ "${#PATHS[@]}" == "${#ORIGINAL_PATHS[@]}" ]] || die 74 "Volume entries changed during ownership update."
for ((i=0; i<${#PATHS[@]}; i++)); do
  [[ "${PATHS[$i]}" == "${ORIGINAL_PATHS[$i]}" ]] || die 74 "Volume entries changed during ownership update."
done
echo "SUCCESS: all volume entries are 1000:1000; original permission modes preserved."
next_commands
