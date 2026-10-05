#!/usr/bin/env bash
# Exact-SHA static release of web3.ifrunit.tech (T-160; closes the 2026-09 drift
# behind CWA-47/48/81: vendored ethers/WalletConnect 404, esm.sh CSP, wrong sitemap).
#
#   EXPECTED_SHA=<40-char sha> scripts/deploy-web3-site.sh plan     # read-only
#   EXPECTED_SHA=<40-char sha> scripts/deploy-web3-site.sh deploy   # operator only
#   EXPECTED_SHA=<40-char sha> scripts/deploy-web3-site.sh verify   # public HTTP only
#   scripts/deploy-web3-site.sh rollback <remote backup dir>        # operator only
#
# DEPLOY_MODE=gate routes plan/deploy/rollback through the scoped host gate
# (ssh -F ~/.fleet-ssh/config hetzner-deploy ...) and adds status|health|backups;
# rollback then takes the backup stamp. Unset DEPLOY_MODE keeps the direct path below.
#
# deploy: exact-SHA docroot (git archive, never the working tree, including
# .nginx/web3-security-headers.conf which the host nginx.conf includes) ->
# backup of html + nginx.conf -> rsync -> nginx -t -> reload -> public verify.
# nginx.conf itself, the container, other services, volumes, env and secrets
# are never touched. Runbook: docs/WEB3_SITE_RELEASE.md
#
# Transfers are content-only (T-255): no -t/-a/-g/-o/-p. The v1 deploy user may
# write under /opt/inferno (ACL) but may not set times, owner, group or mode on
# root-owned inodes, so metadata flags made rsync exit 23. Changed files are
# rewritten (new inode owned by the deployer, mode kept), unchanged ones are left
# alone (--checksum). Every rsync error still fails the run.
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

# Values below are interpolated into remote shell strings; allow plain names/paths only.
for var in SSH_HOST REMOTE_ROOT CONTAINER; do
  [[ "${!var}" =~ ^[A-Za-z0-9._/@-]+$ ]] || die "$var contains characters outside [A-Za-z0-9._/@-]"
done
[[ "$SSH_HOST" =~ ^[A-Za-z0-9] ]] || die "SSH_HOST must start with a letter or digit (ssh would read '-' as an option)"
[[ "$MIN_FREE_MB" =~ ^[0-9]+$ ]] || die "MIN_FREE_MB must be an integer"
[[ "$PUBLIC_URL" =~ ^https://[A-Za-z0-9.-]+$ ]] || die "PUBLIC_URL must be https://<host>"

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
  # Content only (see header): -r -l keep the tree and symlinks, --checksum skips
  # unchanged files without comparing times. --chmod sets the mode of new files
  # only (no -p), so nginx can read them. Symbolic --chmod: numeric modes need
  # rsync >= 3.1; macOS ships 2.6.9.
  RSYNC_ARGS=(-rl --checksum --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r --itemize-changes)
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

# Runs on the host via `bash -s -- <backup> <site> <container>`: restores html/
# and nginx.conf from the backup, then proves the restore is complete, not only
# content-identical. Any failed step or check exits non-zero. The body is one
# function, so bash has read all of it before any command could consume stdin.
IFS= read -r -d '' RESTORE_SCRIPT <<'REMOTE' || true
set -euo pipefail
main() {
backup="$1" site="$2" container="$3"
fail() { echo "ROLLBACK CHECK FAILED: $*" >&2; exit 1; }
t="$(mktemp -d)"
trap 'rm -r "$t"' EXIT
tar -C "$t" -xpzf "$backup/html.tgz"
ref="$t/html" live="$site/html"
# Content only, like deploy: the v1 user cannot set times/owner/group/mode on root-owned inodes.
rsync -rl --checksum --delete "$ref/" "$live/" || fail "rsync exited $?"
cat "$backup/nginx.conf" > "$site/nginx.conf"
lst() { local d="$1"; shift; (cd "$d" && find . "$@" -print) | LC_ALL=C sort; }
links() { lst "$1" -type l | while IFS= read -r p; do printf '%s -> %s\n' "$p" "$(readlink "$1/$p")"; done; }
# (b) symlinks: same paths and targets (checked first, so a link change is named as such)
diff <(links "$ref") <(links "$live") >&2 || fail "(b) symlinks differ from the backup"
# (a) content: no added, missing or changed entry; symlinks are compared, not followed
diff -rq --no-dereference "$ref" "$live" >&2 || fail "(a) content differs from the backup"
# (c) access: nothing the backup let others read (files o+r, dirs o+rx) lost it
missing="$(LC_ALL=C comm -23 <(lst "$ref" \( -type f -perm -o=r -o -type d -perm -o=rx \)) \
                             <(lst "$live" \( -type f -perm -o=r -o -type d -perm -o=rx \)))"
[ -z "$missing" ] || { printf '%s\n' "$missing" | head -20 >&2; fail "(c) entries lost world read/traverse access"; }
# (d) config: nginx.conf identical, tested and reloaded
cmp "$backup/nginx.conf" "$site/nginx.conf" >&2 || fail "(d) nginx.conf differs from the backup"
docker exec "$container" nginx -t || fail "(d) nginx -t failed"
docker exec "$container" nginx -s reload || fail "(d) nginx reload failed"
echo "restore verified: (a) content (b) symlinks (c) access (d) nginx.conf + nginx -t + reload"
}
main "$@"
REMOTE

# DEPLOY_MODE=gate: the same release through the scoped host gate (inferno-deploy v2).
# The upload is the staged docroot with $HEADERS at its root; the tool backs up html and
# nginx.conf, syncs, runs nginx -t and reloads. Local header/wallet tests and the public
# verify stay on this side.
case "${DEPLOY_MODE:-}" in
  ''|ssh) ;;
  gate)
    # Never source a locally modified helper.
    [[ -z "$(git -C "$ROOT" status --porcelain -- scripts/deploy-gate-lib.sh scripts/deploy-web3-site.sh)" ]] || die "working tree is dirty (scripts/deploy-gate-lib.sh or this script); release only from a clean checkout"
    # shellcheck source=scripts/deploy-gate-lib.sh
    . "$ROOT/scripts/deploy-gate-lib.sh"
    GATE_DELETE=()
    if [[ "$DELETE" == "1" ]]; then GATE_DELETE=(delete); fi
    gate_release_tar() {
      [[ -f "$STAGE/html/$HEADERS" ]] || die "staged docroot lacks $HEADERS"
      # COPYFILE_DISABLE keeps macOS tar from adding ._* AppleDouble members.
      COPYFILE_DISABLE=1 tar -C "$STAGE/html" -cf "$STAGE/upload.tar" .
      TAR_SHA="$(gate_prepare "$STAGE/upload.tar")"
    }
    case "$MODE" in
      plan)
        require_sha
        stage_release
        gate_release_tar
        gate web3-plan "$EXPECTED_SHA" "$TAR_SHA" ${GATE_DELETE[@]+"${GATE_DELETE[@]}"} < "$STAGE/upload.tar"
        ;;
      deploy)
        require_sha
        require_clean_exact_checkout
        stage_release
        gate_release_tar
        gate web3-deploy "$EXPECTED_SHA" "$TAR_SHA" ${GATE_DELETE[@]+"${GATE_DELETE[@]}"} < "$STAGE/upload.tar"
        verify_public
        ;;
      verify)
        require_sha
        stage_release
        verify_public
        ;;
      rollback)
        stamp="$(gate_stamp "${2:-}")"
        gate web3-rollback "$stamp"
        ;;
      status)  gate status ;;
      health)  gate health web3-site ;;
      backups) gate backups web3-site ;;
      *) die "unknown mode $MODE for DEPLOY_MODE=gate (plan|deploy|verify|rollback|status|health|backups)" ;;
    esac
    exit 0
    ;;
  *) die "DEPLOY_MODE must be unset (direct ssh) or gate" ;;
esac

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
    remote "bash -s -- '$backup' '$SITE' '$CONTAINER'" <<< "$RESTORE_SCRIPT" || die "rollback to $backup FAILED or is incomplete; see the check output above"
    echo "rolled back to $backup"
    ;;
  *)
    die "unknown mode $MODE (plan|deploy|verify|rollback)"
    ;;
esac
