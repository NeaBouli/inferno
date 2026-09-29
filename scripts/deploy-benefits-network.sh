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
ABORT_FREE_GB="${ABORT_FREE_GB:-2}"
ABORT_FREE_MB="$((ABORT_FREE_GB * 1024))"
DEPLOY_ABORT_FREE_GB="${DEPLOY_ABORT_FREE_GB:-4}"
DEPLOY_ABORT_FREE_MB="$((DEPLOY_ABORT_FREE_GB * 1024))"
REMOTE_VOLUME="${REMOTE_VOLUME:-/mnt/HC_Volume_106164848}"
REMOTE_COMPOSE_ENV_FILE="${REMOTE_COMPOSE_ENV_FILE:-$REMOTE_ROOT/.env.benefits}"

case "$MODE" in
  frontend|backend|all|status|capacity) ;;
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

safe_prune() {
  remote "
    docker builder prune -af >/dev/null
    docker container prune -f >/dev/null
    docker image prune -f >/dev/null
    df -h '$REMOTE_VOLUME'
  "
}

ensure_space() {
  local phase="${1:-preflight}"
  local require_deploy_floor="${2:-0}"
  local allow_prune="${3:-1}"
  local free
  free="$(free_mb)"
  if [[ -z "$free" ]]; then
    echo "Could not determine free disk space for $REMOTE_VOLUME" >&2
    exit 1
  fi

  if (( free < MIN_FREE_MB )) && [[ "$allow_prune" == "1" ]]; then
    echo "Only ${free}M free on $REMOTE_VOLUME during $phase; pruning safe Docker caches."
    safe_prune
    free="$(free_mb)"
  fi

  if (( free < ABORT_FREE_MB )); then
    echo "Only ${free}M free on $REMOTE_VOLUME during $phase; aborting before deploy." >&2
    echo "Raise disk capacity or explicitly lower ABORT_FREE_GB for this run." >&2
    exit 75
  fi

  if [[ "$require_deploy_floor" == "1" ]] && (( free < DEPLOY_ABORT_FREE_MB )); then
    echo "Only ${free}M free on $REMOTE_VOLUME during $phase; refusing to start container rebuild." >&2
    echo "Frontend deploys have dropped below 0.5G transiently from ~3.5G free." >&2
    echo "Free space to at least DEPLOY_ABORT_FREE_GB=${DEPLOY_ABORT_FREE_GB}G or set a one-off override after accepting the risk." >&2
    exit 75
  fi

  if (( free < MIN_FREE_MB )); then
    echo "WARNING: ${free}M free on $REMOTE_VOLUME during $phase; below MIN_FREE_GB=${MIN_FREE_GB}G." >&2
    echo "Deploy may still succeed, but production disk capacity needs cleanup or expansion." >&2
  fi
}

# Excluded paths are never deleted remotely (no --delete-excluded): this keeps
# remote-only env files and SQLite files safe even though none are expected in
# this tree (production data lives in the inferno_benefits_data volume).
sync_app() {
  rsync -az --delete \
    --exclude node_modules \
    --exclude .next \
    --exclude dist \
    --exclude '*.db' \
    --exclude '*.db-journal' \
    --exclude '*.db-wal' \
    --exclude '*.db-shm' \
    --exclude .env \
    --exclude .env.local \
    --exclude .env.production \
    "$LOCAL_APP" "$SSH_HOST:$REMOTE_APP"
}

compose() {
  remote "cd '$REMOTE_ROOT' && docker compose --env-file '$REMOTE_COMPOSE_ENV_FILE' $*"
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
  remote "cd '$REMOTE_ROOT' && docker compose --env-file '$REMOTE_COMPOSE_ENV_FILE' ps benefits-backend benefits-frontend && df -h '$REMOTE_VOLUME' && docker system df"
}

backend_replica_count() {
  remote "cd '$REMOTE_ROOT' && docker compose --env-file '$REMOTE_COMPOSE_ENV_FILE' ps -aq benefits-backend | wc -l | tr -d ' '"
}

assert_single_backend() {
  local require_running="${1:-0}"
  local count
  count="$(backend_replica_count)"
  if [[ ! "$count" =~ ^[0-9]+$ ]]; then
    echo "Could not determine Benefits backend replica count." >&2
    exit 1
  fi
  if (( count > 1 )); then
    echo "Refusing operation: found $count Benefits backend replicas; current SQLite topology permits exactly one." >&2
    exit 78
  fi
  if [[ "$require_running" == "1" ]] && (( count != 1 )); then
    echo "Expected exactly one running Benefits backend replica after deploy, found $count." >&2
    exit 1
  fi
}

if [[ "$MODE" == "status" ]]; then
  assert_single_backend
  post_status
  exit 0
fi

if [[ "$MODE" == "capacity" ]]; then
  ensure_space "capacity-check" 0 0
  assert_single_backend
  post_status
  exit 0
fi

# Deploy modes ship the local working tree; bind it to one reviewed commit.
require_exact_release() {
  if [[ ! "${EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Set EXPECTED_SHA to the full 40-char release commit before $MODE deploys." >&2
    exit 64
  fi
  if [[ "$(git -C "$LOCAL_ROOT" rev-parse HEAD)" != "$EXPECTED_SHA" ]]; then
    echo "Refusing deploy: HEAD is not $EXPECTED_SHA." >&2
    exit 65
  fi
  if [[ -n "$(git -C "$LOCAL_ROOT" status --porcelain -- apps/benefits-network scripts/deploy-benefits-network.sh)" ]]; then
    echo "Refusing deploy: apps/benefits-network has uncommitted or untracked changes." >&2
    exit 65
  fi
}

require_exact_release
ensure_space "pre-deploy" 1
assert_single_backend
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

assert_single_backend 1
ensure_space "post-deploy"
post_status
