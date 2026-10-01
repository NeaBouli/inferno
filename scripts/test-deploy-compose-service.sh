#!/usr/bin/env bash
# T-162 release-guard tests for scripts/deploy-compose-service.sh. A fake `ssh`
# runs each remote command for real against a temporary copy of /opt/inferno
# (mkdir, tar, rsync, cat); docker, df and curl are fakes that keep image, tag
# and container state in files. Nothing leaves this machine.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAKES="$TMP/bin"
LOG="$TMP/calls.log"
REMOTE="$TMP/remote"                     # stands in for the host filesystem root
HOST="$REMOTE/opt/inferno"
DOCKER_STATE="$TMP/docker"
REAL_RSYNC="$(command -v rsync)"
SCRIPT=scripts/deploy-compose-service.sh
mkdir -p "$FAKES" "$HOST/backups" "$DOCKER_STATE/images"
: > "$LOG"

# Clone the current commit and overlay the script under test, so the guards run
# against a real, clean exact-SHA checkout even before these edits are committed.
git clone -q --local "$ROOT" "$TMP/repo"
cp "$ROOT/$SCRIPT" "$TMP/repo/$SCRIPT"
# Nested source dirs that share a name with a root runtime dir must ship.
NESTED=(src/data/nested.json src/dist/nested.js src/node_modules/nested/index.js)
for f in "${NESTED[@]}"; do
  mkdir -p "$(dirname "$TMP/repo/apps/points-backend/$f")"
  echo "release $f" > "$TMP/repo/apps/points-backend/$f"
  git -C "$TMP/repo" add -f "apps/points-backend/$f"
done
git -C "$TMP/repo" add -A scripts
git -C "$TMP/repo" -c user.name=test -c user.email=test@example.invalid commit -qm "test overlay" --allow-empty
REPO="$TMP/repo"
SHA="$(git -C "$REPO" rev-parse HEAD)"

# Host layout as found read-only on 2026-09-30: plain source copies next to the
# compose file; remote-only env, SQLite and data files inside a source dir must survive.
echo "services: {}" > "$HOST/docker-compose.yml"
for svc in telegram-bot points-backend ai-copilot; do
  mkdir -p "$HOST/$svc/src/data" "$HOST/$svc/node_modules/pkg" "$HOST/$svc/data" "$HOST/$svc/dist"
  echo "FROM node:20" > "$HOST/$svc/Dockerfile"
  echo "old code" > "$HOST/$svc/src/old-only-on-host.js"
  echo "old nested" > "$HOST/$svc/src/data/old-nested.json"
  echo "SECRET_PLACEHOLDER=1" > "$HOST/$svc/.env"
  echo "LOCAL=1" > "$HOST/$svc/.env.local"
  echo "sqlite" > "$HOST/$svc/app.db"
  echo "wal" > "$HOST/$svc/app.db-wal"
  echo "dep" > "$HOST/$svc/node_modules/pkg/index.js"
  echo "row" > "$HOST/$svc/data/state.json"
  echo "bundle" > "$HOST/$svc/dist/main.js"
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
args=()
for a in "$@"; do
  a="${a#compose-test-host:}"
  [[ "$a" == /opt/inferno* ]] && a="$REMOTE$a"   # remote paths only; local ones pass through
  args+=("$a")
done
exec "$REAL_RSYNC" "${args[@]}"
EOF
# docker: images are files named <repo:tag> holding an id; a container runs the id
# its image had at `compose up`. A build yields sha256:bad when BAD_BUILD=1, and a
# container running sha256:bad reports unhealthy.
cat > "$FAKES/docker" <<'EOF'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$LOG"
img="$DOCKER_STATE/images"
case "$*" in
  "image inspect -f {{.Id}} "*|"image inspect "*) cat "$img/${@: -1}" 2>/dev/null || { echo "No such image: ${@: -1}" >&2; exit 1; } ;;
  "image tag "*) cp "$img/$3" "$img/$4" ;;
  "compose up -d --build --no-deps "*)
    svc="${@: -1}"
    [[ "${BUILD_FAIL:-0}" == 1 ]] && exit 17
    if [[ "${BAD_BUILD:-0}" == 1 ]]; then echo sha256:bad > "$img/inferno-$svc:latest"
    else echo "sha256:new-$(cat "$REMOTE/opt/inferno/$svc/RELEASE_SHA")" > "$img/inferno-$svc:latest"; fi
    cp "$img/inferno-$svc:latest" "$DOCKER_STATE/running-inferno-$svc" ;;
  "compose up -d --no-build --no-deps "*)
    svc="${@: -1}"; cp "$img/inferno-$svc:latest" "$DOCKER_STATE/running-inferno-$svc" ;;
  inspect*)
    c="${@: -1}"
    [[ -f "$DOCKER_STATE/running-$c" ]] || exit 1
    if grep -qx 'sha256:bad' "$DOCKER_STATE/running-$c"; then h=unhealthy; else h=healthy; fi
    if [[ "$*" == *State.Status* ]]; then echo "running $h"; else echo "$h"; fi ;;
  *) echo "unexpected docker call: $*" >&2; exit 99 ;;
esac
EOF
# date: every UTC backup timestamp is unique and increasing, so fast CI hosts
# never run two deploys "in the same second" (the scripts refuse to reuse a backup dir).
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
printf 'Avail\n%sM\n' "${FREE_MB:-4600}"
EOF
# curl: health endpoints 200, telegram root 404, status route STATUS_CODE (default 404).
cat > "$FAKES/curl" <<'EOF'
#!/usr/bin/env bash
url="${@: -1}"; url="${url%%\?*}"
printf 'curl %s\n' "$url" >> "$LOG"
case "$url" in
  */api/verify/status/1) printf '%s' "${STATUS_CODE:-404}" ;;
  https://verify-api.ifrunit.tech/) printf '404' ;;
  */health) printf '%s' "${HEALTH_CODE:-200}" ;;
  *) printf '000'; exit 7 ;;
esac
EOF
chmod +x "$FAKES"/*

run() { # run <expected-exit> <cmd...>
  local expected="$1"; shift
  set +e
  OUT="$(PATH="$FAKES:$PATH" LOG="$LOG" REMOTE="$REMOTE" REAL_RSYNC="$REAL_RSYNC" DOCKER_STATE="$DOCKER_STATE" \
    SSH_HOST=compose-test-host HEALTH_INTERVAL="${HEALTH_INTERVAL:-0}" HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-3}" "$@" 2>&1)"
  local status=$?
  set -e
  if [[ "$status" != "$expected" ]]; then
    echo "FAIL: expected exit $expected, got $status: $*" >&2
    echo "$OUT" >&2
    exit 1
  fi
}
fail() { echo "FAIL: $*" >&2; echo "$OUT" >&2; exit 1; }
assert_out() { grep -Fq -- "$1" <<< "$OUT" || fail "output lacks: $1"; }
assert_log() { grep -Fq -- "$1" "$LOG" || { echo "FAIL: log lacks: $1" >&2; cat "$LOG" >&2; exit 1; }; }
refute_log() { if grep -Fq -- "$1" "$LOG"; then echo "FAIL: log has: $1" >&2; cat "$LOG" >&2; exit 1; fi; }
line_of() { grep -Fn -- "$1" "$LOG" | head -1 | cut -d: -f1; }
same_tree() { diff -r "$TMP/host.before/$1" "$HOST/$1" >/dev/null || fail "$HOST/$1 differs from the pre-release host"; }
image() { cat "$DOCKER_STATE/images/inferno-$1:latest"; }
running() { cat "$DOCKER_STATE/running-inferno-$1"; }
C="$REPO/$SCRIPT"

# --- guards refuse before any remote access -----------------------------------------
run 1 "$C" deploy
assert_out "usage:"
run 1 "$C" benefits-backend deploy
run 1 "$C" "points-backend; touch $TMP/injected" plan
run 1 "$C" points-backend deploy
assert_out "EXPECTED_SHA"
EXPECTED_SHA="${SHA:0:12}" run 1 "$C" points-backend plan     # a resolvable short SHA is not enough
assert_out "full 40-char"
EXPECTED_SHA=0000000000000000000000000000000000000000 run 1 "$C" points-backend deploy
assert_out "not in this clone"
echo "dirty" >> "$REPO/apps/points-backend/README.md"
EXPECTED_SHA="$SHA" run 1 "$C" points-backend deploy
assert_out "dirty"
git -C "$REPO" checkout -q -- apps/points-backend/README.md
git -C "$REPO" -c user.name=test -c user.email=test@example.invalid commit -qm "later" --allow-empty
EXPECTED_SHA="$SHA" run 1 "$C" points-backend deploy
assert_out "HEAD is not"
git -C "$REPO" reset -q --hard "$SHA"
refute_log "ssh "

# --- env values that reach remote shell strings are allow-listed --------------------
set +e
OUT="$(PATH="$FAKES:$PATH" LOG="$LOG" SSH_HOST="x; touch $TMP/injected" EXPECTED_SHA="$SHA" "$C" points-backend plan 2>&1)"
[[ $? == 1 ]] || fail "SSH_HOST injection not refused"
set -e
assert_out "SSH_HOST contains characters"
REMOTE_ROOT='/opt/inferno;id' EXPECTED_SHA="$SHA" run 1 "$C" points-backend plan
assert_out "REMOTE_ROOT contains characters"
REMOTE_VOLUME="/mnt/x' ; touch $TMP/injected; '" EXPECTED_SHA="$SHA" run 1 "$C" points-backend plan
assert_out "REMOTE_VOLUME contains characters"
HEALTH_ATTEMPTS='3; touch /tmp/x' EXPECTED_SHA="$SHA" run 1 "$C" points-backend deploy
assert_out "HEALTH_ATTEMPTS must be an integer"
HEALTH_INTERVAL='$(id)' EXPECTED_SHA="$SHA" run 1 "$C" points-backend deploy
test ! -e "$TMP/injected" || fail "an env value was executed"
refute_log "ssh "

# --- plan is read-only and shows the itemized change set -----------------------------
: > "$LOG"
EXPECTED_SHA="$SHA" run 0 "$C" points-backend plan
assert_log "--dry-run"
assert_out "RELEASE_SHA"
grep -Eq -- "^\*deleting +src/old-only-on-host.js" <<< "$OUT" || fail "plan does not show the stale file deletion"
grep -Eq -- "^\*deleting +src/data/old-nested.json" <<< "$OUT" || fail "plan treats nested src/data as a runtime dir"
grep -Eq -- "^[<>]f\S* +src/data/nested.json" <<< "$OUT" || fail "plan does not ship nested src/data"
assert_out "4600M free"
assert_out "running healthy"
if grep -Eq -- "^\*deleting +(\.env|app\.db|node_modules/|data/|dist/)" <<< "$OUT"; then fail "plan would delete an excluded file"; fi
diff -r "$TMP/host.before" "$HOST" >/dev/null || fail "plan changed the host"
refute_log "image tag"
refute_log "compose up"
refute_log "mkdir"
FREE_MB=100 EXPECTED_SHA="$SHA" run 0 "$C" points-backend plan
assert_out "deploy will refuse"

# --- capacity below 4 GB refuses before any write and never prunes -------------------
: > "$LOG"
FREE_MB=4095 EXPECTED_SHA="$SHA" run 1 "$C" points-backend deploy
assert_out "need 4096"
refute_log "prune"
refute_log "mkdir"
refute_log "image tag"
refute_log "--itemize-changes"
MIN_FREE_MB=0 FREE_MB=4095 EXPECTED_SHA="$SHA" run 1 "$C" points-backend deploy   # floor is not overridable
diff -r "$TMP/host.before" "$HOST" >/dev/null || fail "refused deploy changed the host"

# --- a missing image stops before any write (nothing to roll back to) ----------------
mv "$DOCKER_STATE/images/inferno-ai-copilot:latest" "$TMP/copilot.image"
: > "$LOG"
EXPECTED_SHA="$SHA" run 1 "$C" ai-copilot deploy
assert_out "nothing to roll back to"
refute_log "mkdir"
mv "$TMP/copilot.image" "$DOCKER_STATE/images/inferno-ai-copilot:latest"

# --- failed health: automatic rollback of source, image and container ---------------
: > "$LOG"
BAD_BUILD=1 EXPECTED_SHA="$SHA" run 1 "$C" points-backend deploy
assert_out "rolled back to"
assert_out "not healthy: unhealthy"
backup="$(ls -d "$HOST"/backups/points-backend-* | tail -1)"
stamp="${backup##*-}"
[[ "$(cat "$backup/image-id")" == "sha256:old-points-backend" ]] || fail "backup lacks the previous image id"
[[ "$(image points-backend)" == "sha256:old-points-backend" ]] || fail "latest tag not restored"
[[ "$(running points-backend)" == "sha256:old-points-backend" ]] || fail "container not recreated from the rollback image"
same_tree points-backend
assert_log "docker image tag inferno-points-backend:rollback-$stamp inferno-points-backend:latest"
assert_log "docker compose up -d --no-build --no-deps points-backend"
refute_log "curl "                                    # public checks never ran on an unhealthy container
refute_log "prune"

# --- backup is complete before the first write; excludes are kept out of it ----------
[[ "$(line_of "tar -C")" -lt "$(line_of "--itemize-changes")" ]] || fail "source written before backup"
[[ "$(line_of "image tag inferno-points-backend:latest")" -lt "$(line_of "compose up -d --build")" ]] || fail "image replaced before rollback tag"
tar -tzf "$backup/source.tgz" > "$TMP/backup.list"   # no pipe into grep -q: SIGPIPE + pipefail
grep -q "points-backend/src/old-only-on-host.js" "$TMP/backup.list" || fail "backup lacks the source"
grep -q "points-backend/src/data/old-nested.json" "$TMP/backup.list" || fail "backup lacks nested src/data"
if grep -Eq "/(\.env|\.env\.local|app\.db|app\.db-wal)$|^points-backend/(node_modules|data|dist)(/|$)" "$TMP/backup.list"; then
  fail "backup contains env/db or root node_modules/data/dist"
fi
assert_log "--exclude '.env*' --exclude '*.db*' --exclude 'points-backend/node_modules' --exclude 'points-backend/dist' --exclude 'points-backend/data' -czf"

# --- telegram: status route still 200 (CWA-34) fails the release and rolls back -----
: > "$LOG"
STATUS_CODE=200 EXPECTED_SHA="$SHA" run 1 "$C" telegram-bot deploy
assert_out "FAIL  https://verify-api.ifrunit.tech/api/verify/status/1 returned 200 (expected 404)"
assert_out "rolled back to"
[[ "$(running telegram-bot)" == "sha256:old-telegram-bot" ]] || fail "telegram not rolled back"
same_tree telegram-bot

# --- failed sync and failed build also roll back --------------------------------------
sleep 1   # distinct backup timestamps
: > "$LOG"
RSYNC_FAIL=1 EXPECTED_SHA="$SHA" run 1 "$C" ai-copilot deploy
assert_out "rsync failed"
assert_out "rolled back to"
refute_log "compose up -d --build"
same_tree ai-copilot
sleep 1
: > "$LOG"
BUILD_FAIL=1 EXPECTED_SHA="$SHA" run 1 "$C" ai-copilot deploy
assert_out "compose build/up failed"
assert_out "rolled back to"
[[ "$(running ai-copilot)" == "sha256:old-ai-copilot" ]] || fail "copilot container changed"
same_tree ai-copilot

# --- successful deploy: exact archive, RELEASE_SHA, excludes protected ----------------
sleep 1
: > "$LOG"
EXPECTED_SHA="$SHA" run 0 "$C" points-backend deploy
assert_out "released: points-backend $SHA"
assert_out "ok    200 https://points-api.ifrunit.tech/health"
[[ "$(cat "$HOST/points-backend/RELEASE_SHA")" == "$SHA" ]] || fail "RELEASE_SHA not written"
[[ "$(running points-backend)" == "sha256:new-$SHA" ]] || fail "container not rebuilt"
test ! -e "$HOST/points-backend/src/old-only-on-host.js" || fail "--delete did not remove stale source"
test ! -e "$HOST/points-backend/src/data/old-nested.json" || fail "nested src/data treated as a runtime dir"
for f in "${NESTED[@]}"; do
  cmp -s "$HOST/points-backend/$f" "$REPO/apps/points-backend/$f" || fail "nested $f not shipped"
done
cmp -s "$HOST/points-backend/package.json" "$ROOT/apps/points-backend/package.json" || fail "package.json not shipped"
for f in .env .env.local app.db app.db-wal node_modules/pkg/index.js data/state.json dist/main.js; do
  cmp -s "$HOST/points-backend/$f" "$TMP/host.before/points-backend/$f" || fail "excluded $f was changed or deleted"
done
test ! -e "$HOST/points-backend/.env.example" || fail ".env* file shipped"
assert_log "--exclude .env* --exclude *.db* --exclude /node_modules --exclude /dist --exclude /data"
refute_log "--delete-excluded"
refute_log "prune"
same_tree telegram-bot                                # other services untouched

# --- an existing backup dir is never overwritten ---------------------------------------
mkdir -p "$HOST/backups/points-backend-29991231T235959Z"
: > "$LOG"
( PATH="$FAKES:$PATH"; date() { echo 29991231T235959Z; }; export -f date
  EXPECTED_SHA="$SHA" run 1 "$C" points-backend deploy
  grep -Fq "File exists" <<< "$OUT" || fail "same-second backup dir not refused" )
refute_log "--itemize-changes"
refute_log "docker image tag inferno-points-backend:latest"   # the ssh line holds the text; docker never ran it

# --- verify is public HTTP only ---------------------------------------------------------
: > "$LOG"
run 0 "$C" telegram-bot verify
assert_out "ok    404 https://verify-api.ifrunit.tech/api/verify/status/1"
STATUS_CODE=200 run 1 "$C" telegram-bot verify
HEALTH_CODE=502 run 1 "$C" ai-copilot verify
assert_out "copilot-api.ifrunit.tech/api/health returned 502"
refute_log "ssh "
refute_log "rsync "

# --- rollback accepts only a timestamped backup of the same service -------------------
: > "$LOG"
run 1 "$C" points-backend rollback /etc
run 1 "$C" points-backend rollback "/opt/inferno/backups/points-backend-20260101T000000Z; touch $TMP/injected"
run 1 "$C" points-backend rollback "/opt/inferno/backups/telegram-bot-$stamp"
run 1 "$C" points-backend rollback "/opt/inferno/backups/points-backend-$stamp/../x"
test ! -e "$TMP/injected" || fail "rollback path was executed as a command"
refute_log "ssh "
run 0 "$C" points-backend rollback "/opt/inferno/backups/points-backend-$stamp"
same_tree points-backend
[[ "$(running points-backend)" == "sha256:old-points-backend" ]] || fail "manual rollback did not restore the image"

echo "Compose release guards hold: plan/deploy/verify/rollback for telegram-bot, points-backend, ai-copilot"
