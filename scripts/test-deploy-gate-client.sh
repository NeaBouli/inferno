#!/usr/bin/env bash
# T-257 tests for DEPLOY_MODE=gate in deploy-compose-service.sh, deploy-web3-site.sh and
# deploy-benefits-network.sh. A fake `ssh` stands in for the forced-command gate of
# inferno-deploy v2: it records the -F config, host alias, subcommand, args and the
# SHA-256 of stdin, enforces the gate's word rules and the upload checksum, and for
# web3-deploy unpacks the upload as the served docroot so the local public verify runs
# against exactly what was sent. curl is a fake. Nothing leaves this machine.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAKES="$TMP/bin"
LOG="$TMP/calls.log"
GATE_DIR="$TMP/gate"
FAKE_HOME="$TMP/home"
CFG="$FAKE_HOME/.fleet-ssh/config"
mkdir -p "$FAKES" "$GATE_DIR" "$FAKE_HOME/.fleet-ssh"
: > "$LOG"

# Clone the current commit and overlay the scripts under test, so the exact-SHA guards
# run against a real, clean checkout even before these edits are committed.
git clone -q --local "$ROOT" "$TMP/repo"
REPO="$TMP/repo"
for f in deploy-gate-lib.sh deploy-compose-service.sh deploy-web3-site.sh deploy-benefits-network.sh; do
  cp "$ROOT/scripts/$f" "$REPO/scripts/$f"
done
git -C "$REPO" add -A scripts
git -C "$REPO" -c user.name=test -c user.email=test@example.invalid commit -qm "test overlay" --allow-empty
SHA="$(git -C "$REPO" rev-parse HEAD)"
# Ignored local files must never reach an upload (the tar comes from the commit).
mkdir -p "$REPO/apps/benefits-network/node_modules/leak" "$REPO/apps/points-backend/node_modules/leak"
echo leak > "$REPO/apps/benefits-network/node_modules/leak/index.js"
echo leak > "$REPO/apps/points-backend/node_modules/leak/index.js"
echo "LOCAL_ONLY=1" > "$REPO/apps/benefits-network/.env"
[[ -z "$(git -C "$REPO" status --porcelain)" ]] || { echo "FAIL: test fixtures dirty the clone" >&2; exit 1; }

sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
# git archive <commit>:<dir> stamps the current time (a tree has no commit date), so two
# uploads of one release can differ in bytes; compare unpacked content instead.
same_tree() { # same_tree <tar> <tar>
  local a b
  a="$(mktemp -d "$TMP/a.XXXX")"; b="$(mktemp -d "$TMP/b.XXXX")"
  tar -C "$a" -xf "$1"; tar -C "$b" -xf "$2"
  diff -r "$a" "$b" >/dev/null
}

cat > "$FAKES/ssh" <<'EOF'
#!/usr/bin/env bash
# Gate mode: ssh -F <config> <alias> <words...>. Anything else is the direct path.
if [ "${1:-}" != -F ]; then
  printf 'direct ssh %s\n' "$*" >> "$LOG"
  echo 1
  exit 0
fi
cfg="$2" host="$3"; shift 3
(( $# >= 1 && $# <= 6 )) || { echo "gate: too many arguments" >&2; exit 64; }
for a in "$@"; do [[ "$a" =~ ^[A-Za-z0-9._:=@+-]{1,128}$ ]] || { echo "gate: forbidden characters" >&2; exit 64; }; done
stdin=-
case "$1" in
  service-plan|service-deploy|web3-plan|web3-deploy|benefits-deploy)
    cat > "$GATE_DIR/upload.tar"
    stdin="$(shasum -a 256 "$GATE_DIR/upload.tar" | cut -d' ' -f1)"
    case "$1" in web3-*) want="$3" ;; *) want="$4" ;; esac
    [ "$stdin" = "$want" ] || { echo "gate: tar sha256 mismatch" >&2; exit 65; }
    cp "$GATE_DIR/upload.tar" "$GATE_DIR/$1.tar"
    if [ "$1" = web3-deploy ]; then
      rm -rf "$GATE_DIR/html"; mkdir "$GATE_DIR/html"; tar -C "$GATE_DIR/html" -xf "$GATE_DIR/upload.tar"
    fi
    ;;
esac
printf 'gate cfg=%s host=%s args=%s stdin=%s\n' "$cfg" "$host" "$*" "$stdin" >> "$LOG"
if [ "${GATE_FAIL:-}" = "$1" ]; then echo "gate: $1 failed" >&2; exit 1; fi
echo "gate ok: $1"
EOF
# curl: compose health codes per host; web3 files from the unpacked upload, CSP from its headers file.
cat > "$FAKES/curl" <<'EOF'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$LOG"
url="${@: -1}"
case "$url" in
  https://points-api.*)   printf '%s' "${POINTS_CODE:-200}"; exit 0 ;;
  https://copilot-api.*)  printf 200; exit 0 ;;
  https://verify-api.*)   printf 404; exit 0 ;;
esac
path="${url#https://web3.ifrunit.tech/}"; path="${path%%\?*}"
html="$GATE_DIR/html"
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
  : > "$LOG"
  set +e
  OUT="$(PATH="$FAKES:$PATH" HOME="$FAKE_HOME" LOG="$LOG" GATE_DIR="$GATE_DIR" DEPLOY_MODE="${DEPLOY_MODE-gate}" "$@" 2>&1)"
  local status=$?
  set -e
  if [[ "$status" != "$expected" ]]; then
    echo "FAIL: expected exit $expected, got $status: $*" >&2
    echo "$OUT" >&2
    exit 1
  fi
}
assert_log() { grep -Fq -- "$1" "$LOG" || { echo "FAIL: log lacks: $1" >&2; cat "$LOG" >&2; exit 1; }; }
refute_log() { if grep -Fq -- "$1" "$LOG"; then echo "FAIL: log has: $1" >&2; cat "$LOG" >&2; exit 1; fi; }
assert_out() { grep -Fq -- "$1" <<< "$OUT" || { echo "FAIL: output lacks: $1" >&2; echo "$OUT" >&2; exit 1; }; }
gate_line() { printf 'gate cfg=%s host=hetzner-deploy args=%s' "$CFG" "$1"; }

COMPOSE="$REPO/scripts/deploy-compose-service.sh"
WEB3="$REPO/scripts/deploy-web3-site.sh"
BENEFITS="$REPO/scripts/deploy-benefits-network.sh"
STAMP=20261005T101010Z
VAULT=0x00000000000000000000000000000000000000aa

# --- compose service ------------------------------------------------------------
git -C "$REPO" archive --format=tar "$SHA:apps/points-backend" > "$TMP/points.tar"

run 0 env EXPECTED_SHA="$SHA" bash "$COMPOSE" points-backend plan
POINTS_TSHA="$(sha256 "$GATE_DIR/service-plan.tar")"
assert_log "$(gate_line "service-plan points-backend $SHA $POINTS_TSHA") stdin=$POINTS_TSHA"
same_tree "$TMP/points.tar" "$GATE_DIR/service-plan.tar" || { echo "FAIL: service upload is not git archive $SHA:apps/points-backend" >&2; exit 1; }
tar -tf "$GATE_DIR/service-plan.tar" | grep -qx Dockerfile || { echo "FAIL: Dockerfile not at the tar root" >&2; exit 1; }
if tar -tf "$GATE_DIR/service-plan.tar" | grep -q -e node_modules/leak -e RELEASE_SHA; then echo "FAIL: upload holds local or generated files" >&2; exit 1; fi
refute_log "curl "

run 0 env EXPECTED_SHA="$SHA" bash "$COMPOSE" points-backend deploy
POINTS_TSHA="$(sha256 "$GATE_DIR/service-deploy.tar")"
assert_log "$(gate_line "service-deploy points-backend $SHA $POINTS_TSHA") stdin=$POINTS_TSHA"
assert_log "curl -sS -o /dev/null -w %{http_code} --max-time 15 https://points-api.ifrunit.tech/health"
assert_out "verified: points-backend public checks pass"
refute_log "direct ssh"

# The host tool already rolled back on its own checks; a failing local verify still fails the run.
run 1 env EXPECTED_SHA="$SHA" POINTS_CODE=502 bash "$COMPOSE" points-backend deploy
assert_log "args=service-deploy points-backend"
assert_out "roll back with: DEPLOY_MODE=gate"

# A failed gate deploy stops before the public verify.
run 1 env EXPECTED_SHA="$SHA" GATE_FAIL=service-deploy bash "$COMPOSE" points-backend deploy
refute_log "curl "

# Exact-SHA guards hold before anything reaches the gate.
run 1 env EXPECTED_SHA="${SHA:0:12}" bash "$COMPOSE" points-backend plan
refute_log "gate "
echo dirty >> "$REPO/apps/points-backend/README.md"
run 1 env EXPECTED_SHA="$SHA" bash "$COMPOSE" points-backend deploy
assert_out "working tree is dirty"
refute_log "gate "
git -C "$REPO" checkout -q -- apps/points-backend/README.md

run 0 bash "$COMPOSE" points-backend rollback "/opt/inferno/backups/points-backend-$STAMP"
assert_log "$(gate_line "service-rollback points-backend $STAMP") stdin=-"
run 0 bash "$COMPOSE" telegram-bot rollback "$STAMP"
assert_log "args=service-rollback telegram-bot $STAMP"
run 64 bash "$COMPOSE" telegram-bot rollback "20261005-bad"
refute_log "gate "

run 0 bash "$COMPOSE" ai-copilot status;  assert_log "args=status stdin=-"
run 0 bash "$COMPOSE" ai-copilot health;  assert_log "args=health ai-copilot stdin=-"
run 0 bash "$COMPOSE" ai-copilot logs 50; assert_log "args=logs ai-copilot 50 stdin=-"
run 0 bash "$COMPOSE" ai-copilot backups; assert_log "args=backups ai-copilot stdin=-"
run 64 bash "$COMPOSE" ai-copilot logs '50;id'
refute_log "gate "
run 0 env DEPLOY_GATE_HOST=other-gate bash "$COMPOSE" ai-copilot status
assert_log "host=other-gate args=status"
run 64 env DEPLOY_GATE_HOST=-oProxyCommand=x bash "$COMPOSE" ai-copilot status
refute_log "gate "

DEPLOY_MODE=bogus run 1 bash "$COMPOSE" ai-copilot status
assert_out "DEPLOY_MODE must be unset"
refute_log "ssh "
# Default mode is unchanged: no gate, verify is public HTTP only.
DEPLOY_MODE='' run 0 bash "$COMPOSE" points-backend verify
refute_log "gate "
DEPLOY_MODE='' run 1 bash "$COMPOSE" points-backend status
assert_out "unknown mode status"

# --- web3 site ------------------------------------------------------------------
run 0 env EXPECTED_SHA="$SHA" bash "$WEB3" plan
WEB3_TSHA="$(sha256 "$GATE_DIR/web3-plan.tar")"
assert_log "$(gate_line "web3-plan $SHA $WEB3_TSHA") stdin=$WEB3_TSHA"
tar -tf "$GATE_DIR/web3-plan.tar" | grep -qx './.nginx/web3-security-headers.conf' \
  || { echo "FAIL: headers file not at the web3 tar root" >&2; exit 1; }
if tar -tf "$GATE_DIR/web3-plan.tar" | grep -q '/\._'; then echo "FAIL: AppleDouble members in the web3 upload" >&2; exit 1; fi
mkdir "$TMP/stage"
node "$REPO/scripts/web3-release.cjs" stage "$SHA" "$TMP/stage" >/dev/null
mkdir "$TMP/unpacked"; tar -C "$TMP/unpacked" -xf "$GATE_DIR/web3-plan.tar"
diff -r "$TMP/stage/html" "$TMP/unpacked" >/dev/null || { echo "FAIL: web3 upload differs from the staged docroot" >&2; exit 1; }

# Staging sets fresh mtimes, so every web3 upload has its own sha256; the gate checks each one.
run 0 env EXPECTED_SHA="$SHA" DELETE=1 bash "$WEB3" plan
WEB3_TSHA="$(sha256 "$GATE_DIR/web3-plan.tar")"
assert_log "args=web3-plan $SHA $WEB3_TSHA delete stdin=$WEB3_TSHA"

run 0 env EXPECTED_SHA="$SHA" bash "$WEB3" deploy
WEB3_TSHA="$(sha256 "$GATE_DIR/web3-deploy.tar")"
assert_log "$(gate_line "web3-deploy $SHA $WEB3_TSHA") stdin=$WEB3_TSHA"
assert_out "ok    CSP matches infra/web3"
assert_out "verified: https://web3.ifrunit.tech serves $SHA"
refute_log "direct ssh"

# The verify reads what the gate serves: a docroot that drifted after the deploy fails it.
echo drift > "$GATE_DIR/html/sitemap.xml"
run 1 env EXPECTED_SHA="$SHA" bash "$WEB3" verify
assert_out "FAIL  /sitemap.xml"
refute_log "gate "

run 0 bash "$WEB3" rollback "/opt/inferno/backups/web3-site-$STAMP"
assert_log "$(gate_line "web3-rollback $STAMP") stdin=-"
run 64 bash "$WEB3" rollback
refute_log "gate "
run 0 bash "$WEB3" status;  assert_log "args=status stdin=-"
run 0 bash "$WEB3" health;  assert_log "args=health web3-site stdin=-"
run 0 bash "$WEB3" backups; assert_log "args=backups web3-site stdin=-"

# --- benefits network -----------------------------------------------------------
git -C "$REPO" archive --format=tar "$SHA:apps/benefits-network" > "$TMP/benefits.tar"

run 0 env EXPECTED_SHA="$SHA" bash "$BENEFITS" frontend
BENEFITS_TSHA="$(sha256 "$GATE_DIR/benefits-deploy.tar")"
assert_log "$(gate_line "benefits-deploy frontend $SHA $BENEFITS_TSHA allow-prune") stdin=$BENEFITS_TSHA"
same_tree "$TMP/benefits.tar" "$GATE_DIR/benefits-deploy.tar" || { echo "FAIL: benefits upload is not git archive $SHA:apps/benefits-network" >&2; exit 1; }
if tar -tf "$GATE_DIR/benefits-deploy.tar" | grep -q -e node_modules/leak -e '^\.env$'; then echo "FAIL: ignored local files in the benefits upload" >&2; exit 1; fi
refute_log "direct ssh"

run 0 env EXPECTED_SHA="$SHA" ALLOW_PRUNE=0 bash "$BENEFITS" all
BENEFITS_TSHA="$(sha256 "$GATE_DIR/benefits-deploy.tar")"
assert_log "args=benefits-deploy all $SHA $BENEFITS_TSHA stdin=$BENEFITS_TSHA"

run 64 bash "$BENEFITS" backend
refute_log "gate "
git -C "$REPO" -c user.name=test -c user.email=test@example.invalid commit -qm "newer" --allow-empty
run 65 env EXPECTED_SHA="$SHA" bash "$BENEFITS" backend
assert_out "HEAD is not $SHA"
refute_log "gate "
git -C "$REPO" reset -q --hard "$SHA"

run 0 bash "$BENEFITS" status;   assert_log "$(gate_line benefits-status) stdin=-"
run 0 bash "$BENEFITS" capacity; assert_log "args=benefits-status stdin=-"

run 0 bash "$BENEFITS" env-vault-v2 "$VAULT"
assert_log "$(gate_line "env-set .env.benefits COMMITMENT_VAULT_V2_ADDRESS $VAULT") stdin=-"
run 64 bash "$BENEFITS" env-vault-v2 "0x1234"
refute_log "gate "
DEPLOY_MODE='' run 64 bash "$BENEFITS" env-vault-v2 "$VAULT"
refute_log "ssh "
# Default mode is unchanged: status still uses the direct ssh path.
DEPLOY_MODE='' run 0 env SSH_HOST=direct-test-host bash "$BENEFITS" status
assert_log "direct ssh direct-test-host"
refute_log "gate "

echo "deploy gate client tests passed"
