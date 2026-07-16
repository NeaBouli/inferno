#!/usr/bin/env bash
set -euo pipefail

export CHAIN_ID="${CHAIN_ID:-11155111}"
export RPC_URL="${RPC_URL:-https://mock-rpc.example.com}"
export IFRLOCK_ADDRESS="${IFRLOCK_ADDRESS:-0x0000000000000000000000000000000000000001}"
export ADMIN_SECRET="${ADMIN_SECRET:-ci-admin-secret}"
export DATABASE_URL="${DATABASE_URL:-file:./test.db}"
export PORT="${PORT:-3001}"

LOG_FILE="${TMPDIR:-/tmp}/ifr-benefits-backend-smoke.log"

node dist/index.js >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
  wait "$SERVER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    BENEFITS_BASE_URL="http://127.0.0.1:${PORT}" node scripts/seller-wallet-smoke.js
    exit 0
  fi
  sleep 0.5
done

echo "Backend did not become healthy on port ${PORT}." >&2
cat "$LOG_FILE" >&2 || true
exit 1
