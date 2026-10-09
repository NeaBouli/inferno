#!/bin/sh
# Preparation: spec or plan. Real execution requires a private owner certificate and separate GO.
# No service is stopped, restarted, deployed, or queried by preparation commands.
set -eu
case "${1:-spec}" in
  spec|plan|execute) ;;
  *) printf '%s\n' '{"status":"HOLD","category":"INVALID_COMMAND","counts":{}}'; exit 78 ;;
esac
NODE_BIN="$(command -v node || true)"
case "$NODE_BIN" in
  /*) ;;
  *) printf '%s\n' '{"status":"HOLD","category":"NODE_UNAVAILABLE","counts":{}}'; exit 78 ;;
esac
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
if [ "$#" -eq 0 ]; then set -- spec; fi
exec /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent \
  "$NODE_BIN" --no-warnings "$SCRIPT_DIR/benefits-owner-b-rehearsal.cjs" "$@"
