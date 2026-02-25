#!/bin/bash
# IFR Benefits Network — E2E Test Script (Sepolia)
# Usage: bash apps/benefits-network/backend/scripts/e2e-test.sh
set -e

BASE_URL="${BASE_URL:-http://localhost:3001}"
ADMIN_SECRET="${ADMIN_SECRET:-change-me-to-a-random-secret}"

echo "============================================================"
echo "  IFR Benefits Network — E2E Test"
echo "============================================================"
echo "  Base URL: $BASE_URL"
echo ""

# 1. Health Check
echo "1. Health Check..."
curl -sf "$BASE_URL/health" | python3 -m json.tool 2>/dev/null || curl -sf "$BASE_URL/health"
echo ""
echo "  OK"
echo ""

# 2. Admin: Business anlegen
echo "2. Business anlegen..."
BIZ=$(curl -sf -X POST "$BASE_URL/api/admin/businesses" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"name":"E2E Test Business","discountPercent":15,"requiredLockIFR":1000,"tierLabel":"Bronze"}')
echo "$BIZ" | python3 -m json.tool 2>/dev/null || echo "$BIZ"
BIZ_ID=$(echo "$BIZ" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "unknown")
echo "  Business ID: $BIZ_ID"
echo ""

# 3. QR Session starten
echo "3. QR Session starten..."
SESSION=$(curl -sf -X POST "$BASE_URL/api/verification/start" \
  -H "Content-Type: application/json" \
  -d "{\"businessId\":\"$BIZ_ID\"}")
echo "$SESSION" | python3 -m json.tool 2>/dev/null || echo "$SESSION"
SESSION_ID=$(echo "$SESSION" | python3 -c "import sys,json; print(json.load(sys.stdin)['sessionId'])" 2>/dev/null || echo "unknown")
echo "  Session ID: $SESSION_ID"
echo ""

# 4. Session Status pruefen
echo "4. Session Status..."
curl -sf "$BASE_URL/api/verification/status/$SESSION_ID" | python3 -m json.tool 2>/dev/null || curl -sf "$BASE_URL/api/verification/status/$SESSION_ID"
echo ""
echo "  OK"
echo ""

echo "============================================================"
echo "  E2E Test abgeschlossen"
echo "============================================================"
echo "  Session $SESSION_ID bereit fuer Wallet-Scan"
echo "  Frontend: http://localhost:3000/r/$SESSION_ID"
echo ""
