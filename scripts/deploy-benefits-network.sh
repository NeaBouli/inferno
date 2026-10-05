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
  frontend|backend|all|status|capacity|env-vault-v2|rollback|env-restore) ;;
  *)
    echo "Usage: $0 [frontend|backend|all|status|capacity]  (DEPLOY_MODE=gate adds: env-vault-v2 <address>, rollback <stamp>, env-restore <stamp>)" >&2
    exit 64
    ;;
esac

# Values below are interpolated into ssh arguments and remote shell strings; allow
# a plain host alias (no leading '-': ssh would read it as an option) and absolute paths only.
if [[ ! "$SSH_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9._@-]*$ ]]; then
  echo "SSH_HOST must match ^[A-Za-z0-9][A-Za-z0-9._@-]*\$." >&2
  exit 64
fi
for var in REMOTE_ROOT REMOTE_VOLUME REMOTE_COMPOSE_ENV_FILE; do
  if [[ ! "${!var}" =~ ^/[A-Za-z0-9._/@-]+$ ]]; then
    echo "$var must be an absolute path of characters [A-Za-z0-9._/@-]." >&2
    exit 64
  fi
done

# DEPLOY_MODE=gate: the same release through the scoped host gate (inferno-deploy v2).
# The upload is git archive <EXPECTED_SHA>:apps/benefits-network, so ignored or edited
# local files cannot ship; the tool on the host does the env-contract check, the
# capacity floor (refuse below it; gate mode never prunes the shared Docker daemon), the single-backend asserts, the
# sync and the rebuild. No secret is ever sent; env-set is whitelisted on the host
# for the public COMMITMENT_VAULT_V2_ADDRESS only.
case "${DEPLOY_MODE:-}" in
  ''|ssh)
    if [[ "$MODE" == "env-vault-v2" || "$MODE" == "rollback" || "$MODE" == "env-restore" ]]; then
      echo "$MODE needs DEPLOY_MODE=gate." >&2
      exit 64
    fi
    ;;
  gate)
    # Any set ALLOW_PRUNE (including empty or 0) is refused: gate mode has no prune switch at all.
    if [[ -n "${ALLOW_PRUNE+set}" ]]; then
      echo "Refusing: gate mode never prunes (the Docker daemon is shared with other projects); unset ALLOW_PRUNE." >&2
      exit 64
    fi
    # Never source a locally modified helper.
    if [[ -n "$(git -C "$LOCAL_ROOT" status --porcelain -- scripts/deploy-gate-lib.sh scripts/deploy-benefits-network.sh)" ]]; then
      echo "Refusing: working tree is dirty (scripts/deploy-gate-lib.sh or this script); release only from a clean checkout." >&2
      exit 65
    fi
    # shellcheck source=scripts/deploy-gate-lib.sh
    . "$LOCAL_ROOT/scripts/deploy-gate-lib.sh"
    case "$MODE" in
      status|capacity)
        gate benefits-status
        ;;
      frontend|backend|all)
        if [[ ! "${EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
          echo "Set EXPECTED_SHA to the full 40-char release commit before $MODE deploys." >&2
          exit 64
        fi
        if ! git -C "$LOCAL_ROOT" cat-file -e "${EXPECTED_SHA}^{commit}" 2>/dev/null; then
          echo "Refusing deploy: commit $EXPECTED_SHA is not in this clone; git fetch first." >&2
          exit 65
        fi
        if [[ "$(git -C "$LOCAL_ROOT" rev-parse HEAD)" != "$EXPECTED_SHA" ]]; then
          echo "Refusing deploy: HEAD is not $EXPECTED_SHA." >&2
          exit 65
        fi
        # Whole-checkout guard (like Compose/Web3): covers the sourced gate helper too.
        if [[ -n "$(git -C "$LOCAL_ROOT" status --porcelain)" ]]; then
          echo "Refusing deploy: working tree is dirty (incl. scripts/deploy-gate-lib.sh); release only from a clean checkout." >&2
          exit 65
        fi
        STAGE="$(mktemp -d)"
        trap 'rm -r "$STAGE"' EXIT
        git -C "$LOCAL_ROOT" archive --format=tar "$EXPECTED_SHA:apps/benefits-network" > "$STAGE/upload.tar"
        TAR_SHA="$(gate_prepare "$STAGE/upload.tar")"
        gate benefits-deploy "$MODE" "$EXPECTED_SHA" "$TAR_SHA" < "$STAGE/upload.tar"
        ;;
      env-vault-v2)
        if [[ ! "${2:-}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
          echo "Usage: DEPLOY_MODE=gate $0 env-vault-v2 <0x-address of CommitmentVaultV2>" >&2
          exit 64
        fi
        gate env-set .env.benefits COMMITMENT_VAULT_V2_ADDRESS "$2"
        ;;
      rollback)
        stamp="$(gate_stamp "${2:-}")"
        gate benefits-rollback "$stamp"
        ;;
      env-restore)
        stamp="$(gate_stamp "${2:-}")"
        gate benefits-env-restore "$stamp"
        ;;
      *)
        echo "Unknown mode $MODE for DEPLOY_MODE=gate." >&2
        exit 64
        ;;
    esac
    exit 0
    ;;
  *)
    echo "DEPLOY_MODE must be unset (direct ssh) or gate." >&2
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
RSYNC_EXCLUDES=()
for x in node_modules .next dist '*.db' '*.db-journal' '*.db-wal' '*.db-shm' .env .env.local .env.production; do
  RSYNC_EXCLUDES+=(--exclude "$x")
done

sync_app() {
  rsync -az --delete "${RSYNC_EXCLUDES[@]}" "$LOCAL_APP" "$SSH_HOST:$REMOTE_APP"
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
  # git status hides local edits behind assume-unchanged/skip-worktree bits.
  if git -C "$LOCAL_APP" ls-files -v | grep -q '^[a-zS]'; then
    echo "Refusing deploy: apps/benefits-network has assume-unchanged or skip-worktree files." >&2
    exit 65
  fi
  # git status also hides ignored files. Ask rsync, with the excludes sync_app uses,
  # which files it would upload; every one must be a tracked file of the release commit.
  local dry uploads extra
  dry="$(mktemp -d)"
  uploads="$(rsync -a --dry-run --out-format='%n' "${RSYNC_EXCLUDES[@]}" "$LOCAL_APP" "$dry/")" || {
    rmdir "$dry"
    echo "Refusing deploy: could not list the files sync_app would upload." >&2
    exit 65
  }
  rmdir "$dry"
  extra="$(LC_ALL=C comm -23 <(grep -v '/$' <<< "$uploads" | LC_ALL=C sort) \
    <(git -C "$LOCAL_APP" -c core.quotePath=false ls-files | LC_ALL=C sort))"
  if [[ -n "$extra" ]]; then
    echo "Refusing deploy: apps/benefits-network holds files outside $EXPECTED_SHA that would be uploaded:" >&2
    sed 's/^/  /' <<< "$extra" >&2
    echo "Release from a fresh checkout of the release commit." >&2
    exit 65
  fi
}

# The backend refuses to start in production without these values (config.ts,
# sellerAuthConfigPolicy.ts, adminSecretPolicy.ts). Check names and the admin-secret
# length on the host before anything is built; never print a value.
REQUIRED_ENV_KEYS="SELLER_AUTH_DOMAIN CHAIN_ID RPC_URL IFR_TOKEN_ADDRESS IFRLOCK_ADDRESS COMMITMENT_VAULT_ADDRESS ADMIN_SECRET"
require_production_env() {
  local missing
  missing="$(remote "f='$REMOTE_COMPOSE_ENV_FILE'
    test -r \"\$f\" || { echo UNREADABLE; exit 0; }
    for k in $REQUIRED_ENV_KEYS; do grep -q \"^\$k=.\" \"\$f\" || printf '%s ' \"\$k\"; done
    s=\$(grep '^ADMIN_SECRET=' \"\$f\" | head -1 | cut -d= -f2-)
    [ \"\${#s}\" -ge 32 ] || printf 'ADMIN_SECRET(<32) '")"
  if [[ -n "$missing" ]]; then
    echo "Refusing deploy: $REMOTE_COMPOSE_ENV_FILE lacks production settings: $missing" >&2
    echo "Add them on the host (values never in chat or logs), then re-run." >&2
    exit 78
  fi
}

require_exact_release
require_production_env
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
