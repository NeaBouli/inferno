#!/usr/bin/env bash
# Exact-SHA release of one docker compose service on the production host (T-162;
# merged Telegram/Points/Copilot fixes such as CWA-34 were not live because
# server releases were manual root sessions).
#
#   EXPECTED_SHA=<sha> scripts/deploy-compose-service.sh <service> plan     # read-only
#   EXPECTED_SHA=<sha> scripts/deploy-compose-service.sh <service> deploy   # operator only
#   scripts/deploy-compose-service.sh <service> verify                      # public HTTP only
#   scripts/deploy-compose-service.sh <service> rollback <backup dir>       # operator only
#
# DEPLOY_MODE=gate routes plan/deploy/rollback through the scoped host gate
# (ssh -F ~/.fleet-ssh/config hetzner-deploy ...) and adds status|health|logs|backups;
# rollback then takes the backup stamp. In gate mode backup, health wait and failure
# handling are done by the installed host tool within its accepted guarantees; its
# recovery of a real failing service release is not yet verified, so watch the result
# and use `rollback <stamp>` explicitly. Unset DEPLOY_MODE keeps the direct path below.
#
# <service>: telegram-bot | points-backend | ai-copilot
#
# Direct path (no DEPLOY_MODE) deploy: capacity floor (never prunes) -> new backup dir with a source tar and the
# current image id -> rollback image tag -> rsync of the git-archived app dir
# (env and SQLite files at any depth, root node_modules, dist and data are excluded and never
# deleted) -> compose rebuild of that one service -> bounded health wait ->
# public checks. Any failure after the backup rolls back automatically and exits
# non-zero. Runbook: docs/COMPOSE_SERVICE_RELEASE.md
#
# Transfers are content-only (T-255): no -t/-a/-g/-o/-p. The v1 deploy user may
# write under /opt/inferno (ACL) but may not set times, owner, group or mode on
# root-owned inodes, so metadata flags made rsync exit 23. Changed files are
# rewritten (new inode owned by the deployer, mode kept), unchanged ones are left
# alone (--checksum). Every rsync error still fails the run and rolls back.
set -euo pipefail

SERVICE="${1:-}"
MODE="${2:-plan}"
SSH_HOST="${SSH_HOST:-hetzner}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/inferno}"
REMOTE_VOLUME="${REMOTE_VOLUME:-/mnt/HC_Volume_106164848}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-36}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
MIN_FREE_MB=4096   # fixed floor: a rebuild below 4 GB free has failed before; never prune here
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

remote() { ssh "$SSH_HOST" "$@"; }
die() { echo "ERROR: $*" >&2; exit 1; }

case "$SERVICE" in
  telegram-bot)   APP_DIR="apps/telegram/telegram-bot" ;;
  points-backend) APP_DIR="apps/points-backend" ;;
  ai-copilot)     APP_DIR="apps/ai-copilot" ;;
  *) die "usage: $0 <telegram-bot|points-backend|ai-copilot> <plan|deploy|verify|rollback>" ;;
esac
SRC="$REMOTE_ROOT/$SERVICE"
CONTAINER="inferno-$SERVICE"
IMAGE="inferno-$SERVICE"

# Values below are interpolated into remote shell strings; allow plain names/paths only.
for var in SSH_HOST REMOTE_ROOT REMOTE_VOLUME; do
  [[ "${!var}" =~ ^[A-Za-z0-9._/@-]+$ ]] || die "$var contains characters outside [A-Za-z0-9._/@-]"
done
for var in HEALTH_ATTEMPTS HEALTH_INTERVAL; do
  [[ "${!var}" =~ ^[0-9]+$ ]] || die "$var must be an integer"
done

# Remote-only files that a release must never ship, overwrite or delete. Env and
# SQLite files match at any depth; runtime dirs only at the service root, so nested
# source such as src/data is shipped, backed up and restored. rsync anchors a
# leading '/' to the transfer root ($SRC); tar members start with "$SERVICE/" (tar
# matches excludes after any '/', so it would also skip a nested "<service>/data").
EXCLUDES=('.env*' '*.db*' /node_modules /dist /data)
EXCLUDE_ARGS=()
REMOTE_EXCLUDES=""
TAR_EXCLUDES=""
for x in "${EXCLUDES[@]}"; do
  EXCLUDE_ARGS+=(--exclude "$x")
  REMOTE_EXCLUDES="$REMOTE_EXCLUDES '$x'"   # quoted args for the remote restore script
  [[ "$x" == /* ]] && x="$SERVICE$x"
  TAR_EXCLUDES="$TAR_EXCLUDES --exclude '$x'"
done

require_sha() {
  [[ "${EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || die "set EXPECTED_SHA to the full 40-char release commit"
  git -C "$ROOT" cat-file -e "${EXPECTED_SHA}^{commit}" 2>/dev/null || die "commit $EXPECTED_SHA is not in this clone; git fetch first"
}

require_clean_exact_checkout() {
  [[ "$(git -C "$ROOT" rev-parse HEAD)" == "$EXPECTED_SHA" ]] || die "HEAD is not $EXPECTED_SHA; check out the exact release commit"
  [[ -z "$(git -C "$ROOT" status --porcelain)" ]] || die "working tree is dirty; release only from a clean checkout"
}

# The app dir of the release commit, never the working tree, plus RELEASE_SHA.
stage_release() {
  STAGE="$(mktemp -d)"
  trap 'rm -r "$STAGE"' EXIT
  mkdir "$STAGE/src"
  git -C "$ROOT" archive --format=tar "$EXPECTED_SHA:$APP_DIR" | tar -x -C "$STAGE/src"
  test -f "$STAGE/src/Dockerfile" || die "$APP_DIR has no Dockerfile at $EXPECTED_SHA"
  printf '%s\n' "$EXPECTED_SHA" > "$STAGE/src/RELEASE_SHA"
}

free_mb() {
  remote "df -BM --output=avail '$REMOTE_VOLUME' | tail -1 | tr -dc '0-9'"
}

container_state() {
  remote "docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' '$CONTAINER'" 2>/dev/null || echo "missing"
}

remote_precheck() {
  remote "test -d '$SRC' && test -f '$REMOTE_ROOT/docker-compose.yml'" || die "$SRC or $REMOTE_ROOT/docker-compose.yml missing on $SSH_HOST"
  remote "docker image inspect -f '{{.Id}}' '$IMAGE:latest' >/dev/null" || die "image $IMAGE:latest not found; nothing to roll back to"
  FREE="$(free_mb)"
  [[ "$FREE" =~ ^[0-9]+$ ]] || die "could not read free space of $REMOTE_VOLUME"
  echo "remote: $CONTAINER $(container_state), ${FREE}M free on $REMOTE_VOLUME, live release $(remote "cat '$SRC/RELEASE_SHA' 2>/dev/null || echo unknown")"
}

set_rsync_args() {
  # Content only (see header): -r -l keep the tree and symlinks, --checksum skips
  # unchanged files without comparing times. --chmod sets the mode of new files
  # only (no -p). Symbolic --chmod: numeric modes need rsync >= 3.1; macOS ships 2.6.9.
  # No --delete-excluded: excluded remote files are never removed.
  RSYNC_ARGS=(-rl --checksum --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r --itemize-changes "${EXCLUDE_ARGS[@]}")
}

wait_healthy() {
  remote "
    for i in \$(seq 1 '$HEALTH_ATTEMPTS'); do
      status=\$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' '$CONTAINER' 2>/dev/null || true)
      [ \"\$status\" = healthy ] && exit 0
      [ \"\$status\" = unhealthy ] && break
      sleep '$HEALTH_INTERVAL'
    done
    echo \"$CONTAINER not healthy: \$status\" >&2
    exit 1
  "
}

check_code() { # check_code <expected> <url>
  local actual
  actual="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$2?release=$RANDOM" 2>/dev/null)" || actual="unreachable"
  if [[ "$actual" == "$1" ]]; then echo "ok    $1 $2"; return 0; fi
  echo "FAIL  $2 returned $actual (expected $1)"
  return 1
}

verify_public() {
  local failures=0
  case "$SERVICE" in
    points-backend) check_code 200 https://points-api.ifrunit.tech/health || failures=$((failures + 1)) ;;
    ai-copilot)     check_code 200 https://copilot-api.ifrunit.tech/api/health || failures=$((failures + 1)) ;;
    telegram-bot)
      check_code 404 https://verify-api.ifrunit.tech/ || failures=$((failures + 1))
      # CWA-34: the identity-leaking status route must be gone.
      check_code 404 https://verify-api.ifrunit.tech/api/verify/status/1 || failures=$((failures + 1))
      ;;
  esac
  (( failures == 0 )) || { echo "$failures public check(s) failed" >&2; return 1; }
  echo "verified: $SERVICE public checks pass"
}

# Runs on the host via `bash -s -- <backup> <src> <service> <image> <stamp>
# <remote root> <excludes...>`: restores the source dir and the image of the
# backup, recreates the container without building, then proves the restore is
# complete, not only content-identical. Excluded files are left as they are and
# are not compared. Any failed step or check exits non-zero. The body is one
# function, so bash has read all of it before any command could consume stdin.
IFS= read -r -d '' RESTORE_SCRIPT <<'REMOTE' || true
set -euo pipefail
main() {
backup="$1" src="$2" service="$3" image="$4" stamp="$5" root="$6"
shift 6
fail() { echo "ROLLBACK CHECK FAILED: $*" >&2; exit 1; }
# Excludes as for deploy: rsync anchors a leading '/' to the transfer root; find
# prunes the same entries (-path ./x for anchored ones, -name for the rest).
rx=() prune=()
for x in "$@"; do
  rx+=(--exclude "$x")
  [ ${#prune[@]} -eq 0 ] || prune+=(-o)
  case "$x" in /*) prune+=(-path ".$x") ;; *) prune+=(-name "$x") ;; esac
done
[ ${#prune[@]} -eq 0 ] || prune=(\( "${prune[@]}" \) -prune -o)
test -f "$backup/source.tgz" || fail "$backup/source.tgz missing"
docker image inspect "$image:rollback-$stamp" >/dev/null || fail "image $image:rollback-$stamp missing"
t="$(mktemp -d)"
trap 'rm -r "$t"' EXIT
tar -C "$t" -xpzf "$backup/source.tgz"
ref="$t/$service" live="$src"
# Content only, like deploy: the v1 user cannot set times/owner/group/mode on root-owned inodes.
rsync -rl --checksum --delete "${rx[@]}" "$ref/" "$live/" || fail "rsync exited $?"
docker image tag "$image:rollback-$stamp" "$image:latest"
(cd "$root" && docker compose up -d --no-build --no-deps "$service")
lst() { local d="$1"; shift; (cd "$d" && find . ${prune[@]+"${prune[@]}"} "$@" -print) | LC_ALL=C sort; }
links() { lst "$1" -type l | while IFS= read -r p; do printf '%s -> %s\n' "$p" "$(readlink "$1/$p")"; done; }
# (b) symlinks: same paths and targets (checked first, so a link change is named as such)
diff <(links "$ref") <(links "$live") >&2 || fail "(b) symlinks differ from the backup"
# (a) content: same dirs and files (excludes pruned) and every file byte-identical;
# diff -rq -x cannot anchor the root-only excludes, so nested src/data is compared too
diff <(lst "$ref" -type d) <(lst "$live" -type d) >&2 || fail "(a) directories differ from the backup"
diff <(lst "$ref" -type f) <(lst "$live" -type f) >&2 || fail "(a) files differ from the backup"
changed=0
while IFS= read -r p; do
  cmp -s "$ref/$p" "$live/$p" || { echo "differs: $p" >&2; changed=1; }
done < <(lst "$ref" -type f)
[ "$changed" = 0 ] || fail "(a) content differs from the backup"
# (c) access: nothing the backup let others read (files o+r, dirs o+rx) lost it
missing="$(LC_ALL=C comm -23 <(lst "$ref" \( -type f -perm -o=r -o -type d -perm -o=rx \)) \
                             <(lst "$live" \( -type f -perm -o=r -o -type d -perm -o=rx \)))"
[ -z "$missing" ] || { printf '%s\n' "$missing" | head -20 >&2; fail "(c) entries lost world read/traverse access"; }
echo "restore verified: (a) content (b) symlinks (c) access; (d) container health follows"
}
main "$@"
REMOTE

# Restores backup dir $1 (stamp $2) with the checks above, then (d) waits for the
# recreated container to become healthy.
restore() {
  local backup="$1" stamp="$2"
  remote "bash -s -- '$backup' '$SRC' '$SERVICE' '$IMAGE' '$stamp' '$REMOTE_ROOT'$REMOTE_EXCLUDES" <<< "$RESTORE_SCRIPT" || return 1
  wait_healthy || { echo "ROLLBACK CHECK FAILED: (d) $CONTAINER not healthy after restore" >&2; return 1; }
}

release() { # every step returns non-zero on failure; caller rolls back
  rsync "${RSYNC_ARGS[@]}" "$STAGE/src/" "$SSH_HOST:$SRC/" > "$STAGE/rsync.log" || { echo "rsync failed" >&2; return 1; }
  echo "files changed: $(grep -cv '^\.' "$STAGE/rsync.log" || true)"
  remote "cd '$REMOTE_ROOT' && docker compose up -d --build --no-deps '$SERVICE'" || { echo "compose build/up failed" >&2; return 1; }
  wait_healthy || return 1
  verify_public || return 1
}

# DEPLOY_MODE=gate: the same release through the scoped host gate (inferno-deploy v2).
# The tool on the host does backup, rsync, build, health wait, public checks and
# automatic rollback; this side keeps the exact-SHA checks and the public verify.
case "${DEPLOY_MODE:-}" in
  ''|ssh) ;;
  gate)
    # Never source a locally modified helper.
    [[ -z "$(git -C "$ROOT" status --porcelain -- scripts/deploy-gate-lib.sh scripts/deploy-compose-service.sh)" ]] || die "working tree is dirty (scripts/deploy-gate-lib.sh or this script); release only from a clean checkout"
    # shellcheck source=scripts/deploy-gate-lib.sh
    . "$ROOT/scripts/deploy-gate-lib.sh"
    gate_release_tar() {
      STAGE="$(mktemp -d)"
      trap 'rm -r "$STAGE"' EXIT
      git -C "$ROOT" archive --format=tar "$EXPECTED_SHA:$APP_DIR" > "$STAGE/upload.tar"
      gate_tar_has "$STAGE/upload.tar" Dockerfile || die "$APP_DIR has no Dockerfile at $EXPECTED_SHA"
      TAR_SHA="$(gate_prepare "$STAGE/upload.tar")"
    }
    case "$MODE" in
      plan)
        require_sha
        gate_release_tar
        gate service-plan "$SERVICE" "$EXPECTED_SHA" "$TAR_SHA" < "$STAGE/upload.tar"
        ;;
      deploy)
        require_sha
        require_clean_exact_checkout
        gate_release_tar
        gate service-deploy "$SERVICE" "$EXPECTED_SHA" "$TAR_SHA" < "$STAGE/upload.tar"
        verify_public || die "$SERVICE is released but the public checks fail; roll back with: DEPLOY_MODE=gate $0 $SERVICE rollback <stamp>"
        ;;
      verify) verify_public ;;
      rollback)
        stamp="$(gate_stamp "${3:-}")"
        gate service-rollback "$SERVICE" "$stamp"
        echo "run '$SERVICE verify' to check the public state"
        ;;
      status)  gate status ;;
      health)  gate health "$SERVICE" ;;
      logs)    gate logs "$SERVICE" "${3:-200}" ;;
      backups) gate backups "$SERVICE" ;;
      *) die "unknown mode $MODE for DEPLOY_MODE=gate (plan|deploy|verify|rollback|status|health|logs|backups)" ;;
    esac
    exit 0
    ;;
  *) die "DEPLOY_MODE must be unset (direct ssh) or gate" ;;
esac

case "$MODE" in
  plan)
    require_sha
    stage_release
    remote_precheck
    (( FREE >= MIN_FREE_MB )) || echo "WARNING: deploy will refuse: ${FREE}M < ${MIN_FREE_MB}M free"
    echo "--- changes in $SRC for $EXPECTED_SHA (rsync dry run; excluded: ${EXCLUDES[*]})"
    set_rsync_args
    rsync "${RSYNC_ARGS[@]}" --dry-run "$STAGE/src/" "$SSH_HOST:$SRC/" | grep -v '^\.' || true
    ;;
  deploy)
    require_sha
    require_clean_exact_checkout
    stage_release
    remote_precheck
    (( FREE >= MIN_FREE_MB )) || die "only ${FREE}M free on $REMOTE_VOLUME (need $MIN_FREE_MB); free space manually, this script never prunes"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup="$REMOTE_ROOT/backups/$SERVICE-$stamp"
    # mkdir without -p on the final dir: a same-second second run must not overwrite a backup.
    remote "set -e; mkdir -p '$REMOTE_ROOT/backups'; mkdir '$backup'
      tar -C '$REMOTE_ROOT'$TAR_EXCLUDES -czf '$backup/source.tgz' '$SERVICE'
      docker image inspect -f '{{.Id}}' '$IMAGE:latest' > '$backup/image-id'
      docker image tag '$IMAGE:latest' '$IMAGE:rollback-$stamp'"
    echo "backup: $backup  (rollback: scripts/deploy-compose-service.sh $SERVICE rollback $backup)"
    set_rsync_args
    if ! release; then
      echo "release failed; rolling back to $backup" >&2
      restore "$backup" "$stamp" || die "AUTOMATIC ROLLBACK FAILED; run: scripts/deploy-compose-service.sh $SERVICE rollback $backup"
      die "release of $EXPECTED_SHA failed; rolled back to $backup"
    fi
    echo "released: $SERVICE $EXPECTED_SHA"
    ;;
  verify)
    verify_public
    ;;
  rollback)
    backup="${3:-}"
    [[ "$backup" =~ ^$REMOTE_ROOT/backups/$SERVICE-[0-9]{8}T[0-9]{6}Z$ ]] || die "usage: $SERVICE rollback $REMOTE_ROOT/backups/$SERVICE-<YYYYMMDDTHHMMSSZ>"
    restore "$backup" "${backup##*-}" || die "rollback to $backup failed"
    echo "rolled back to $backup; run '$SERVICE verify' to check the public state"
    ;;
  *)
    die "unknown mode $MODE (plan|deploy|verify|rollback)"
    ;;
esac
