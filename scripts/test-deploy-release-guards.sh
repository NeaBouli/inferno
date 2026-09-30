#!/usr/bin/env bash
# T-160 release-guard tests for scripts/deploy-web3-site.sh and the exact-SHA
# guard in scripts/deploy-benefits-network.sh. A fake `ssh` runs each remote
# command for real against a temporary copy of /opt/inferno (tar, cp, grep,
# cat, rsync); only docker, df and curl are fakes. Nothing leaves this machine.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAKES="$TMP/bin"
LOG="$TMP/calls.log"
REMOTE="$TMP/remote"                     # stands in for the host filesystem root
SITE="$REMOTE/opt/inferno/web3-site"
REAL_RSYNC="$(command -v rsync)"
mkdir -p "$FAKES" "$SITE/html/.nginx" "$REMOTE/opt/inferno/backups" "$REMOTE/opt/inferno/benefits-network"
: > "$LOG"

# Clone the current commit and overlay the scripts under test, so the guards run
# against a real, clean exact-SHA checkout even before these edits are committed.
git clone -q --local "$ROOT" "$TMP/repo"
for f in scripts/deploy-web3-site.sh scripts/web3-release.cjs scripts/deploy-benefits-network.sh; do
  cp "$ROOT/$f" "$TMP/repo/$f"
done
git -C "$TMP/repo" add -A scripts
git -C "$TMP/repo" -c user.name=test -c user.email=test@example.invalid commit -qm "test overlay" --allow-empty
REPO="$TMP/repo"
SHA="$(git -C "$REPO" rev-parse HEAD)"

# Host layout as found read-only on 2026-09-30: nginx.conf includes the headers
# file shipped inside the docroot; the old CSP still allows esm.sh.
cat > "$SITE/nginx.conf" <<'EOF'
server {
  root /usr/share/nginx/html;
  include /usr/share/nginx/html/.nginx/web3-security-headers.conf;
  location = / { try_files /web3/index.html =404; }
}
EOF
sed "s#script-src 'self' 'unsafe-inline';#script-src 'self' 'unsafe-inline' https://esm.sh;#" \
  "$ROOT/infra/web3/web3-security-headers.conf" > "$SITE/html/.nginx/web3-security-headers.conf"
grep -q "esm.sh" "$SITE/html/.nginx/web3-security-headers.conf"
echo "old build" > "$SITE/html/stale-only-on-host.txt"
cp "$SITE/nginx.conf" "$TMP/nginx.conf.orig"

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
[[ "$*" == *:/opt/inferno/benefits-network/* ]] && exit 0   # remote benefits tree is not modelled
[[ "${RSYNC_FAIL:-0}" == 1 && "$*" == *-rlt* ]] && exit 23
args=()
for a in "$@"; do
  a="${a#web3-test-host:}"
  [[ "$a" == /opt/inferno* ]] && a="$REMOTE$a"   # remote paths only; local ones pass through
  args+=("$a")
done
exec "$REAL_RSYNC" "${args[@]}"
EOF
cat > "$FAKES/docker" <<'EOF'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$LOG"
case "$*" in
  *"{{.State.Running}}"*) echo true ;;
  inspect*) echo healthy ;;
  *"nginx -t"*) [[ "${NGINX_T_FAIL:-0}" == 1 ]] && exit 1 ;;
  *"ps -aq benefits-backend"*) echo 1 ;;
esac
exit 0
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
printf 'Avail\n%sM\n' "${FREE_MB:-9000}"
EOF
# curl: serve the fake docroot; -I returns the CSP from the deployed headers file.
cat > "$FAKES/curl" <<'EOF'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$LOG"
url="${@: -1}"; path="${url#https://web3.ifrunit.tech/}"; path="${path%%\?*}"
html="$REMOTE/opt/inferno/web3-site/html"
if [[ " $* " == *" -fsSI "* ]]; then
  csp="$(sed -n 's/^add_header Content-Security-Policy "\(.*\)" always;$/\1/p' "$html/.nginx/web3-security-headers.conf")"
  printf 'HTTP/2 200\r\ncontent-security-policy: %s\r\n\r\n' "$csp"
else
  cat "$html/$path"
fi
EOF
chmod +x "$FAKES"/*

run() { # run <expected-exit> <cmd...>
  local expected="$1"; shift
  set +e
  OUT="$(PATH="$FAKES:$PATH" LOG="$LOG" REMOTE="$REMOTE" REAL_RSYNC="$REAL_RSYNC" SSH_HOST="${SSH_HOST:-web3-test-host}" "$@" 2>&1)"
  local status=$?
  set -e
  if [[ "$status" != "$expected" ]]; then
    echo "FAIL: expected exit $expected, got $status: $*" >&2
    echo "$OUT" >&2
    exit 1
  fi
}
assert_log() { grep -Fq -- "$1" "$LOG" || { echo "FAIL: log lacks: $1" >&2; cat "$LOG" >&2; exit 1; }; }
refute_log() { if grep -Fq -- "$1" "$LOG"; then echo "FAIL: log has: $1" >&2; exit 1; fi; }
# A rejected env value must stop the script before ssh, rsync, docker or curl run.
assert_no_calls() { [[ ! -s "$LOG" ]] || { echo "FAIL: guard let calls through:" >&2; cat "$LOG" >&2; exit 1; }; }

# --- web3: guards refuse before any remote access ------------------------------
run 1 "$REPO/scripts/deploy-web3-site.sh" deploy
grep -Fq "EXPECTED_SHA" <<< "$OUT"
EXPECTED_SHA=0000000000000000000000000000000000000000 run 1 "$REPO/scripts/deploy-web3-site.sh" deploy
echo "dirty" >> "$REPO/docs/llms.txt"
EXPECTED_SHA="$SHA" run 1 "$REPO/scripts/deploy-web3-site.sh" deploy
grep -Fq "dirty" <<< "$OUT"
git -C "$REPO" checkout -q -- docs/llms.txt
refute_log "ssh "

# --- web3: env values that reach remote shell strings are allow-listed -------------
# Every rejection happens before any remote or public call and leaves the host as is.
cp -R "$SITE" "$TMP/site.guard"
: > "$LOG"
CONTAINER="x'; touch $TMP/injected; '" run 1 "$REPO/scripts/deploy-web3-site.sh" plan
grep -Fq "CONTAINER contains characters" <<< "$OUT"
REMOTE_ROOT='/opt/inferno;id' run 1 "$REPO/scripts/deploy-web3-site.sh" plan
MIN_FREE_MB='1+1' run 1 "$REPO/scripts/deploy-web3-site.sh" plan
for host in "web3-test-host; touch $TMP/injected" 'web3-test-host $(touch '"$TMP"'/injected)' \
            "-oProxyCommand=touch $TMP/injected" "-F$TMP/injected"; do
  SSH_HOST="$host" EXPECTED_SHA="$SHA" run 1 "$REPO/scripts/deploy-web3-site.sh" deploy
  grep -Fq "SSH_HOST" <<< "$OUT" || { echo "FAIL: SSH_HOST '$host' not named in rejection" >&2; exit 1; }
done
for url in "http://web3.ifrunit.tech" "https://web3.ifrunit.tech/" "https://web3.ifrunit.tech/x" \
           "https://web3.ifrunit.tech;touch $TMP/injected" "https://web3.ifrunit.tech\$(touch $TMP/injected)" \
           "https://user@web3.ifrunit.tech" "https://" "web3.ifrunit.tech"; do
  PUBLIC_URL="$url" EXPECTED_SHA="$SHA" run 1 "$REPO/scripts/deploy-web3-site.sh" verify
  grep -Fq "PUBLIC_URL must be https://<host>" <<< "$OUT" || { echo "FAIL: PUBLIC_URL '$url' not rejected by the guard" >&2; exit 1; }
done
test ! -e "$TMP/injected" || { echo "FAIL: a rejected env value was executed" >&2; exit 1; }
assert_no_calls
diff -r "$TMP/site.guard" "$SITE" >/dev/null || { echo "FAIL: a rejected run changed the host" >&2; exit 1; }
test -z "$(ls "$REMOTE/opt/inferno/backups")" || { echo "FAIL: a rejected run created a backup" >&2; exit 1; }

# --- web3: plan is read-only -----------------------------------------------------
cp -R "$SITE" "$TMP/site.before"
: > "$LOG"
EXPECTED_SHA="$SHA" run 0 "$REPO/scripts/deploy-web3-site.sh" plan
assert_log "--dry-run"
grep -Fq "https://esm.sh" <<< "$OUT"               # headers diff shown
diff -r "$TMP/site.before" "$SITE" >/dev/null || { echo "FAIL: plan changed the host" >&2; exit 1; }
refute_log "nginx -s reload"

# --- web3: missing include in nginx.conf stops before any write ------------------
sed -i.bak 's#include /usr/share/nginx/html/.nginx/web3-security-headers.conf;##' "$SITE/nginx.conf"
: > "$LOG"
EXPECTED_SHA="$SHA" run 1 "$REPO/scripts/deploy-web3-site.sh" deploy
grep -Fq "does not include" <<< "$OUT"
refute_log "tar -C"
cp "$TMP/nginx.conf.orig" "$SITE/nginx.conf"
rm "$SITE/nginx.conf.bak"

# --- web3: a failed sync stops before nginx is touched -----------------------------
: > "$LOG"
RSYNC_FAIL=1 EXPECTED_SHA="$SHA" run 1 "$REPO/scripts/deploy-web3-site.sh" deploy
grep -Fq "rsync failed; nginx untouched" <<< "$OUT"
refute_log "nginx -t"
refute_log "nginx -s reload"

# --- web3: failed nginx -t restores the previous headers and does not reload ----
: > "$LOG"
NGINX_T_FAIL=1 EXPECTED_SHA="$SHA" run 1 "$REPO/scripts/deploy-web3-site.sh" deploy
grep -Fq "previous .nginx/web3-security-headers.conf restored" <<< "$OUT"
refute_log "nginx -s reload"
grep -q "esm.sh" "$SITE/html/.nginx/web3-security-headers.conf" || { echo "FAIL: headers not restored after nginx -t failure" >&2; exit 1; }

# --- web3: deploy backs up, ships docroot + headers, reloads, verifies ----------
: > "$LOG"
EXPECTED_SHA="$SHA" run 0 "$REPO/scripts/deploy-web3-site.sh" deploy
first_backup="$(ls -d "$REMOTE"/opt/inferno/backups/web3-site-* | head -1)"   # from the aborted run: pristine host
backup="$(ls -d "$REMOTE"/opt/inferno/backups/web3-site-* | tail -1)"
tar -tzf "$backup/html.tgz" > "$TMP/backup.list"   # no pipe into grep -q: SIGPIPE + pipefail
grep -q "html/.nginx/web3-security-headers.conf" "$TMP/backup.list"
cmp -s "$backup/nginx.conf" "$TMP/nginx.conf.orig"
cmp -s "$SITE/nginx.conf" "$TMP/nginx.conf.orig" || { echo "FAIL: nginx.conf was modified" >&2; exit 1; }
cmp -s "$SITE/html/.nginx/web3-security-headers.conf" "$ROOT/infra/web3/web3-security-headers.conf"
grep -Fq "\"sha\":\"$SHA\"" "$SITE/html/web3-release.json"
grep -Fq "<loc>https://web3.ifrunit.tech/" "$SITE/html/sitemap.xml"
test -f "$SITE/html/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js"
test -f "$SITE/html/stale-only-on-host.txt"          # no --delete by default
assert_log "nginx -t"
assert_log "nginx -s reload"
refute_log "--delete"
refute_log "docker compose"
grep -Fq "ok    CSP matches infra/web3" <<< "$OUT"
grep -Fq "verified: https://web3.ifrunit.tech serves $SHA" <<< "$OUT"

# --- web3: an existing backup dir is never overwritten ---------------------------
mkdir -p "$REMOTE/opt/inferno/backups/web3-site-29991231T235959Z"
: > "$LOG"
( PATH="$FAKES:$PATH"; date() { echo 29991231T235959Z; }; export -f date
  EXPECTED_SHA="$SHA" run 1 "$REPO/scripts/deploy-web3-site.sh" deploy
  grep -Fq "File exists" <<< "$OUT" )
refute_log "rsync -rlt"

# --- web3: verify fails when the host serves something else ----------------------
cp "$SITE/html/.nginx/web3-security-headers.conf" "$TMP/headers.ok"
sed -i.bak "s#script-src 'self' 'unsafe-inline';#script-src 'self' 'unsafe-inline' https://esm.sh;#" "$SITE/html/.nginx/web3-security-headers.conf"
EXPECTED_SHA="$SHA" run 1 "$REPO/scripts/deploy-web3-site.sh" verify
grep -Fq "FAIL  CSP differs from infra/web3" <<< "$OUT"
cp "$TMP/headers.ok" "$SITE/html/.nginx/web3-security-headers.conf"
rm "$SITE/html/.nginx/web3-security-headers.conf.bak"
echo "tampered" >> "$SITE/html/web3-sw.js"
EXPECTED_SHA="$SHA" run 1 "$REPO/scripts/deploy-web3-site.sh" verify
grep -Fq "FAIL  /web3-sw.js" <<< "$OUT"

# --- web3: rollback restores the exact previous docroot and headers -------------
: > "$LOG"
run 1 "$REPO/scripts/deploy-web3-site.sh" rollback /etc
run 1 "$REPO/scripts/deploy-web3-site.sh" rollback "/opt/inferno/backups/web3-site-20260101T000000Z; touch $TMP/injected"
test ! -e "$TMP/injected" || { echo "FAIL: rollback path was executed as a command" >&2; exit 1; }
refute_log "ssh "                                    # invalid paths never reach the host
: > "$LOG"
run 0 "$REPO/scripts/deploy-web3-site.sh" rollback "/opt/inferno/backups/$(basename "$first_backup")"
diff -r "$TMP/site.before/html" "$SITE/html" || { echo "FAIL: rollback did not restore the docroot" >&2; exit 1; }
assert_log "nginx -s reload"

# --- benefits: env values that reach ssh and remote shell strings are allow-listed -
: > "$LOG"
for env in "SSH_HOST=web3-test-host;touch $TMP/injected" "SSH_HOST=-oProxyCommand=touch" "SSH_HOST=-Fconfig" "SSH_HOST=user/host" \
           "REMOTE_ROOT=/opt/inferno';touch $TMP/injected;'" "REMOTE_ROOT=opt/inferno" \
           "REMOTE_VOLUME=/mnt/v \$(touch $TMP/injected)" "REMOTE_VOLUME=-/mnt" \
           "REMOTE_COMPOSE_ENV_FILE=/opt/inferno/.env.benefits';touch $TMP/injected;'"; do
  for mode in frontend status capacity; do
    EXPECTED_SHA="$SHA" MIN_FREE_GB=0 run 64 env "$env" "$REPO/scripts/deploy-benefits-network.sh" "$mode"
    grep -Fq "${env%%=*} must" <<< "$OUT" || { echo "FAIL: $env not rejected by the guard" >&2; echo "$OUT" >&2; exit 1; }
  done
done
test ! -e "$TMP/injected" || { echo "FAIL: a rejected env value was executed" >&2; exit 1; }
assert_no_calls

# --- benefits: deploy modes require the exact clean release commit ---------------
: > "$LOG"
run 64 "$REPO/scripts/deploy-benefits-network.sh" frontend
EXPECTED_SHA=0000000000000000000000000000000000000000 run 65 "$REPO/scripts/deploy-benefits-network.sh" frontend
echo "dirty" >> "$REPO/apps/benefits-network/frontend/package.json"
EXPECTED_SHA="$SHA" run 65 "$REPO/scripts/deploy-benefits-network.sh" frontend
git -C "$REPO" checkout -q -- apps/benefits-network/frontend/package.json
refute_log "rsync"

# --- benefits: ignored or index-hidden files that sync_app would upload are refused -
APP="$REPO/apps/benefits-network"
echo "scratch.txt" >> "$REPO/.git/info/exclude"      # arbitrary ignore rule
mkdir -p "$APP/backend/coverage"
for f in frontend/.env.development.local backend/coverage/lcov.info scratch.txt; do
  echo "local only" > "$APP/$f"
  [[ -z "$(git -C "$REPO" status --porcelain -- apps/benefits-network)" ]] || { echo "FAIL: $f is not ignored" >&2; exit 1; }
  : > "$LOG"
  EXPECTED_SHA="$SHA" MIN_FREE_GB=0 REMOTE_VOLUME=/opt/inferno run 65 "$REPO/scripts/deploy-benefits-network.sh" frontend
  grep -Fxq "  $f" <<< "$OUT" || { echo "FAIL: $f not named in refusal" >&2; echo "$OUT" >&2; exit 1; }
  refute_log ":/opt/inferno/benefits-network"
  refute_log "docker"
  rm "$APP/$f"
done
echo "hidden edit" >> "$APP/frontend/package.json"
git -C "$REPO" update-index --assume-unchanged apps/benefits-network/frontend/package.json
: > "$LOG"
EXPECTED_SHA="$SHA" MIN_FREE_GB=0 REMOTE_VOLUME=/opt/inferno run 65 "$REPO/scripts/deploy-benefits-network.sh" frontend
grep -Fq "assume-unchanged or skip-worktree" <<< "$OUT"
refute_log "rsync"
git -C "$REPO" update-index --no-assume-unchanged apps/benefits-network/frontend/package.json
git -C "$REPO" checkout -q -- apps/benefits-network/frontend/package.json
# Intentional excludes never reach the host, so they may exist locally.
mkdir -p "$APP/frontend/node_modules/pkg" "$APP/frontend/.next/cache" "$APP/backend/dist"
for f in .env frontend/.env.local backend/.env.production backend/app.db backend/app.db-journal \
         frontend/node_modules/pkg/index.js frontend/.next/cache/x backend/dist/index.js; do
  echo "local only" > "$APP/$f"
done
EXPECTED_SHA="$SHA" MIN_FREE_GB=0 REMOTE_VOLUME=/opt/inferno run 0 "$REPO/scripts/deploy-benefits-network.sh" frontend
assert_log "--exclude .env --exclude"
assert_log "--exclude .env.local"
assert_log "--exclude *.db"
assert_log "--exclude *.db-wal"
assert_log "--dry-run --out-format=%n --exclude node_modules"
assert_log "up -d --build --no-deps benefits-frontend"
refute_log "prune"
# capacity stays usable without a release commit
REMOTE_VOLUME=/opt/inferno run 0 "$REPO/scripts/deploy-benefits-network.sh" capacity

echo "Release guards hold: web3 plan/deploy/verify/rollback and Benefits exact-SHA deploys"
