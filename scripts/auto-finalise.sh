#!/bin/bash
# INFERNO — Auto-Finalise Runner
# Wartet bis 2026-06-05T23:50:23 UTC, dann finalise() + feeExempt Proposal

REPO="/Users/gio/Desktop/repos/inferno"
LOG="$REPO/logs/auto-finalise-$(date -u +%Y%m%d-%H%M%S).log"
mkdir -p "$REPO/logs"

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1" | tee -a "$LOG"
}

notify() {
  osascript -e "display notification \"$1\" with title \"INFERNO 🔥\" sound name \"Glass\"" 2>/dev/null
}

log "========================================"
log "  INFERNO AUTO-FINALISE STARTED"
log "  PID: $$"
log "  Log: $LOG"
log "========================================"

# Countdown bis endTime
TARGET_TS=$(python3 -c "
from datetime import datetime, timezone
t = datetime(2026, 6, 5, 23, 50, 23, tzinfo=timezone.utc)
import time; print(int(t.timestamp()))
")
NOW_TS=$(python3 -c "import time; print(int(time.time()))")
SLEEP_SECS=$((TARGET_TS - NOW_TS))

if [ "$SLEEP_SECS" -gt 0 ]; then
  log "Sleeping ${SLEEP_SECS}s bis 2026-06-05T23:50:23 UTC..."
  notify "Auto-Finalise gestartet — läuft in ${SLEEP_SECS}s automatisch"
  sleep "$SLEEP_SECS"
fi

# 30s Buffer — sicherstellen dass Block on-chain ist
log "endTime erreicht. 30s Buffer..."
sleep 30

log "========================================"
log "  SCHRITT 1 — Status Check"
log "========================================"
cd "$REPO" || exit 1
node scripts/check-bootstrap-status.js 2>&1 | tee -a "$LOG"

log "========================================"
log "  SCHRITT 2 — finalise()"
log "========================================"
npx hardhat run scripts/finalise-bootstrap.js --network mainnet 2>&1 | tee -a "$LOG"

FINALISE_EXIT=$?
if [ $FINALISE_EXIT -ne 0 ]; then
  log "❌ FEHLER: finalise() exit code $FINALISE_EXIT"
  notify "❌ FEHLER bei finalise() — Log prüfen: $LOG"
  exit 1
fi

log "✅ finalise() erfolgreich"
notify "✅ finalise() SUCCESS — starte feeExempt Proposal..."

# 15s warten bevor Proposal
sleep 15

log "========================================"
log "  SCHRITT 3 — Uniswap Pool feeExempt Proposal"
log "========================================"
npx hardhat run scripts/propose-pool-feeexempt.js --network mainnet 2>&1 | tee -a "$LOG"

PROPOSAL_EXIT=$?
if [ $PROPOSAL_EXIT -ne 0 ]; then
  log "❌ FEHLER: propose-pool-feeexempt exit code $PROPOSAL_EXIT"
  notify "⚠️ feeExempt Proposal FEHLER — finalise() war OK! Log: $LOG"
else
  log "✅ feeExempt Proposal submitted"
  notify "🔥 BOOTSTRAP ABGESCHLOSSEN — finalise() + Proposal OK! Log: $LOG"
fi

log "========================================"
log "  FERTIG $(date -u)"
log "  Log: $LOG"
log "========================================"
