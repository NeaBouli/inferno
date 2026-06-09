#!/bin/bash
# INFERNO — Auto-Watcher: Proposal #15 feeExempt(LP)
# Wartet bis 2026-06-08T06:57:59 UTC + 60s Buffer
# execute() ist onlyOwner (TreasurySafe) — kann nicht auto-ausgeführt werden
# → Benachrichtigt Gio + zeigt TreasurySafe Calldata

REPO="/Users/gio/Desktop/repos/inferno"
LOG="$REPO/logs/proposal15-watcher-$(date -u +%Y%m%d-%H%M%S).log"
mkdir -p "$REPO/logs"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1" | tee -a "$LOG"; }
notify() { osascript -e "display notification \"$1\" with title \"INFERNO 🔥\" sound name \"Glass\"" 2>/dev/null; }

log "========================================"
log "  PROPOSAL #15 WATCHER STARTED"
log "  PID: $$"
log "  Log: $LOG"
log "========================================"
log "  ETA: 2026-06-08T06:57:59 UTC"
log "  = 09:57:59 Athen"
log "========================================"

TARGET_TS=$(python3 -c "
from datetime import datetime, timezone
t = datetime(2026, 6, 8, 6, 57, 59, tzinfo=timezone.utc)
import time; print(int(t.timestamp()))
")
NOW_TS=$(python3 -c "import time; print(int(time.time()))")
SLEEP_SECS=$((TARGET_TS - NOW_TS + 60))  # +60s Buffer

if [ "$SLEEP_SECS" -gt 0 ]; then
  HOURS=$((SLEEP_SECS / 3600))
  log "Sleeping ${SLEEP_SECS}s (~${HOURS}h) bis Timelock abläuft..."
  notify "Proposal #15 Watcher aktiv — wacht ${HOURS}h bis 08.06. 09:57 Athen"
  sleep "$SLEEP_SECS"
fi

log "========================================"
log "  TIMELOCK ABGELAUFEN — On-chain Check"
log "========================================"

cd "$REPO" || exit 1
node -e "
require('dotenv').config();
const{ethers}=require('ethers');
const provider=new ethers.providers.JsonRpcProvider(process.env.MAINNET_RPC_URL);
const GOV='0xc43d48E7FDA576C5022d0670B652A622E8caD041';
const IFR='0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const LP='0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0';
const govAbi=['function proposals(uint256) view returns (address target, bytes data, uint256 eta, bool executed, bool cancelled)'];
const tokAbi=['function feeExempt(address) view returns (bool)'];
(async()=>{
  const gov=new ethers.Contract(GOV,govAbi,provider);
  const tok=new ethers.Contract(IFR,tokAbi,provider);
  const [p, exempt] = await Promise.all([gov.proposals(15), tok.feeExempt(LP)]);
  const now=Math.floor(Date.now()/1000);
  const eta=p.eta.toNumber();
  console.log('Proposal #15:');
  console.log('  executed:  ', p.executed);
  console.log('  cancelled: ', p.cancelled);
  console.log('  eta:       ', new Date(eta*1000).toISOString());
  console.log('  ready:     ', now>=eta ? 'YES' : 'NO ('+Math.ceil((eta-now)/60)+'min remaining)');
  console.log('LP feeExempt:', exempt, exempt?'ALREADY DONE':'ACTION NEEDED');
})().catch(e=>console.error(e.message));
" 2>&1 | grep -v "tip:" | tee -a "$LOG"

log "========================================"
log "  AKTION ERFORDERLICH — TreasurySafe"
log "========================================"
log "  Gnosis Safe UI: https://app.safe.global"
log "  Safe:     0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b"
log "  New Transaction → Contract Interaction:"
log "  To:       0xc43d48E7FDA576C5022d0670B652A622E8caD041"
log "  Value:    0"
log "  Data:     0xfe0d94c1000000000000000000000000000000000000000000000000000000000000000f"
log "  = execute(proposalId=15)"
log "========================================"
log "  Nach Execute: IFR auf Uniswap handelbar!"
log "========================================"

notify "⏰ Proposal #15 READY — TreasurySafe execute(15) jetzt! Log: $LOG"
