#!/usr/bin/env bash
# Benefits Network release helper for shop.ifrunit.tech (v1 path: plain ssh shell on
# the host; via ~/agent-fleet/bin/deploy-shim with SSH_HOST=hetzner-deploy or as owner).
#
#   scripts/deploy-benefits-network.sh status | capacity          # read-only
#   EXPECTED_SHA=<sha> scripts/deploy-benefits-network.sh frontend|backend|all
#   scripts/deploy-benefits-network.sh verify                     # public HTTP only
#   scripts/deploy-benefits-network.sh rollback <backup dir>      # restores a deploy backup
#   scripts/deploy-benefits-network.sh env-vault-v2 <0x address>  # COMMITMENT_VAULT_V2_ADDRESS only
#   scripts/deploy-benefits-network.sh env-restore <env backup dir>
#
# Deploy (T-265): exact clean release commit -> production env names -> no schema
# migration (the release's Prisma migrations must equal the host's) -> fixed 4 GB
# capacity floor (this script NEVER prunes the shared Docker daemon in any mode) ->
# single backend -> backup before the first write (source tar, the image ID each running
# container uses tagged rollback-<UTC>, never what :latest points to; .env.benefits copy
# with mode 600) -> content-only rsync -> compose build/up of only the Benefits services
# -> health -> public checks. Any failure after the backup restores source, env, image
# tags and containers, then verifies the restore (content, symlinks, access, env, running
# image ID, health, public 200); every check fails on its own exit status, so a failing
# or erroring check exits 70. Runbook: docs/BENEFITS_CAPACITY_RUNBOOK.md
#
# Transfers are content-only (T-255/#199): no -t/-a/-g/-o/-p. The v1 deploy user may
# write under /opt/inferno but may not set times, owner, group or mode on root-owned
# inodes. Env writes use `cat >` so the root-owned file keeps inode, owner and mode.
set -euo pipefail

MODE="${1:-frontend}"
ARG="${2:-}"
SSH_HOST="${SSH_HOST:-hetzner}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/inferno}"
LOCAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_APP="$LOCAL_ROOT/apps/benefits-network/"
APP_NAME=benefits-network
SRC="$REMOTE_ROOT/$APP_NAME"
REMOTE_APP="$SRC/"
REMOTE_VOLUME="${REMOTE_VOLUME:-/mnt/HC_Volume_106164848}"
REMOTE_COMPOSE_ENV_FILE="${REMOTE_COMPOSE_ENV_FILE:-$REMOTE_ROOT/.env.benefits}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-36}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
PUBLIC_BASE="https://shop.ifrunit.tech"
MIN_FREE_MB=4096   # fixed floor: frontend builds dropped below 0.5 GB from ~3.5 GB free; never prune
V2_KEY=COMMITMENT_VAULT_V2_ADDRESS

usage() {
  echo "Usage: $0 [frontend|backend|all|status|capacity|verify|rollback <backup>|env-vault-v2 <address>|env-restore <backup>]" >&2
  exit 64
}

case "$MODE" in
  frontend) SERVICES="benefits-frontend" ;;
  backend|all) SERVICES="benefits-backend benefits-frontend" ;;   # backend first: the frontend proxies its API
  status|capacity|verify|rollback|env-vault-v2|env-restore) SERVICES="" ;;
  *) usage ;;
esac

# Values below are interpolated into ssh arguments and remote shell strings; allow
# a plain host alias (no leading '-': ssh would read it as an option) and absolute paths only.
if [[ ! "$SSH_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9._@-]*$ ]]; then
  echo "SSH_HOST must match ^[A-Za-z0-9][A-Za-z0-9._@-]*\$." >&2
  exit 64
fi
for var in REMOTE_ROOT REMOTE_VOLUME REMOTE_COMPOSE_ENV_FILE; do
  if [[ ! "${!var}" =~ ^/[A-Za-z0-9._/@-]+$ ]]; then
    echo "$var must be an absolute path of characters [A-Za-z0-9._/@-]." >&2
    exit 64
  fi
done
for var in HEALTH_ATTEMPTS HEALTH_INTERVAL; do
  if [[ ! "${!var}" =~ ^[0-9]+$ ]]; then
    echo "$var must be an integer." >&2
    exit 64
  fi
done

remote() {
  ssh "$SSH_HOST" "$@"
}

free_mb() {
  remote "df -BM --output=avail '$REMOTE_VOLUME' | tail -1 | tr -dc '0-9'"
}

# Excluded paths match at any depth and are never shipped, deleted, backed up or
# restored (no --delete-excluded): remote-only env and SQLite files stay as they are
# (production data lives in the inferno_benefits_data volume).
EXCLUDES=(node_modules .next dist '*.db' '*.db-journal' '*.db-wal' '*.db-shm' .env .env.local .env.production)
RSYNC_EXCLUDES=()
REMOTE_EXCLUDES=""
TAR_EXCLUDES=""
for x in "${EXCLUDES[@]}"; do
  RSYNC_EXCLUDES+=(--exclude "$x")
  REMOTE_EXCLUDES="$REMOTE_EXCLUDES '$x'"
  TAR_EXCLUDES="$TAR_EXCLUDES --exclude '$x'"
done
# Content only (see header): -r -l keep the tree and symlinks, --checksum skips
# unchanged files without comparing times; --chmod sets the mode of new files only.
RSYNC_ARGS=(-rl --checksum --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r --itemize-changes "${RSYNC_EXCLUDES[@]}")

compose() {
  remote "cd '$REMOTE_ROOT' && docker compose --env-file '$REMOTE_COMPOSE_ENV_FILE' $*"
}

wait_healthy() { # wait_healthy <container>; healthy only (both services define a healthcheck)
  local container="$1"
  remote "
    for i in \$(seq 1 '$HEALTH_ATTEMPTS'); do
      status=\$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' '$container' 2>/dev/null) || status=inspect-failed
      [ \"\$status\" = healthy ] && exit 0
      [ \"\$status\" = unhealthy ] && break
      sleep '$HEALTH_INTERVAL'
    done
    echo \"$container not healthy: \$status\" >&2
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
  check_code 200 "$PUBLIC_BASE/" || failures=$((failures + 1))
  check_code 200 "$PUBLIC_BASE/api/health" || failures=$((failures + 1))
  check_code 200 "$PUBLIC_BASE/api/ready" || failures=$((failures + 1))
  (( failures == 0 )) || { echo "$failures public check(s) failed" >&2; return 1; }
  echo "verified: Benefits public checks pass"
}

post_status() {
  remote "cd '$REMOTE_ROOT' && docker compose --env-file '$REMOTE_COMPOSE_ENV_FILE' ps benefits-backend benefits-frontend && df -h '$REMOTE_VOLUME' && docker system df"
}

backend_replica_count() {
  remote "cd '$REMOTE_ROOT' && docker compose --env-file '$REMOTE_COMPOSE_ENV_FILE' ps -aq benefits-backend | wc -l | tr -d ' '"
}

assert_single_backend() {
  local require_running="${1:-0}"
  local count
  count="$(backend_replica_count)"
  if [[ ! "$count" =~ ^[0-9]+$ ]]; then
    echo "Could not determine Benefits backend replica count." >&2
    exit 1
  fi
  if (( count > 1 )); then
    echo "Refusing operation: found $count Benefits backend replicas; current SQLite topology permits exactly one." >&2
    exit 78
  fi
  if [[ "$require_running" == "1" ]] && (( count != 1 )); then
    echo "Expected exactly one running Benefits backend replica after deploy, found $count." >&2
    exit 1
  fi
}

report_capacity() { # read-only; never prunes
  local free
  free="$(free_mb)"
  if [[ ! "$free" =~ ^[0-9]+$ ]]; then
    echo "Could not determine free disk space for $REMOTE_VOLUME" >&2
    exit 1
  fi
  echo "${free}M free on $REMOTE_VOLUME (deploy floor ${MIN_FREE_MB}M)"
  if (( free < MIN_FREE_MB )); then
    echo "WARNING: ${free}M free on $REMOTE_VOLUME; below the ${MIN_FREE_MB}M deploy floor, so deploys refuse." >&2
    echo "This script never prunes; free space or expand the volume per docs/BENEFITS_CAPACITY_RUNBOOK.md." >&2
  fi
}

if [[ "$MODE" == "status" ]]; then
  assert_single_backend
  post_status
  exit 0
fi

if [[ "$MODE" == "capacity" ]]; then
  report_capacity
  assert_single_backend
  post_status
  exit 0
fi

if [[ "$MODE" == "verify" ]]; then
  verify_public
  exit $?
fi

# Runs on the host via `bash -s -- <backup> <src> <stamp> <remote root> <env file>
# <excludes...>`: restores the source dir, .env.benefits and the rollback image tags
# of the backup, recreates the backed-up services without building, then proves the
# restore is complete, not only content-identical. Excluded files are left as they
# are and are not compared. Any failed step or check exits non-zero. The body is one
# function, so bash has read all of it before any command could consume stdin.
IFS= read -r -d '' RESTORE_SCRIPT <<'REMOTE' || true
set -euo pipefail
main() {
backup="$1" src="$2" stamp="$3" root="$4" envfile="$5"
shift 5
fail() { echo "ROLLBACK CHECK FAILED: $*" >&2; exit 1; }
rx=() prune=()
for x in "$@"; do
  rx+=(--exclude "$x")
  [ ${#prune[@]} -eq 0 ] || prune+=(-o)
  prune+=(-name "$x")
done
[ ${#prune[@]} -eq 0 ] || prune=(\( "${prune[@]}" \) -prune -o)
test -f "$backup/source.tgz" || fail "$backup/source.tgz missing"
test -f "$backup/env.benefits" || fail "$backup/env.benefits missing"
test -f "$backup/services" || fail "$backup/services missing"
services=()
while IFS= read -r s; do
  case "$s" in
    benefits-backend|benefits-frontend) services+=("$s") ;;
    *) fail "unexpected service '$s' in $backup/services" ;;
  esac
done < "$backup/services"
[ ${#services[@]} -gt 0 ] || fail "$backup/services is empty"
for s in "${services[@]}"; do
  test -s "$backup/image-id-$s" || fail "$backup/image-id-$s missing"
  docker image inspect "inferno-$s:rollback-$stamp" >/dev/null || fail "image inferno-$s:rollback-$stamp missing"
done
t="$(mktemp -d)"
trap 'rm -r "$t"' EXIT
tar -C "$t" -xpzf "$backup/source.tgz" || fail "tar exited $?"
ref="$t/benefits-network" live="$src"
test -d "$ref" || fail "backup holds no benefits-network tree"
# Content only, like deploy: the v1 user cannot set times/owner/group/mode on root-owned inodes.
rsync -rl --checksum --delete "${rx[@]}" "$ref/" "$live/" || fail "rsync exited $?"
# cat keeps inode, owner and mode of the root-owned env file; values are never printed.
cmp -s "$backup/env.benefits" "$envfile" || cat "$backup/env.benefits" > "$envfile" || fail "env restore write failed"
for s in "${services[@]}"; do
  docker image tag "inferno-$s:rollback-$stamp" "inferno-$s:latest" || fail "docker image tag of $s exited $?"
done
(cd "$root" && docker compose --env-file "$envfile" up -d --no-build --no-deps "${services[@]}") || fail "compose up exited $?"
# Every check writes its evidence to a file first and fails on its own exit status:
# no check reads through a process substitution or an unchecked pipeline, so a check
# command that errors fails the restore instead of comparing two empty lists.
snap() { # snap <name> <dir> <find predicates...> -> sorted listing in $t/<name>
  local name="$1" d="$2"
  shift 2
  (cd "$d" && find . ${prune[@]+"${prune[@]}"} "$@" -print) > "$t/$name.raw" || fail "listing $name: find exited $?"
  LC_ALL=C sort "$t/$name.raw" > "$t/$name" || fail "listing $name: sort exited $?"
}
linkmap() { # linkmap <dir> <listing> <out>: "path -> target" per symlink
  local p target
  : > "$3"
  while IFS= read -r p; do
    target="$(readlink "$1/$p")" || fail "(b) readlink $p exited $?"
    printf '%s -> %s\n' "$p" "$target" >> "$3" || fail "(b) write failed"
  done < "$2"
}
# (g) image: every restored container runs exactly the image ID that ran at backup time
for s in "${services[@]}"; do
  state="$(docker inspect -f '{{.State.Running}} {{.Image}}' "inferno-$s")" || fail "(g) docker inspect inferno-$s exited $?"
  want="$(cat "$backup/image-id-$s")" || fail "(g) cannot read $backup/image-id-$s"
  [ "$state" = "true $want" ] || fail "(g) inferno-$s is '$state', expected 'true $want'"
done
# (b) symlinks: same paths and targets (checked first, so a link change is named as such)
snap ref.l "$ref" -type l
snap live.l "$live" -type l
linkmap "$ref" "$t/ref.l" "$t/ref.links"
linkmap "$live" "$t/live.l" "$t/live.links"
diff "$t/ref.links" "$t/live.links" >&2 || fail "(b) symlinks differ from the backup"
# (a) content: same dirs and files (excludes pruned) and every file byte-identical
snap ref.d "$ref" -type d
snap live.d "$live" -type d
snap ref.f "$ref" -type f
snap live.f "$live" -type f
[ -s "$t/ref.f" ] || fail "(a) the backup tree lists no files"
diff "$t/ref.d" "$t/live.d" >&2 || fail "(a) directories differ from the backup"
diff "$t/ref.f" "$t/live.f" >&2 || fail "(a) files differ from the backup"
changed=0
while IFS= read -r p; do
  cmp -s "$ref/$p" "$live/$p" || { echo "differs: $p" >&2; changed=1; }   # a cmp error (2) counts as differs
done < "$t/ref.f"
[ "$changed" = 0 ] || fail "(a) content differs from the backup"
# (c) access: nothing the backup let others read (files o+r, dirs o+rx) lost it
snap ref.o "$ref" \( -type f -perm -o=r -o -type d -perm -o=rx \)
snap live.o "$live" \( -type f -perm -o=r -o -type d -perm -o=rx \)
LC_ALL=C comm -23 "$t/ref.o" "$t/live.o" > "$t/lost.o" || fail "(c) comm exited $?"
[ ! -s "$t/lost.o" ] || { head -20 "$t/lost.o" >&2; fail "(c) entries lost world read/traverse access"; }
# (e) env: byte-identical to the backup
cmp -s "$backup/env.benefits" "$envfile" || fail "(e) $envfile differs from the backup"
echo "restore verified: (a) content (b) symlinks (c) access (e) env (g) image; (d) health and (f) public checks follow"
}
main "$@"
REMOTE

# Restores deploy backup $1 (stamp $2) with the checks above, then (d) waits for each
# recreated container to become healthy and (f) requires the public checks to pass.
restore() {
  local backup="$1" stamp="$2" services s
  remote "bash -s -- '$backup' '$SRC' '$stamp' '$REMOTE_ROOT' '$REMOTE_COMPOSE_ENV_FILE'$REMOTE_EXCLUDES" <<< "$RESTORE_SCRIPT" || return 1
  services="$(remote "cat '$backup/services'")" || return 1
  for s in $services; do
    [[ "$s" == benefits-backend || "$s" == benefits-frontend ]] || { echo "ROLLBACK CHECK FAILED: unexpected service $s" >&2; return 1; }
    wait_healthy "inferno-$s" || { echo "ROLLBACK CHECK FAILED: (d) inferno-$s not healthy after restore" >&2; return 1; }
  done
  verify_public || { echo "ROLLBACK CHECK FAILED: (f) public checks fail after restore" >&2; return 1; }
  echo "rollback verified: (a)-(g) source, symlinks, access, env, health, public 200, image"
}

if [[ "$MODE" == "rollback" ]]; then
  [[ "$ARG" =~ ^$REMOTE_ROOT/backups/$APP_NAME-[0-9]{8}T[0-9]{6}Z$ ]] || {
    echo "usage: $0 rollback $REMOTE_ROOT/backups/$APP_NAME-<YYYYMMDDTHHMMSSZ>" >&2
    exit 64
  }
  if ! restore "$ARG" "${ARG##*-}"; then
    echo "rollback to $ARG failed" >&2
    exit 1
  fi
  echo "rolled back to $ARG"
  exit 0
fi

# Runs on the host via `bash -s -- <env file> <backup dir> <address>`. Edits only the
# COMMITMENT_VAULT_V2_ADDRESS line: backup first, candidate verified to differ from
# the backup in exactly that one line, content-only write, written bytes and inode,
# mode and owner verified, automatic restore on any write mismatch. No env value is
# extracted or printed. Exit 78: refused before any write; 1: write failed, backup
# restored and verified; 70: restore failed too.
IFS= read -r -d '' ENV_EDIT_SCRIPT <<'REMOTE' || true
set -euo pipefail
main() {
f="$1" backup="$2" addr="$3" key=COMMITMENT_VAULT_V2_ADDRESS
refuse() { echo "ENV EDIT REFUSED: $*" >&2; exit 78; }
[[ "$addr" =~ ^0x[0-9a-fA-F]{40}$ ]] || refuse "address must be 0x + 40 hex characters"
{ test -f "$f" && test -r "$f" && test -w "$f"; } || refuse "$f is not a file this user can read and write"
n="$(grep -c "^$key=" "$f" || true)"
[ "$n" -le 1 ] || refuse "$f holds $n $key lines; fix by hand"
if [ "$n" = 1 ] && grep -qx "$key=$addr" "$f"; then
  echo "env: $key already holds the requested address; nothing written"
  exit 0
fi
meta() { ls -lin "$1" | awk '{print $1, $2, $4, $5}'; }   # inode mode uid gid
before="$(meta "$f")"
umask 077
mkdir -p "$(dirname "$backup")"
mkdir "$backup"
cp "$f" "$backup/env.benefits"
chmod 600 "$backup/env.benefits"
cmp -s "$f" "$backup/env.benefits" || refuse "backup copy differs from $f"
new="$backup/env.new"
awk -v k="$key" -v v="$addr" 'index($0, k "=") == 1 { print k "=" v; d = 1; next } { print } END { if (!d) print k "=" v }' \
  "$backup/env.benefits" > "$new"
chmod 600 "$new"
# The candidate must equal the backup except for the one key line.
diff <(grep -v "^$key=" "$backup/env.benefits" || true) <(grep -v "^$key=" "$new" || true) >/dev/null \
  || refuse "(1) a line other than $key would change"
[ "$(grep -c "^$key=" "$new" || true)" = 1 ] && grep -qx "$key=$addr" "$new" || refuse "(2) $key line is not the requested value"
old_lines="$(grep -c '' "$backup/env.benefits" || true)"
new_lines="$(grep -c '' "$new" || true)"
[ "$new_lines" = $((old_lines + 1 - n)) ] || refuse "(3) line count would change by more than the key line"
restore_env() {
  { cat "$backup/env.benefits" > "$f" && cmp -s "$backup/env.benefits" "$f"; } || {
    echo "ENV RESTORE FAILED: restore $f from $backup/env.benefits by hand" >&2; exit 70; }
  echo "ENV EDIT FAILED: $*; $f restored from the backup and verified" >&2
  exit 1
}
cat "$new" > "$f" || restore_env "write failed"
cmp -s "$new" "$f" || restore_env "(4) written bytes differ from the verified candidate"
[ "$(meta "$f")" = "$before" ] || restore_env "(5) inode, mode or owner changed"
rm "$new"
echo "env: $key set; exactly one line changed; inode, mode and owner kept"
echo "backup: $backup/env.benefits (mode 600)"
}
main "$@"
REMOTE

if [[ "$MODE" == "env-vault-v2" ]]; then
  [[ "$ARG" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "usage: $0 env-vault-v2 <0x + 40 hex address>" >&2; exit 64; }
  [[ "$ARG" =~ ^0x0{40}$ ]] && { echo "Refusing the zero address for $V2_KEY." >&2; exit 64; }
  env_backup="$REMOTE_ROOT/backups/benefits-env-$(date -u +%Y%m%dT%H%M%SZ)"
  set +e
  remote "bash -s -- '$REMOTE_COMPOSE_ENV_FILE' '$env_backup' '$ARG'" <<< "$ENV_EDIT_SCRIPT"
  status=$?
  set -e
  if (( status == 0 )); then
    echo "No container was recreated: run a reviewed backend deploy to apply, or undo with:"
    echo "  $0 env-restore $env_backup"
  fi
  exit "$status"
fi

if [[ "$MODE" == "env-restore" ]]; then
  [[ "$ARG" =~ ^$REMOTE_ROOT/backups/benefits-env-[0-9]{8}T[0-9]{6}Z$ ]] || {
    echo "usage: $0 env-restore $REMOTE_ROOT/backups/benefits-env-<YYYYMMDDTHHMMSSZ>" >&2
    exit 64
  }
  remote "set -e; test -f '$ARG/env.benefits'
    cat '$ARG/env.benefits' > '$REMOTE_COMPOSE_ENV_FILE'
    cmp -s '$ARG/env.benefits' '$REMOTE_COMPOSE_ENV_FILE'" || { echo "env restore from $ARG failed" >&2; exit 1; }
  echo "env restored from $ARG and verified; run a reviewed backend deploy to apply"
  exit 0
fi

# Deploy modes ship the local working tree; bind it to one reviewed commit.
require_exact_release() {
  if [[ ! "${EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Set EXPECTED_SHA to the full 40-char release commit before $MODE deploys." >&2
    exit 64
  fi
  if [[ "$(git -C "$LOCAL_ROOT" rev-parse HEAD)" != "$EXPECTED_SHA" ]]; then
    echo "Refusing deploy: HEAD is not $EXPECTED_SHA." >&2
    exit 65
  fi
  if [[ -n "$(git -C "$LOCAL_ROOT" status --porcelain -- apps/benefits-network scripts/deploy-benefits-network.sh)" ]]; then
    echo "Refusing deploy: apps/benefits-network has uncommitted or untracked changes." >&2
    exit 65
  fi
  # git status hides local edits behind assume-unchanged/skip-worktree bits.
  if git -C "$LOCAL_APP" ls-files -v | grep -q '^[a-zS]'; then
    echo "Refusing deploy: apps/benefits-network has assume-unchanged or skip-worktree files." >&2
    exit 65
  fi
  # git status also hides ignored files. Ask rsync, with the excludes the upload uses,
  # which files it would upload; every one must be a tracked file of the release commit.
  local dry uploads extra
  dry="$(mktemp -d)"
  uploads="$(rsync -a --dry-run --out-format='%n' "${RSYNC_EXCLUDES[@]}" "$LOCAL_APP" "$dry/")" || {
    rmdir "$dry"
    echo "Refusing deploy: could not list the files the upload would send." >&2
    exit 65
  }
  rmdir "$dry"
  extra="$(LC_ALL=C comm -23 <(grep -v '/$' <<< "$uploads" | LC_ALL=C sort) \
    <(git -C "$LOCAL_APP" -c core.quotePath=false ls-files | LC_ALL=C sort))"
  if [[ -n "$extra" ]]; then
    echo "Refusing deploy: apps/benefits-network holds files outside $EXPECTED_SHA that would be uploaded:" >&2
    sed 's/^/  /' <<< "$extra" >&2
    echo "Release from a fresh checkout of the release commit." >&2
    exit 65
  fi
}

# The backend refuses to start in production without these values (config.ts,
# sellerAuthConfigPolicy.ts, adminSecretPolicy.ts). Check names and the admin-secret
# length on the host before anything is built; never print a value.
REQUIRED_ENV_KEYS="SELLER_AUTH_DOMAIN CHAIN_ID RPC_URL IFR_TOKEN_ADDRESS IFRLOCK_ADDRESS COMMITMENT_VAULT_ADDRESS ADMIN_SECRET"
require_production_env() {
  local missing
  missing="$(remote "f='$REMOTE_COMPOSE_ENV_FILE'
    test -r \"\$f\" || { echo UNREADABLE; exit 0; }
    for k in $REQUIRED_ENV_KEYS; do grep -q \"^\$k=.\" \"\$f\" || printf '%s ' \"\$k\"; done
    s=\$(grep '^ADMIN_SECRET=' \"\$f\" | head -1 | cut -d= -f2-)
    [ \"\${#s}\" -ge 32 ] || printf 'ADMIN_SECRET(<32) '")"
  if [[ -n "$missing" ]]; then
    echo "Refusing deploy: $REMOTE_COMPOSE_ENV_FILE lacks production settings: $missing" >&2
    echo "Add them on the host (values never in chat or logs), then re-run." >&2
    exit 78
  fi
}

# The backend runs `prisma migrate deploy` on start, and an image retag cannot undo a
# schema change. This path therefore ships only releases whose migrations equal the
# host's, file for file and byte for byte; anything else is refused before any write.
DIGEST_CMD='find migrations -type f | LC_ALL=C sort | while IFS= read -r f; do if command -v sha256sum >/dev/null 2>&1; then sha256sum "$f"; else shasum -a 256 "$f"; fi; done'
require_no_schema_migration() {
  local release live changed
  release="$(cd "$LOCAL_APP/backend/prisma" && bash -c "$DIGEST_CMD")"
  live="$(remote "cd '$SRC/backend/prisma' && $DIGEST_CMD")" || live="unreadable"
  [[ -n "$release" ]] || { echo "Refusing deploy: no Prisma migrations in the release." >&2; exit 78; }
  if [[ "$release" != "$live" ]]; then
    changed="$(LC_ALL=C comm -3 <(LC_ALL=C sort <<< "$release") <(LC_ALL=C sort <<< "$live") | awk '{print $NF}' | LC_ALL=C sort -u | head -20)"
    echo "Refusing deploy: Prisma migrations of $EXPECTED_SHA differ from $SRC/backend/prisma:" >&2
    sed 's/^/  /' <<< "$changed" >&2
    echo "This path performs no schema migration; a migration needs its own reviewed, backed-up release." >&2
    exit 78
  fi
}

require_capacity() {
  local free
  free="$(free_mb)"
  if [[ ! "$free" =~ ^[0-9]+$ ]]; then
    echo "Could not determine free disk space for $REMOTE_VOLUME" >&2
    exit 1
  fi
  if (( free < MIN_FREE_MB )); then
    echo "Refusing deploy: only ${free}M free on $REMOTE_VOLUME (need ${MIN_FREE_MB}M)." >&2
    echo "This script never prunes the shared Docker daemon; free space by hand per docs/BENEFITS_CAPACITY_RUNBOOK.md." >&2
    exit 75
  fi
  echo "${free}M free on $REMOTE_VOLUME"
}

# The backup must hold what actually runs, not what :latest points to (a build without
# `up`, or a manual retag, moves :latest away from the running container).
require_running_images() {
  local s state
  for s in $SERVICES; do
    state="$(remote "docker inspect -f '{{.State.Running}} {{.Image}}' 'inferno-$s'")" || state="not found"
    if [[ ! "$state" =~ ^true\ sha256:[A-Za-z0-9._-]+$ ]]; then
      echo "Refusing deploy: container inferno-$s is not running ($state); nothing to roll back to." >&2
      exit 78
    fi
  done
}

release() { # every step returns non-zero on failure; the caller restores
  local s count
  rsync "${RSYNC_ARGS[@]}" "$LOCAL_APP" "$SSH_HOST:$REMOTE_APP" > "$RSYNC_LOG" || { echo "rsync failed" >&2; return 1; }
  echo "files changed: $(grep -cv '^\.' "$RSYNC_LOG" || true)"
  remote "printf '%s\n' '$EXPECTED_SHA' > '$SRC/RELEASE_SHA'" || { echo "RELEASE_SHA write failed" >&2; return 1; }
  for s in $SERVICES; do
    compose "up -d --build --no-deps $s" || { echo "compose build/up of $s failed" >&2; return 1; }
    wait_healthy "inferno-$s" || return 1
  done
  count="$(backend_replica_count)" || return 1
  [[ "$count" == 1 ]] || { echo "expected exactly one Benefits backend replica after deploy, found $count" >&2; return 1; }
  verify_public || return 1
}

require_exact_release
require_production_env
require_no_schema_migration
require_capacity
assert_single_backend
require_running_images

RSYNC_LOG="$(mktemp)"
trap 'rm -f "$RSYNC_LOG"' EXIT
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$REMOTE_ROOT/backups/$APP_NAME-$stamp"
# mkdir without -p on the final dir: a same-second second run must not overwrite a backup.
remote "set -e; umask 077; mkdir -p '$REMOTE_ROOT/backups'; mkdir '$backup'
  tar -C '$REMOTE_ROOT'$TAR_EXCLUDES -czf '$backup/source.tgz' '$APP_NAME'
  cp '$REMOTE_COMPOSE_ENV_FILE' '$backup/env.benefits'
  chmod 600 '$backup/env.benefits'
  cmp -s '$REMOTE_COMPOSE_ENV_FILE' '$backup/env.benefits'
  printf '%s\n' $SERVICES > '$backup/services'
  for s in $SERVICES; do
    # the image the running container uses, never whatever :latest points to now
    state=\$(docker inspect -f '{{.State.Running}} {{.Image}}' \"inferno-\$s\")
    case \"\$state\" in 'true sha256:'*) ;; *) echo \"inferno-\$s is not running: \$state\" >&2; exit 1 ;; esac
    id=\${state#true }
    printf '%s\n' \"\$id\" > \"$backup/image-id-\$s\"
    docker image tag \"\$id\" \"inferno-\$s:rollback-$stamp\"
    [ \"\$(docker image inspect -f '{{.Id}}' \"inferno-\$s:rollback-$stamp\")\" = \"\$id\" ] || { echo \"rollback tag of \$s is not \$id\" >&2; exit 1; }
  done" || { echo "Backup to $backup failed; nothing was released." >&2; exit 1; }
echo "backup: $backup  (rollback: scripts/deploy-benefits-network.sh rollback $backup)"

if ! release; then
  echo "release failed; restoring $backup" >&2
  if ! restore "$backup" "$stamp"; then
    echo "AUTOMATIC ROLLBACK FAILED; run: scripts/deploy-benefits-network.sh rollback $backup" >&2
    exit 70
  fi
  echo "release of $EXPECTED_SHA failed; rolled back to $backup" >&2
  exit 1
fi

echo "released: $SERVICES $EXPECTED_SHA"
report_capacity
post_status
