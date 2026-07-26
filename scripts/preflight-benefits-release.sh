#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/apps/benefits-network/frontend"
BACKEND="$ROOT/apps/benefits-network/backend"
MODE="${1:---full}"
REQUIRE_CLEAN="${BENEFITS_PREFLIGHT_REQUIRE_CLEAN:-1}"
SERVER_PID=""
SERVER_LOG="$(mktemp "${TMPDIR:-/tmp}/benefits-preflight-server.XXXXXX.log")"
PREFLIGHT_DB_NAME=".benefits-preflight-${$}-${RANDOM}.db"
PREFLIGHT_DB_PATH="$BACKEND/prisma/$PREFLIGHT_DB_NAME"

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    pkill -TERM -P "$SERVER_PID" >/dev/null 2>&1 || true
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$SERVER_LOG"
  rm -f "$PREFLIGHT_DB_PATH" "$PREFLIGHT_DB_PATH-journal"
}
trap cleanup EXIT

case "$MODE" in
  --static|--full) ;;
  *)
    echo "Usage: $0 [--static|--full]" >&2
    exit 64
    ;;
esac

run() {
  local label="$1"
  shift
  printf '\n[benefits-preflight] RUN  %s\n' "$label"
  "$@"
  printf '[benefits-preflight] PASS %s\n' "$label"
}

cd "$ROOT"

if [[ "$REQUIRE_CLEAN" == "1" ]]; then
  dirty="$(git status --porcelain --untracked-files=normal)"
  if [[ -n "$dirty" ]]; then
    echo "[benefits-preflight] FAIL tracked or untracked repository changes are present:" >&2
    printf '%s\n' "$dirty" >&2
    exit 2
  fi
fi

printf '[benefits-preflight] mode=%s head=%s ahead=%s\n' \
  "${MODE#--}" \
  "$(git rev-parse --short=8 HEAD)" \
  "$(git rev-list --count origin/main..HEAD 2>/dev/null || printf 'unknown')"

run "git diff check" git diff --check
run "device checklist schema and capability coverage" node scripts/validate-benefits-device-checklist.js
run "device checklist fail-closed tests" node scripts/test-benefits-device-checklist.js
run "device acceptance report" node scripts/report-benefits-device-checklist.js
run "documentation consistency" node scripts/test-benefits-doc-consistency.cjs
run "Node 22 runtime contract" node scripts/test-benefits-node-runtime.cjs
run "service worker contract" node scripts/test-benefits-service-worker.js
run "wallet asset provider contract" node scripts/test-benefits-wallet-asset-provider.mjs
run "read-only deploy capacity harness" bash scripts/test-deploy-benefits-capacity.sh

for script in \
  scripts/validate-benefits-device-checklist.js \
  scripts/report-benefits-device-checklist.js \
  scripts/record-benefits-device-evidence.js \
  scripts/test-benefits-device-checklist.js \
  scripts/test-benefits-doc-consistency.cjs \
  scripts/test-benefits-bundle-budget.cjs \
  scripts/test-benefits-route-recovery.js \
  scripts/test-benefits-csp.js \
  scripts/test-benefits-fullstack-e2e.js
do
  run "syntax $script" node --check "$script"
done
run "syntax scripts/preflight-benefits-release.sh" bash -n scripts/preflight-benefits-release.sh

if [[ "$MODE" == "--static" ]]; then
  printf '\n[benefits-preflight] PASS static release evidence gates\n'
  exit 0
fi

for directory in "$ROOT/node_modules" "$FRONTEND/node_modules" "$BACKEND/node_modules"; do
  if [[ ! -d "$directory" ]]; then
    echo "[benefits-preflight] FAIL missing dependencies at $directory; run the matching npm ci first." >&2
    exit 2
  fi
done

run "frontend dependency audit" npm --prefix "$FRONTEND" audit --audit-level=low
run "frontend proof-link contract" npm --prefix "$FRONTEND" run test:proof-link
run "frontend discoverability contract" npm --prefix "$FRONTEND" run test:discoverability
run "frontend wallet connector selection" npm --prefix "$FRONTEND" run test:wallet-selection
run "frontend TypeScript" npm --prefix "$FRONTEND" run typecheck
run "frontend production build" npm --prefix "$FRONTEND" run build
run "frontend bundle budget" node scripts/test-benefits-bundle-budget.cjs

run "backend dependency audit" npm --prefix "$BACKEND" audit --audit-level=low
run "backend Prisma client" npm --prefix "$BACKEND" run prisma:generate
(umask 077; : > "$PREFLIGHT_DB_PATH")
run "backend migration deploy" env "DATABASE_URL=file:./$PREFLIGHT_DB_NAME" npm --prefix "$BACKEND" run prisma:deploy
run "backend TypeScript" npm --prefix "$BACKEND" run typecheck
run "backend populated migration upgrade" npm --prefix "$BACKEND" run test:migration-upgrade
run "backend test suite" npm --prefix "$BACKEND" test
run "backend Ethers lifecycle" npm --prefix "$BACKEND" run test:ethers-v6-lifecycle
run "backend production build" npm --prefix "$BACKEND" run build
run "backend rate-limit startup" npm --prefix "$BACKEND" run test:rate-limit-startup
run "backend HTTP smoke" npm --prefix "$BACKEND" run smoke:http

# These harnesses use next start; later dev-server suites rewrite .next.
run "seller-loader recovery" npm run test:benefits-seller-loader
run "offline launcher shell" npm run test:benefits-offline
run "money formatting contract" npm run test:benefits-money
run "customer-pass browser flow" npm run test:benefits-pass-ui
run "offer discovery browser flow" npm run test:benefits-discovery-ui
run "wallet lock browser flow" npm run test:benefits-wallet-ui
run "composed fullstack flow" npm run test:benefits-fullstack

run "final frontend production build" npm --prefix "$FRONTEND" run build
if ! node -e '
  const net = require("net");
  const server = net.createServer();
  server.once("error", () => process.exit(1));
  server.listen(3000, "127.0.0.1", () => server.close(() => process.exit(0)));
'; then
  echo "[benefits-preflight] FAIL port 3000 is already occupied; stop the existing server before retrying." >&2
  exit 2
fi
npm --prefix "$FRONTEND" start >"$SERVER_LOG" 2>&1 &
SERVER_PID="$!"

ready=0
for _ in $(seq 1 60); do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    cat "$SERVER_LOG" >&2
    echo "[benefits-preflight] FAIL frontend server exited before readiness" >&2
    exit 1
  fi
  if curl -fsS http://127.0.0.1:3000/ >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  cat "$SERVER_LOG" >&2
  echo "[benefits-preflight] FAIL frontend server did not become ready" >&2
  exit 1
fi

run "WCAG desktop/tablet/mobile gate" env BENEFITS_BASE_URL=http://127.0.0.1:3000 npm run test:benefits-a11y
run "route recovery browser gate" env BENEFITS_BASE_URL=http://127.0.0.1:3000 npm run test:benefits-recovery
run "CSP compatibility gate" env BENEFITS_BASE_URL=http://127.0.0.1:3000 npm run test:benefits-csp

printf '\n[benefits-preflight] PASS full local release preflight\n'
