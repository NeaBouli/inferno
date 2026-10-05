#!/usr/bin/env bash
# T-265 release-guard tests for the bounded no-prune Benefits release path in
# scripts/deploy-benefits-network.sh. A fake `ssh` runs each remote command for real
# against a temporary copy of /opt/inferno (mkdir, tar, cp, rsync, cat, cmp); docker,
# df and curl are fakes that keep image, tag and container state in files. Nothing
# leaves this machine.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAKES="$TMP/bin"
LOG="$TMP/calls.log"
ALL_LOG="$TMP/all-calls.log"            # every call of the whole suite, for "never prunes"
REMOTE="$TMP/remote"                     # stands in for the host filesystem root
HOST="$REMOTE/opt/inferno"
APPDIR="$HOST/benefits-network"
ENVF="$HOST/.env.benefits"
DOCKER_STATE="$TMP/docker"
REAL_RSYNC="$(command -v rsync)"
REAL_FIND="$(command -v find)"
REAL_READLINK="$(command -v readlink)"
SCRIPT=scripts/deploy-benefits-network.sh
mkdir -p "$FAKES" "$HOST/backups" "$DOCKER_STATE/images"
: > "$LOG"
: > "$ALL_LOG"

# Clone the current commit and overlay the script under test, so the guards run
# against a real, clean exact-SHA checkout even before these edits are committed.
git clone -q --local "$ROOT" "$TMP/repo"
cp "$ROOT/$SCRIPT" "$TMP/repo/$SCRIPT"
git -C "$TMP/repo" add -A scripts
git -C "$TMP/repo" -c user.name=test -c user.email=test@example.invalid commit -qm "test overlay" --allow-empty
REPO="$TMP/repo"
SHA="$(git -C "$REPO" rev-parse HEAD)"
C="$REPO/$SCRIPT"

# Host layout as found read-only on 2026-10-05: the release tree next to the compose
# file and the root-owned .env.benefits (mode 600). The live tree is an older release:
# a stale file, a symlink and an edited README; remote-only excluded files must survive.
echo "services: {}" > "$HOST/docker-compose.yml"
git -C "$REPO" archive "$SHA" apps/benefits-network | tar -x -C "$TMP"
mv "$TMP/apps/benefits-network" "$APPDIR"
echo "old code" > "$APPDIR/frontend/src/old-only-on-host.js"
chmod 644 "$APPDIR/frontend/src/old-only-on-host.js"         # world-readable for the build
ln -s old-only-on-host.js "$APPDIR/frontend/src/current-link"  # restore must keep symlinks as links
echo "old release note" >> "$APPDIR/frontend/README.md"
printf '%s\n' 0000000000000000000000000000000000000old > "$APPDIR/RELEASE_SHA"
mkdir -p "$APPDIR/frontend/node_modules/pkg" "$APPDIR/frontend/.next/cache" "$APPDIR/backend/dist"
echo "SECRET_PLACEHOLDER=1" > "$APPDIR/backend/.env"; chmod 600 "$APPDIR/backend/.env"
echo "LOCAL=1" > "$APPDIR/frontend/.env.local"
echo "sqlite" > "$APPDIR/backend/app.db"
echo "dep" > "$APPDIR/frontend/node_modules/pkg/index.js"
ln -s ../pkg/index.js "$APPDIR/frontend/node_modules/pkg/bin-link"
echo "cache" > "$APPDIR/frontend/.next/cache/x"
echo "bundle" > "$APPDIR/backend/dist/index.js"
# Production env contract (placeholder values, never real secrets).
write_env() {
  cat > "$ENVF" <<'ENV'
SELLER_AUTH_DOMAIN=shop.example.test
CHAIN_ID=1
RPC_URL=https://rpc.example.test/placeholder-key
IFR_TOKEN_ADDRESS=0x0000000000000000000000000000000000000001
IFRLOCK_ADDRESS=0x0000000000000000000000000000000000000002
COMMITMENT_VAULT_ADDRESS=0x0000000000000000000000000000000000000003
# COMMITMENT_VAULT_V2_ADDRESS=comment-must-stay
COMMITMENT_VAULT_V2_ADDRESS=0x00000000000000000000000000000000000000a4
ADMIN_SECRET=test-only-admin-secret-0123456789abcdef
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=placeholder-project
ENV
  chmod 600 "$ENVF"
}
write_env
for svc in benefits-frontend benefits-backend; do
  echo "sha256:old-$svc" > "$DOCKER_STATE/images/inferno-$svc:latest"
  echo "sha256:old-$svc" > "$DOCKER_STATE/running-inferno-$svc"
done
cp -R "$HOST" "$TMP/host.before"

cat > "$FAKES/ssh" <<'EOF'
#!/usr/bin/env bash
shift
printf 'ssh %s\n' "$*" >> "$LOG"
cmd="${*//\/opt\/inferno/$REMOTE/opt/inferno}"
exec bash -c "$cmd"
EOF
cat > "$FAKES/rsync" <<'EOF'
#!/usr/bin/env bash
printf 'rsync %s\n' "$*" >> "$LOG"
[[ "${RSYNC_FAIL:-0}" == 1 && "$*" == *--itemize-changes* && "$*" != *--dry-run* ]] && exit 23
# The v1 deploy user (T-255) may write under /opt/inferno but may not set times,
# owner, group or mode on root-owned inodes: any metadata flag on a host write fails
# like production did on 2026-10-05 (rsync exit 23).
dest="${@: -1}"
if [[ "$dest" == */opt/inferno* && "$*" != *--dry-run* ]]; then
  for a in "$@"; do
    if [[ "$a" =~ ^-[A-Za-z]*[tagopAXUN] && "$a" != --* ]] || [[ "$a" =~ ^--(archive|times|perms|owner|group|acls|xattrs|atimes|crtimes)$ ]]; then
      echo "rsync: [generator] failed to set times on \"$dest\": Operation not permitted (1) [fixture: v1 user, flag $a]" >&2
      exit 23
    fi
  done
fi
args=()
for a in "$@"; do
  a="${a#benefits-test-host:}"
  [[ "$a" == /opt/inferno* ]] && a="$REMOTE$a"   # remote paths only; local ones pass through
  args+=("$a")
done
restore_sync=0
[[ "$dest" == */opt/inferno/benefits-network* && "$*" != *--itemize-changes* && "$*" != *--dry-run* ]] && restore_sync=1
[[ "${RESTORE_RSYNC_FAIL:-0}" == 1 && "$restore_sync" == 1 ]] && exit 23
"$REAL_RSYNC" "${args[@]}" || exit $?
# TAMPER=content|link|perm corrupts the live tree right after a restore sync, so the
# restore checks must catch it.
if [[ -n "${TAMPER:-}" && "$restore_sync" == 1 ]]; then
  d="${args[${#args[@]}-1]}"
  case "$TAMPER" in
    content) echo tampered >> "$d/frontend/src/old-only-on-host.js" ;;
    link)    ln -sfn ../package.json "$d/frontend/src/current-link" ;;
    perm)    chmod o-r "$d/frontend/src/old-only-on-host.js" ;;
  esac
fi
EOF
# docker: images are files named <repo:tag> holding an id; a container runs the id its
# image had at `compose up`. A build yields sha256:bad when BAD_BUILD names the service
# (or is 1), and a container running sha256:bad reports unhealthy. Prunes are logged and
# succeed, so any prune call shows up in the log.
cat > "$FAKES/docker" <<'EOF'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$LOG"
img="$DOCKER_STATE/images"
resolve() { # a tag, or an image ID that a tag or a container still holds
  if [[ -f "$img/$1" ]]; then cat "$img/$1"; return; fi
  if [[ "$1" == sha256:* ]] && cat "$img"/* "$DOCKER_STATE"/running-* 2>/dev/null | grep -qx -- "$1"; then echo "$1"; return; fi
  echo "No such image: $1" >&2; return 1
}
case "$*" in
  *prune*) exit 0 ;;
  "image inspect -f {{.Id}} "*|"image inspect "*) resolve "${@: -1}" ;;
  "image tag "*) id="$(resolve "$3")" || exit 1; echo "$id" > "$img/$4" ;;
  "inspect -f {{.State.Running}} {{.Image}} "*)
    c="${@: -1}"
    [[ -f "$DOCKER_STATE/running-$c" ]] || { echo "Error: No such object: $c" >&2; exit 1; }
    echo "true $(cat "$DOCKER_STATE/running-$c")" ;;
  "compose --env-file "*" up -d --build --no-deps "*)
    svc="${@: -1}"
    [[ "${BUILD_FAIL:-}" == 1 || "${BUILD_FAIL:-}" == "$svc" ]] && exit 17
    if [[ "${BAD_BUILD:-}" == 1 || "${BAD_BUILD:-}" == "$svc" ]]; then echo sha256:bad > "$img/inferno-$svc:latest"
    else echo "sha256:new-$(cat "$REMOTE/opt/inferno/benefits-network/RELEASE_SHA")" > "$img/inferno-$svc:latest"; fi
    cp "$img/inferno-$svc:latest" "$DOCKER_STATE/running-inferno-$svc" ;;
  "compose --env-file "*" up -d --no-build --no-deps "*)
    shift 7
    [[ "${RESTORE_UP_NOOP:-0}" == 1 ]] && exit 0     # compose "succeeds" but recreates nothing
    for svc in "$@"; do cp "$img/inferno-$svc:latest" "$DOCKER_STATE/running-inferno-$svc"; done ;;
  "compose --env-file "*" ps -aq benefits-backend")
    for _ in $(seq 1 "${BACKEND_COUNT:-1}"); do echo abc123; done ;;
  "compose --env-file "*" ps "*) echo "inferno-benefits-backend running" ;;
  "system df") echo "TYPE TOTAL" ;;
  inspect*)
    c="${@: -1}"
    [[ "${INSPECT_FAIL:-0}" == 1 ]] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
    [[ -f "$DOCKER_STATE/running-$c" ]] || exit 1
    if grep -qx 'sha256:bad' "$DOCKER_STATE/running-$c"; then echo unhealthy; else echo healthy; fi ;;
  *) echo "unexpected docker call: $*" >&2; exit 99 ;;
esac
EOF
cat > "$FAKES/date" <<'EOF_DATE'
#!/usr/bin/env bash
if [[ "$*" == "-u +%Y%m%dT%H%M%SZ" ]]; then
  n=$(( $(cat "$REMOTE/../clock" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$REMOTE/../clock"
  printf '20260101T00%04dZ\n' "$n"
else
  exec /bin/date "$@"
fi
EOF_DATE
cat > "$FAKES/df" <<'EOF'
#!/usr/bin/env bash
printf 'Avail\n%sM\n' "${FREE_MB:-9000}"
EOF
# curl: shop URLs answer 200 unless PUBLIC_BAD=1 and a new frontend runs (a broken
# release that is container-healthy), or PUBLIC_DOWN=1.
cat > "$FAKES/curl" <<'EOF'
#!/usr/bin/env bash
url="${@: -1}"; url="${url%%\?*}"
printf 'curl %s\n' "$url" >> "$LOG"
case "$url" in
  https://shop.ifrunit.tech/|https://shop.ifrunit.tech/api/health|https://shop.ifrunit.tech/api/ready)
    if [[ "${PUBLIC_DOWN:-0}" == 1 ]] || { [[ "${PUBLIC_BAD:-0}" == 1 ]] && grep -q '^sha256:new-' "$DOCKER_STATE/running-inferno-benefits-frontend"; }; then
      printf '502'
    else
      printf '200'
    fi ;;
  *) printf '000'; exit 7 ;;
esac
EOF
# cat: ENV_WRITE_TAMPER=1 corrupts the candidate env while it is written to the live file.
cat > "$FAKES/cat" <<'EOF'
#!/usr/bin/env bash
if [[ "${ENV_WRITE_TAMPER:-0}" == 1 && "${1:-}" == */env.new ]]; then /bin/cat "$1"; echo "INJECTED=1"; exit 0; fi
exec /bin/cat "$@"
EOF
# find/readlink: FIND_FAIL=1 / READLINK_FAIL=1 make the restore's listing and link
# checks error out without output, so a swallowed error would compare empty lists.
cat > "$FAKES/find" <<'EOF'
#!/usr/bin/env bash
[[ "${FIND_FAIL:-0}" == 1 && "${@: -1}" == -print ]] && { echo "find: fixture I/O error" >&2; exit 1; }
exec "$REAL_FIND" "$@"
EOF
cat > "$FAKES/readlink" <<'EOF'
#!/usr/bin/env bash
[[ "${READLINK_FAIL:-0}" == 1 ]] && { echo "readlink: fixture I/O error" >&2; exit 1; }
exec "$REAL_READLINK" "$@"
EOF
chmod +x "$FAKES"/*

run() { # run <expected-exit> <cmd...>
  local expected="$1"; shift
  set +e
  OUT="$(PATH="$FAKES:$PATH" LOG="$LOG" REMOTE="$REMOTE" REAL_RSYNC="$REAL_RSYNC" REAL_FIND="$REAL_FIND" REAL_READLINK="$REAL_READLINK" DOCKER_STATE="$DOCKER_STATE" \
    SSH_HOST=benefits-test-host HEALTH_INTERVAL="${HEALTH_INTERVAL:-0}" HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-3}" "$@" 2>&1)"
  local status=$?
  set -e
  cat "$LOG" >> "$ALL_LOG"
  if [[ "$status" != "$expected" ]]; then
    echo "FAIL: expected exit $expected, got $status: $*" >&2
    echo "$OUT" >&2
    exit 1
  fi
}
fail() { echo "FAIL: $*" >&2; echo "$OUT" >&2; exit 1; }
assert_out() { grep -Fq -- "$1" <<< "$OUT" || fail "output lacks: $1"; }
refute_out() { if grep -Fq -- "$1" <<< "$OUT"; then fail "output has: $1"; fi; }
assert_log() { grep -Fq -- "$1" "$LOG" || { echo "FAIL: log lacks: $1" >&2; cat "$LOG" >&2; exit 1; }; }
refute_log() { if grep -Fq -- "$1" "$LOG"; then echo "FAIL: log has: $1" >&2; cat "$LOG" >&2; exit 1; fi; }
assert_content_only_rsync() {
  local line a
  while IFS= read -r line; do
    [[ "$line" == *--dry-run* || "$line" != */opt/inferno* ]] && continue
    for a in ${line#rsync }; do
      if [[ "$a" =~ ^-[A-Za-z]*[tagopAXUN] && "$a" != --* ]] || [[ "$a" =~ ^--(archive|times|perms|owner|group|acls|xattrs|atimes|crtimes)$ ]]; then
        echo "FAIL: host-writing rsync carries metadata flag $a: $line" >&2; exit 1
      fi
    done
  done < <(grep '^rsync ' "$LOG" || true)
}
line_of() { grep -Fn -- "$1" "$LOG" | head -1 | cut -d: -f1; }
same_host() { diff -r "$TMP/host.before/$1" "$HOST/$1" >/dev/null || fail "$HOST/$1 differs from the pre-release host"; }
image() { cat "$DOCKER_STATE/images/inferno-$1:latest"; }
running() { cat "$DOCKER_STATE/running-inferno-$1"; }
last_backup() { ls -d "$HOST"/backups/benefits-network-* | tail -1; }
assert_rolled_back() { # assert_rolled_back <services...>
  local s
  assert_out "restore verified: (a) content (b) symlinks (c) access (e) env (g) image"
  assert_out "rollback verified"
  assert_out "rolled back to"
  for s in "$@"; do
    [[ "$(image "$s")" == "sha256:old-$s" ]] || fail "$s latest tag not restored"
    [[ "$(running "$s")" == "sha256:old-$s" ]] || fail "$s container not recreated from the rollback image"
  done
  same_host benefits-network
  same_host .env.benefits
  assert_log "docker compose --env-file $HOST/.env.benefits up -d --no-build --no-deps"
  assert_content_only_rsync
  refute_log "prune"
}
D() { EXPECTED_SHA="$SHA" run "$@"; }

# --- capacity is read-only and never prunes, even below the floor -------------------
: > "$LOG"
FREE_MB=3000 run 0 "$C" capacity
assert_out "below the 4096M deploy floor"
assert_out "never prunes"
refute_log "prune"
refute_log "mkdir"
refute_log "rsync"
same_host benefits-network

# --- deploy below the 4 GB floor refuses before any write; the floor is fixed -------
for env in "" MIN_FREE_GB=0 ABORT_FREE_GB=0 DEPLOY_ABORT_FREE_GB=0 ALLOW_PRUNE=1; do
  : > "$LOG"
  D 75 env FREE_MB=4095 ${env:+"$env"} "$C" frontend
  assert_out "need 4096M"
  assert_out "never prunes"
  refute_log "prune"
  refute_log "mkdir"
  refute_log "image tag"
  refute_log "--itemize-changes"
done
same_host benefits-network

# --- a schema migration (release-only or host-only) refuses before any write ---------
mkdir -p "$REPO/apps/benefits-network/backend/prisma/migrations/29990101000000_t265_probe"
echo "ALTER TABLE x ADD COLUMN y TEXT;" > "$REPO/apps/benefits-network/backend/prisma/migrations/29990101000000_t265_probe/migration.sql"
git -C "$REPO" add -A apps/benefits-network
git -C "$REPO" -c user.name=test -c user.email=test@example.invalid commit -qm "migration probe"
: > "$LOG"
EXPECTED_SHA="$(git -C "$REPO" rev-parse HEAD)" run 78 "$C" backend
assert_out "migrations/29990101000000_t265_probe/migration.sql"
assert_out "performs no schema migration"
refute_log "mkdir"
refute_log "--itemize-changes"
git -C "$REPO" reset -q --hard "$SHA"
mkdir "$APPDIR/backend/prisma/migrations/29990101000000_host_only"
echo "-- host" > "$APPDIR/backend/prisma/migrations/29990101000000_host_only/migration.sql"
: > "$LOG"
D 78 "$C" frontend
assert_out "29990101000000_host_only"
refute_log "mkdir"
rm -r "$APPDIR/backend/prisma/migrations/29990101000000_host_only"
m="$(ls -d "$APPDIR"/backend/prisma/migrations/*/ | head -1)"
cp "$m/migration.sql" "$TMP/migration.keep"
echo "-- edited on host" >> "$m/migration.sql"
: > "$LOG"
D 78 "$C" frontend
refute_log "mkdir"
cp "$TMP/migration.keep" "$m/migration.sql"
same_host benefits-network

# --- a service without a running container stops before any write ---------------------
mv "$DOCKER_STATE/running-inferno-benefits-backend" "$TMP/backend.running"
: > "$LOG"
D 78 "$C" backend
assert_out "container inferno-benefits-backend is not running"
assert_out "nothing to roll back to"
refute_log "mkdir"
mv "$TMP/backend.running" "$DOCKER_STATE/running-inferno-benefits-backend"

# --- failed sync: restore source/env/images/containers, verified ----------------------
: > "$LOG"
RSYNC_FAIL=1 D 1 "$C" frontend
assert_out "rsync failed"
refute_log "up -d --build"
assert_rolled_back benefits-frontend
refute_out "test-only-admin-secret"

# --- backup is complete before the first write -----------------------------------------
backup="$(last_backup)"; stamp="${backup##*-}"
[[ "$(line_of "tar -C")" -lt "$(line_of "--itemize-changes")" ]] || fail "source written before the backup"
[[ "$(line_of "docker image tag sha256:old-benefits-frontend inferno-benefits-frontend:rollback-$stamp")" -lt "$(line_of "--itemize-changes")" ]] \
  || fail "rollback tag not set before the first write"
cmp -s "$backup/env.benefits" "$TMP/host.before/.env.benefits" || fail "env backup differs from the live env"
[[ "$(ls -l "$backup/env.benefits" | cut -c1-10)" == "-rw-------" ]] || fail "env backup is not mode 600"
[[ "$(cat "$backup/image-id-benefits-frontend")" == "sha256:old-benefits-frontend" ]] || fail "backup lacks the image id"
[[ "$(cat "$backup/services")" == "benefits-frontend" ]] || fail "backup service list wrong"
tar -tzf "$backup/source.tgz" > "$TMP/backup.list"
grep -q "benefits-network/frontend/src/old-only-on-host.js" "$TMP/backup.list" || fail "backup lacks the source"
if grep -Eq "/(\.env|\.env\.local|app\.db)$|/(node_modules|\.next|dist)(/|$)" "$TMP/backup.list"; then
  fail "backup contains env/db or node_modules/.next/dist"
fi

# --- the backup saves the image that RUNS, not what :latest points to ------------------
# A build without `up` (or a manual retag) moved :latest away from the running container.
echo sha256:drifted-frontend > "$DOCKER_STATE/images/inferno-benefits-frontend:latest"
: > "$LOG"
RSYNC_FAIL=1 D 1 "$C" frontend
backup="$(last_backup)"; stamp="${backup##*-}"
[[ "$(cat "$DOCKER_STATE/images/inferno-benefits-frontend:rollback-$stamp")" == "sha256:old-benefits-frontend" ]] \
  || fail "rollback tag holds the drifted :latest, not the running image"
[[ "$(cat "$backup/image-id-benefits-frontend")" == "sha256:old-benefits-frontend" ]] || fail "image-id is not the running image"
refute_log "docker image tag inferno-benefits-frontend:latest inferno-benefits-frontend:rollback"
assert_rolled_back benefits-frontend     # :latest and the container end on the running image

# --- failed build: restore -------------------------------------------------------------
: > "$LOG"
BUILD_FAIL=1 D 1 "$C" frontend
assert_out "compose build/up of benefits-frontend failed"
assert_rolled_back benefits-frontend

# --- failed health: restore, public checks only after the restore ----------------------
: > "$LOG"
BAD_BUILD=1 D 1 "$C" frontend
assert_out "inferno-benefits-frontend not healthy: unhealthy"
assert_rolled_back benefits-frontend
[[ "$(line_of "curl ")" -gt "$(line_of "up -d --no-build")" ]] || fail "public checks ran on the unhealthy release"

# --- backend mode: a bad frontend after a good backend restores both -------------------
: > "$LOG"
BAD_BUILD=benefits-frontend D 1 "$C" backend
assert_log "up -d --build --no-deps benefits-backend"
[[ "$(line_of "up -d --build --no-deps benefits-backend")" -lt "$(line_of "up -d --build --no-deps benefits-frontend")" ]] || fail "frontend built before backend"
assert_log "up -d --no-build --no-deps benefits-backend benefits-frontend"
assert_rolled_back benefits-backend benefits-frontend

# --- healthy containers but public check fails: restore, public 200 verified -----------
: > "$LOG"
PUBLIC_BAD=1 D 1 "$C" frontend
assert_out "FAIL  https://shop.ifrunit.tech/ returned 502 (expected 200)"
assert_out "verified: Benefits public checks pass"
assert_rolled_back benefits-frontend

# --- a restore that cannot be verified fails loudly (exit 70) --------------------------
for case in "content:(a) content differs from the backup" "link:(b) symlinks differ from the backup" \
            "perm:(c) entries lost world read/traverse access"; do
  : > "$LOG"
  TAMPER="${case%%:*}" BAD_BUILD=1 D 70 "$C" frontend
  assert_out "ROLLBACK CHECK FAILED: ${case#*:}"
  assert_out "AUTOMATIC ROLLBACK FAILED; run: scripts/deploy-benefits-network.sh rollback"
  refute_log "prune"
  # repair the fixture the way an operator would: manual rollback after fixing the cause
  chmod o+r "$APPDIR/frontend/src/old-only-on-host.js"
  : > "$LOG"
  run 0 "$C" rollback "/opt/inferno/backups/$(basename "$(last_backup)")"
  assert_rolled_back benefits-frontend
done
: > "$LOG"
RESTORE_RSYNC_FAIL=1 BAD_BUILD=1 D 70 "$C" frontend
assert_out "ROLLBACK CHECK FAILED: rsync exited 23"
refute_log "docker image tag inferno-benefits-frontend:rollback"
: > "$LOG"
run 0 "$C" rollback "/opt/inferno/backups/$(basename "$(last_backup)")"
assert_rolled_back benefits-frontend
: > "$LOG"
PUBLIC_DOWN=1 BAD_BUILD=1 D 70 "$C" frontend
assert_out "ROLLBACK CHECK FAILED: (f) public checks fail after restore"
: > "$LOG"
run 0 "$C" rollback "/opt/inferno/backups/$(basename "$(last_backup)")"
assert_rolled_back benefits-frontend

# --- a verification command that errors (not only a mismatch) fails the restore ---------
for case in "FIND_FAIL:ROLLBACK CHECK FAILED: listing ref.l: find exited 1" \
            "READLINK_FAIL:ROLLBACK CHECK FAILED: (b) readlink ./frontend/src/current-link exited 1" \
            "INSPECT_FAIL:ROLLBACK CHECK FAILED: (d) inferno-benefits-frontend not healthy after restore" \
            "RESTORE_UP_NOOP:ROLLBACK CHECK FAILED: (g) inferno-benefits-frontend is 'true sha256:bad', expected 'true sha256:old-benefits-frontend'"; do
  : > "$LOG"
  D 70 env "${case%%:*}=1" BAD_BUILD=1 "$C" frontend
  assert_out "${case#*:}"
  assert_out "AUTOMATIC ROLLBACK FAILED; run: scripts/deploy-benefits-network.sh rollback"
  refute_out "rollback verified"
  : > "$LOG"
  run 0 "$C" rollback "/opt/inferno/backups/$(basename "$(last_backup)")"
  assert_rolled_back benefits-frontend
done

# --- rollback accepts only a timestamped Benefits backup ------------------------------
: > "$LOG"
run 64 "$C" rollback /etc
run 64 "$C" rollback "/opt/inferno/backups/benefits-network-20260101T000000Z; touch $TMP/injected"
run 64 "$C" rollback "/opt/inferno/backups/points-backend-20260101T000000Z"
test ! -e "$TMP/injected" || fail "rollback path was executed"
refute_log "ssh "

# --- successful deploy: content-only, exact tree, excludes protected, env untouched ----
before_inode="$(ls -i "$ENVF" | awk '{print $1}')"
# Intentional excludes never reach the host, so they may exist locally.
LAPP="$REPO/apps/benefits-network"
mkdir -p "$LAPP/frontend/node_modules/pkg" "$LAPP/frontend/.next/cache" "$LAPP/backend/dist"
for f in .env frontend/.env.local backend/.env.production backend/app.db backend/app.db-journal \
         frontend/node_modules/pkg/index.js frontend/.next/cache/x backend/dist/index.js; do
  echo "local only" > "$LAPP/$f"
done
: > "$LOG"
D 0 "$C" frontend
for f in .env backend/.env.production backend/app.db-journal; do
  test ! -e "$APPDIR/$f" || fail "local excluded $f was uploaded"
done
assert_out "released: benefits-frontend $SHA"
assert_out "verified: Benefits public checks pass"
assert_log "rsync -rl --checksum --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r --itemize-changes --exclude node_modules"
assert_content_only_rsync
assert_log "docker compose --env-file $HOST/.env.benefits up -d --build --no-deps benefits-frontend"
refute_log "up -d --build --no-deps benefits-backend"
refute_log "prune"
[[ "$(running benefits-frontend)" == "sha256:new-$SHA" ]] || fail "frontend not rebuilt"
[[ "$(running benefits-backend)" == "sha256:old-benefits-backend" ]] || fail "frontend deploy touched the backend"
[[ "$(cat "$APPDIR/RELEASE_SHA")" == "$SHA" ]] || fail "RELEASE_SHA not written"
test ! -e "$APPDIR/frontend/src/old-only-on-host.js" || fail "--delete did not remove stale source"
cmp -s "$APPDIR/frontend/README.md" "$REPO/apps/benefits-network/frontend/README.md" || fail "README not shipped"
for f in backend/.env frontend/.env.local backend/app.db frontend/node_modules/pkg/index.js frontend/.next/cache/x backend/dist/index.js; do
  cmp -s "$APPDIR/$f" "$TMP/host.before/benefits-network/$f" || fail "excluded $f was changed or deleted"
done
cmp -s "$ENVF" "$TMP/host.before/.env.benefits" || fail "deploy changed .env.benefits"
[[ "$(ls -i "$ENVF" | awk '{print $1}')" == "$before_inode" ]] || fail "deploy replaced the env inode"
refute_out "test-only-admin-secret"
refute_out "placeholder-key"
ok_backup="$(last_backup)"
# the live tree is now the release; refresh the reference for the env tests below
rm -rf "$TMP/host.before" && cp -R "$HOST" "$TMP/host.before"

# --- an existing backup dir is never overwritten -----------------------------------------
mkdir -p "$HOST/backups/benefits-network-29991231T235959Z"
: > "$LOG"
( date() { echo 29991231T235959Z; }; export -f date
  D 1 "$C" frontend
  grep -Fq "File exists" <<< "$OUT" || fail "same-second backup dir not refused"
  grep -Fq "nothing was released" <<< "$OUT" || fail "backup failure not reported" )
refute_log "--itemize-changes"

# --- verify is public HTTP only ------------------------------------------------------------
: > "$LOG"
run 0 "$C" verify
assert_out "ok    200 https://shop.ifrunit.tech/api/ready"
PUBLIC_DOWN=1 run 1 "$C" verify
refute_log "ssh "
refute_log "rsync "

# --- env-vault-v2: refuses bad input before any remote call ------------------------------
: > "$LOG"
for bad in "" 0x123 "0x00000000000000000000000000000000000000g1" "0x0000000000000000000000000000000000000000" \
           "0x00000000000000000000000000000000000000a5;touch $TMP/injected" "COMMITMENT_VAULT_ADDRESS=0x00000000000000000000000000000000000000a5"; do
  run 64 "$C" env-vault-v2 "$bad"
done
test ! -e "$TMP/injected" || fail "env-vault-v2 argument was executed"
refute_log "ssh "

# --- env-vault-v2: edits exactly the one key line, backup first, values never printed ---
NEW_V2=0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F
inode="$(ls -i "$ENVF" | awk '{print $1}')"
: > "$LOG"
run 0 "$C" env-vault-v2 "$NEW_V2"
assert_out "exactly one line changed"
env_backup="$(ls -d "$HOST"/backups/benefits-env-* | tail -1)"
cmp -s "$env_backup/env.benefits" "$TMP/host.before/.env.benefits" || fail "env backup differs from the pre-edit env"
[[ "$(ls -l "$env_backup/env.benefits" | cut -c1-10)" == "-rw-------" ]] || fail "env backup is not mode 600"
test ! -e "$env_backup/env.new" || fail "candidate env left behind"
diff "$TMP/host.before/.env.benefits" "$ENVF" > "$TMP/env.diff" || true
[[ "$(grep -c '^[<>]' "$TMP/env.diff")" == 2 ]] || { cat "$TMP/env.diff" >&2; fail "env edit changed more than one line"; }
grep -qx "> COMMITMENT_VAULT_V2_ADDRESS=$NEW_V2" "$TMP/env.diff" || fail "new key line missing"
grep -qx "< COMMITMENT_VAULT_V2_ADDRESS=0x00000000000000000000000000000000000000a4" "$TMP/env.diff" || fail "old key line not replaced"
grep -qx "# COMMITMENT_VAULT_V2_ADDRESS=comment-must-stay" "$ENVF" || fail "comment line changed"
[[ "$(ls -i "$ENVF" | awk '{print $1}')" == "$inode" ]] || fail "env inode replaced (v1 cannot re-own a root file)"
[[ "$(ls -l "$ENVF" | cut -c1-10)" == "-rw-------" ]] || fail "env mode changed"
for secret in test-only-admin-secret placeholder-key placeholder-project shop.example.test 00000000000000000000000000000000000000a4; do
  refute_out "$secret"
done
refute_log "docker"                                     # no container recreated, no compose call
refute_log "prune"
# idempotent: the same address writes nothing and takes no backup
n_before="$(ls -d "$HOST"/backups/benefits-env-* | wc -l)"
run 0 "$C" env-vault-v2 "$NEW_V2"
assert_out "nothing written"
[[ "$(ls -d "$HOST"/backups/benefits-env-* | wc -l)" == "$n_before" ]] || fail "no-op edit took a backup"
# env-restore puts the backup back, content only
run 0 "$C" env-restore "/opt/inferno/backups/$(basename "$env_backup")"
cmp -s "$ENVF" "$TMP/host.before/.env.benefits" || fail "env-restore did not restore the backup"
[[ "$(ls -i "$ENVF" | awk '{print $1}')" == "$inode" ]] || fail "env-restore replaced the inode"
run 64 "$C" env-restore "/opt/inferno/backups/benefits-env-1; id"

# --- env-vault-v2: absent key is appended as the only change -----------------------------
grep -v '^COMMITMENT_VAULT_V2_ADDRESS=' "$ENVF" > "$TMP/env.nokey"; cat "$TMP/env.nokey" > "$ENVF"
run 0 "$C" env-vault-v2 "$NEW_V2"
diff "$TMP/env.nokey" "$ENVF" > "$TMP/env.diff" || true
[[ "$(grep -c '^[<>]' "$TMP/env.diff")" == 1 ]] && grep -qx "> COMMITMENT_VAULT_V2_ADDRESS=$NEW_V2" "$TMP/env.diff" \
  || { cat "$TMP/env.diff" >&2; fail "append changed more than the key line"; }

# --- env-vault-v2: duplicate key lines and unwritable files are refused, nothing written -
write_env
echo "COMMITMENT_VAULT_V2_ADDRESS=0x00000000000000000000000000000000000000a6" >> "$ENVF"
cp "$ENVF" "$TMP/env.dup"
n_before="$(ls -d "$HOST"/backups/benefits-env-* | wc -l)"
run 78 "$C" env-vault-v2 "$NEW_V2"
assert_out "holds 2 COMMITMENT_VAULT_V2_ADDRESS lines"
cmp -s "$ENVF" "$TMP/env.dup" || fail "refused edit changed the env"
[[ "$(ls -d "$HOST"/backups/benefits-env-* | wc -l)" == "$n_before" ]] || fail "refused edit took a backup"
write_env
chmod 400 "$ENVF"
run 78 "$C" env-vault-v2 "$NEW_V2"
assert_out "is not a file this user can read and write"
chmod 600 "$ENVF"

# --- env-vault-v2: a corrupted write is restored from the backup and verified ----------
cp "$ENVF" "$TMP/env.orig"
ENV_WRITE_TAMPER=1 run 1 "$C" env-vault-v2 "$NEW_V2"
assert_out "ENV EDIT FAILED: (4) written bytes differ from the verified candidate"
assert_out "restored from the backup and verified"
cmp -s "$ENVF" "$TMP/env.orig" || fail "corrupted env write not restored"
refute_out "test-only-admin-secret"

# --- a deploy rollback also restores .env.benefits to the backup (check (e)) -------------
run 0 "$C" env-vault-v2 "$NEW_V2"
cmp -s "$ENVF" "$ok_backup/env.benefits" && fail "fixture: env edit did not change the env"
: > "$LOG"
run 0 "$C" rollback "/opt/inferno/backups/$(basename "$ok_backup")"
assert_out "(e) env"
cmp -s "$ENVF" "$ok_backup/env.benefits" || fail "rollback did not restore .env.benefits"
[[ "$(ls -l "$ENVF" | cut -c1-10)" == "-rw-------" ]] || fail "rollback changed the env mode"
refute_out "test-only-admin-secret"

# --- never prunes: no call of the whole suite and no line of the script prunes ----------
if grep -Eq 'prune' "$ALL_LOG"; then grep -E 'prune' "$ALL_LOG" >&2; echo "FAIL: a prune was called" >&2; exit 1; fi
if grep -Eq 'docker[^#]*prune|safe_prune|ALLOW_PRUNE' "$ROOT/$SCRIPT"; then echo "FAIL: $SCRIPT still contains a prune path" >&2; exit 1; fi

echo "Benefits release guards hold: no-prune capacity floor, no schema migration, backup-first, backup of the running image ID, verified restore on sync/build/health/public failure with erroring checks failing it, env-vault-v2 single-key edit"
