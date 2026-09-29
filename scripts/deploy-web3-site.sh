#!/usr/bin/env bash
# Exact-SHA static release of web3.ifrunit.tech (T-160; closes the 2026-09 drift
# behind CWA-47/48/81: vendored ethers/WalletConnect 404, esm.sh CSP, wrong sitemap).
#
#   EXPECTED_SHA=<40-char sha> scripts/deploy-web3-site.sh plan     # read-only
#   EXPECTED_SHA=<40-char sha> scripts/deploy-web3-site.sh deploy   # operator only
#   EXPECTED_SHA=<40-char sha> scripts/deploy-web3-site.sh verify   # public HTTP only
#   scripts/deploy-web3-site.sh rollback <remote backup dir>        # operator only
#
# deploy: exact-SHA docroot (git archive, never the working tree, including
# .nginx/web3-security-headers.conf which the host nginx.conf includes) ->
# backup of html + nginx.conf -> rsync -> nginx -t -> reload -> public verify.
# nginx.conf itself, the container, other services, volumes, env and secrets
# are never touched. Runbook: docs/WEB3_SITE_RELEASE.md
set -euo pipefail

MODE="${1:-plan}"
SSH_HOST="${SSH_HOST:-hetzner}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/inferno}"
SITE="$REMOTE_ROOT/web3-site"
HEADERS=".nginx/web3-security-headers.conf"
CONTAINER="${CONTAINER:-inferno-web3-site}"
PUBLIC_URL="${PUBLIC_URL:-https://web3.ifrunit.tech}"
MIN_FREE_MB="${MIN_FREE_MB:-1024}"
DELETE="${DELETE:-0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT/scripts/web3-release.cjs"

remote() { ssh "$SSH_HOST" "$@"; }
die() { echo "ERROR: $*" >&2; exit 1; }

require_sha() {
  [[ "${EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || die "set EXPECTED_SHA to the full 40-char release commit"
  git -C "$ROOT" cat-file -e "${EXPECTED_SHA}^{commit}" 2>/dev/null || die "commit $EXPECTED_SHA is not in this clone; git fetch first"
}

require_clean_exact_checkout() {
  [[ "$(git -C "$ROOT" rev-parse HEAD)" == "$EXPECTED_SHA" ]] || die "HEAD is not $EXPECTED_SHA; check out the exact release commit"
  [[ -z "$(git -C "$ROOT" status --porcelain)" ]] || die "working tree is dirty; release only from a clean checkout"
  node "$ROOT/scripts/test-web3-headers.cjs" >/dev/null
  node "$ROOT/scripts/check-web3-wallet-runtime.cjs" >/dev/null
}

stage_release() {
  STAGE="$(mktemp -d)"
  trap 'rm -r "$STAGE"' EXIT
  node "$HELPER" stage "$EXPECTED_SHA" "$STAGE" >/dev/null
}

remote_precheck() {
  remote "test -d '$SITE/html' && test -f '$SITE/nginx.conf'" || die "$SITE/html or nginx.conf missing on $SSH_HOST"
  # The release relies on nginx.conf including the shipped headers file.
  remote "grep -q 'include /usr/share/nginx/html/$HEADERS;' '$SITE/nginx.conf'" \
    || die "$SITE/nginx.conf does not include /usr/share/nginx/html/$HEADERS; stop and review the host config"
  [[ "$(remote "docker inspect -f '{{.State.Running}}' '$CONTAINER'")" == "true" ]] || die "$CONTAINER is not running"
  local free
  free="$(remote "df -BM --output=avail '$SITE' | tail -1 | tr -dc '0-9'")"
  (( free >= MIN_FREE_MB )) || die "only ${free}M free under $SITE (need $MIN_FREE_MB)"
  echo "remote ok: $CONTAINER running, headers include present, ${free}M free"
}

# Sets RSYNC_ARGS (bash 3.2 compatible; macOS operators have no mapfile).
set_rsync_args() {
  # Symbolic --chmod: numeric modes need rsync >= 3.1; macOS ships 2.6.9.
  RSYNC_ARGS=(-rlt --checksum --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r --itemize-changes)
  if [[ "$DELETE" == "1" ]]; then RSYNC_ARGS+=(--delete); fi
}

verify_public() {
  local failures=0 file expected actual
  local q="release=${EXPECTED_SHA:0:12}-$RANDOM"
  while read -r expected file; do
    actual="$(curl -fsS "$PUBLIC_URL/$file?$q" | shasum -a 256 | cut -d' ' -f1)" || actual="unreachable"
    if [[ "$actual" == "$expected" ]]; then echo "ok    /$file"; else echo "FAIL  /$file ($actual)"; failures=$((failures + 1)); fi
  done < <(node "$HELPER" manifest "$STAGE/html")
  local csp_live csp_repo
  csp_live="$(curl -fsSI "$PUBLIC_URL/?$q" | tr -d '\r' | sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy: //p')"
  csp_repo="$(node "$HELPER" csp)"
  if [[ "$csp_live" == "$csp_repo" ]]; then echo "ok    CSP matches infra/web3"; else echo "FAIL  CSP differs from infra/web3"; failures=$((failures + 1)); fi
  (( failures == 0 )) || die "$failures public check(s) failed"
  echo "verified: $PUBLIC_URL serves $EXPECTED_SHA"
}

case "$MODE" in
  plan)
    require_sha
    stage_release
    remote_precheck
    echo "--- files that would change (rsync dry run; DELETE=$DELETE)"
    set_rsync_args
    rsync "${RSYNC_ARGS[@]}" --dry-run "$STAGE/html/" "$SSH_HOST:$SITE/html/" | grep -v '^\.' || true
    echo "--- security headers change ($HEADERS)"
    remote "cat '$SITE/html/$HEADERS'" | diff -u - "$STAGE/html/$HEADERS" || true
    ;;
  deploy)
    require_sha
    require_clean_exact_checkout
    stage_release
    remote_precheck
    backup="$REMOTE_ROOT/backups/web3-site-$(date -u +%Y%m%dT%H%M%SZ)"
    # mkdir without -p on the final dir: a same-second second run must not overwrite a backup.
    remote "mkdir -p '$REMOTE_ROOT/backups' && mkdir '$backup' && tar -C '$SITE' -czf '$backup/html.tgz' html && cp -p '$SITE/nginx.conf' '$backup/nginx.conf'"
    echo "backup: $backup  (rollback: scripts/deploy-web3-site.sh rollback $backup)"
    set_rsync_args
    # A failed sync must stop before nginx is touched.
    rsync "${RSYNC_ARGS[@]}" "$STAGE/html/" "$SSH_HOST:$SITE/html/" > "$STAGE/rsync.log" \
      || die "rsync failed; nginx untouched (rollback: rollback $backup)"
    echo "files transferred: $(grep -c '^<' "$STAGE/rsync.log" || true)"
    if ! remote "docker exec '$CONTAINER' nginx -t"; then
      remote "tar -C '$SITE' -xzf '$backup/html.tgz' 'html/$HEADERS'"
      die "nginx -t failed; previous $HEADERS restored, nginx not reloaded (full rollback: rollback $backup)"
    fi
    remote "docker exec '$CONTAINER' nginx -s reload"
    echo "nginx: config tested and reloaded"
    verify_public
    ;;
  verify)
    require_sha
    stage_release
    verify_public
    ;;
  rollback)
    backup="${2:-}"
    [[ "$backup" =~ ^$REMOTE_ROOT/backups/web3-site-[0-9]{8}T[0-9]{6}Z$ ]] || die "usage: rollback $REMOTE_ROOT/backups/web3-site-<YYYYMMDDTHHMMSSZ>"
    remote "set -e; t=\$(mktemp -d); tar -C \"\$t\" -xzf '$backup/html.tgz'; rsync -a --delete \"\$t/html/\" '$SITE/html/'; rm -r \"\$t\"; cat '$backup/nginx.conf' > '$SITE/nginx.conf'; docker exec '$CONTAINER' nginx -t; docker exec '$CONTAINER' nginx -s reload"
    echo "rolled back to $backup"
    ;;
  *)
    die "unknown mode $MODE (plan|deploy|verify|rollback)"
    ;;
esac
