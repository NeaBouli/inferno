#!/bin/bash
# IFR Benefits Network — Local Full-Stack E2E Wrapper
# Usage: bash apps/benefits-network/backend/scripts/e2e-test.sh
#
# This script is a safe wrapper around the canonical local full-stack E2E
# gate (`npm run test:benefits-fullstack`, implemented by
# scripts/test-benefits-fullstack-e2e.js). It takes no URL, admin secret or
# wallet input, uses only loopback servers with a disposable SQLite database
# and fails closed when it is not run inside a fully installed repository.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

[ -f "$REPO_ROOT/package.json" ] \
  || fail "package.json not found; run this script inside the inferno repository"
grep -q '"test:benefits-fullstack"' "$REPO_ROOT/package.json" \
  || fail "package.json has no test:benefits-fullstack gate; repository layout changed"
[ -f "$REPO_ROOT/scripts/test-benefits-fullstack-e2e.js" ] \
  || fail "scripts/test-benefits-fullstack-e2e.js is missing"
command -v node >/dev/null 2>&1 \
  || fail "node is not installed"
[ -d "$REPO_ROOT/node_modules" ] \
  || fail "root dependencies missing; run npm ci at the repository root"
[ -d "$REPO_ROOT/apps/benefits-network/backend/node_modules" ] \
  || fail "backend dependencies missing; run npm ci in apps/benefits-network/backend"
[ -d "$REPO_ROOT/apps/benefits-network/frontend/node_modules" ] \
  || fail "frontend dependencies missing; run npm ci in apps/benefits-network/frontend"

echo "============================================================"
echo "  IFR Benefits Network — Local Full-Stack E2E (loopback only)"
echo "============================================================"
echo "  Delegating to the canonical gate: npm run test:benefits-fullstack"
echo "  No external URL, admin secret, real wallet or network target is used."
echo ""

cd "$REPO_ROOT"
exec npm run test:benefits-fullstack
