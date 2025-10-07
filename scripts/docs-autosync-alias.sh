#!/bin/bash
# 🪶 Inferno Docs AutoSync (manual alias version)

# Automatische Pfad-Erkennung
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/docs-autosync.log"

echo "🪶 Starting Docs AutoSync alias..."
echo "ROOT_DIR: $ROOT_DIR"

# Sicherstellen, dass das Log-Verzeichnis existiert
mkdir -p "$LOG_DIR"

# Logdatei anlegen, falls sie fehlt
if [ ! -f "$LOG_FILE" ]; then
  echo "🆕 Creating log file at $LOG_FILE"
  touch "$LOG_FILE"
fi

# Protokoll starten
echo "[\$(date -Iseconds)] <0001f9e9> Running Docs AutoSync (alias mode)..." | tee -a "$LOG_FILE"

# Node-Skript ausführen, falls vorhanden
if [ -f "$ROOT_DIR/scripts/docs-autosync.js" ]; then
  node "$ROOT_DIR/scripts/docs-autosync.js" >> "$LOG_FILE" 2>&1
else
  echo "⚠️  Missing $ROOT_DIR/scripts/docs-autosync.js" | tee -a "$LOG_FILE"
fi

# Abschlussmeldung
echo "[\$(date -Iseconds)] ✅ Docs AutoSync completed (alias mode)." | tee -a "$LOG_FILE"
echo "🪶 Done. Log written to $LOG_FILE"
