#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SSH_LOG="$TMP_DIR/ssh.log"
FAKE_SSH="$TMP_DIR/ssh"

cat > "$FAKE_SSH" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$SSH_LOG"
if [[ "$*" == *"df -BM --output=avail"* ]]; then
  printf '3098\n'
elif [[ "$*" == *"docker compose --env-file "*" ps -aq benefits-backend"* ]]; then
  printf '%s\n' "${BACKEND_COUNT:-1}"
else
  printf 'fake remote status ok\n'
fi
EOF
chmod +x "$FAKE_SSH"

OUTPUT="$({
  PATH="$TMP_DIR:$PATH" \
  SSH_LOG="$SSH_LOG" \
  SSH_HOST="capacity-test" \
  REMOTE_VOLUME="/test-volume" \
  "$ROOT/scripts/deploy-benefits-network.sh" capacity
} 2>&1)"

if grep -Eq 'docker (builder|container|image) prune' "$SSH_LOG"; then
  echo "capacity mode attempted a Docker prune" >&2
  exit 1
fi

grep -Fq 'below MIN_FREE_GB=4G' <<< "$OUTPUT"
grep -Fq -- "--env-file '/opt/inferno/.env.benefits'" "$SSH_LOG"
grep -Fq 'ps -aq benefits-backend' "$SSH_LOG"
grep -Fq 'ps benefits-backend benefits-frontend' "$SSH_LOG"
grep -Fq "docker compose --env-file '\$REMOTE_COMPOSE_ENV_FILE' \$*" \
  "$ROOT/scripts/deploy-benefits-network.sh"

set +e
UNSAFE_OUTPUT="$({
  PATH="$TMP_DIR:$PATH" \
  SSH_LOG="$SSH_LOG" \
  SSH_HOST="capacity-test" \
  REMOTE_VOLUME="/test-volume" \
  BACKEND_COUNT="2" \
  "$ROOT/scripts/deploy-benefits-network.sh" capacity
} 2>&1)"
UNSAFE_STATUS=$?
set -e

if [[ "$UNSAFE_STATUS" -ne 78 ]]; then
  echo "Expected multi-replica capacity check to exit 78, got $UNSAFE_STATUS" >&2
  exit 1
fi
grep -Fq 'current SQLite topology permits exactly one' <<< "$UNSAFE_OUTPUT"
echo "Benefits capacity mode is read-only"
