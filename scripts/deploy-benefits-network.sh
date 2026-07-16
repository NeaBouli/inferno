#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-frontend}"
SSH_HOST="${SSH_HOST:-hetzner}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/inferno}"
LOCAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_APP="$LOCAL_ROOT/apps/benefits-network/"
REMOTE_APP="$REMOTE_ROOT/benefits-network/"
MIN_FREE_GB="${MIN_FREE_GB:-4}"
MIN_FREE_MB="$((MIN_FREE_GB * 1024))"
REMOTE_VOLUME="${REMOTE_VOLUME:-/mnt/HC_Volume_106164848}"

case "$MODE" in
  frontend|backend|all|status) ;;
  *)
    echo "Usage: $0 [frontend|backend|all|status]" >&2
    exit 64
    ;;
esac

remote() {
  ssh "$SSH_HOST" "$@"
}

free_mb() {
  remote "df -BM --output=avail '$REMOTE_VOLUME' | tail -1 | tr -dc '0-9'"
}

ensure_space() {
  local free
  free="$(free_mb)"
  if [[ -z "$free" ]]; then
    echo "Could not determine free disk space for $REMOTE_VOLUME" >&2
    exit 1
  fi

  if (( free < MIN_FREE_MB )); then
    echo "Only ${free}M free on $REMOTE_VOLUME; pruning Docker builder cache."
    remote "docker builder prune -af >/dev/null && df -h '$REMOTE_VOLUME'"
  fi
}

sync_app() {
  rsync -az --delete \
    --exclude node_modules \
    --exclude .next \
    --exclude dist \
    --exclude test.db \
    --exclude dev.db \
    "$LOCAL_APP" "$SSH_HOST:$REMOTE_APP"
}

compose() {
  remote "cd '$REMOTE_ROOT' && docker compose $*"
}

wait_healthy() {
  local container="$1"
  local attempts="${2:-30}"
  remote "
    for i in \$(seq 1 '$attempts'); do
      status=\$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' '$container' 2>/dev/null || true)
      if [ \"\$status\" = healthy ] || [ \"\$status\" = running ]; then
        exit 0
      fi
      sleep 2
    done
    docker inspect -f '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' '$container' 2>/dev/null || true
    exit 1
  "
}

post_status() {
  remote "cd '$REMOTE_ROOT' && docker compose ps benefits-backend benefits-frontend && df -h '$REMOTE_VOLUME' && docker system df"
}

if [[ "$MODE" == "status" ]]; then
  post_status
  exit 0
fi

ensure_space
sync_app

case "$MODE" in
  frontend)
    compose "up -d --build --no-deps benefits-frontend"
    wait_healthy inferno-benefits-frontend
    ;;
  backend)
    compose "up -d --build benefits-backend"
    wait_healthy inferno-benefits-backend
    compose "up -d --build --no-deps benefits-frontend"
    wait_healthy inferno-benefits-frontend
    ;;
  all)
    compose "up -d --build benefits-backend"
    wait_healthy inferno-benefits-backend
    compose "up -d --build --no-deps benefits-frontend"
    wait_healthy inferno-benefits-frontend
    ;;
esac

ensure_space
post_status
