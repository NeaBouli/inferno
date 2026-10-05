# shellcheck shell=bash
# Client side of the scoped deploy gate (inferno-deploy v2, T-257), sourced by
# deploy-compose-service.sh, deploy-web3-site.sh and deploy-benefits-network.sh
# when DEPLOY_MODE=gate. Every host action is one call
#   ssh -F ~/.fleet-ssh/config hetzner-deploy <subcommand> <args...>
# whose forced command only runs the reviewed root tool: no remote shell, docker
# or rsync from this side. Uploads are a tar on stdin; the tool checks its SHA-256
# before it changes anything. Secrets are never passed. Runbook:
# docs/COMPOSE_SERVICE_RELEASE.md#gate-mode

DEPLOY_GATE_HOST="${DEPLOY_GATE_HOST:-hetzner-deploy}"
DEPLOY_GATE_SSH_CONFIG="${DEPLOY_GATE_SSH_CONFIG:-$HOME/.fleet-ssh/config}"
GATE_MAX_UPLOAD_BYTES=$((512 * 1024 * 1024))   # the tool refuses larger uploads

gate_die() { echo "ERROR: $*" >&2; exit 64; }

[[ "$DEPLOY_GATE_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9._@-]*$ ]] || gate_die "DEPLOY_GATE_HOST must be a plain ssh alias"

# gate <subcommand> [args...]. The forced command splits on whitespace and allows at
# most 6 words of [A-Za-z0-9._:=@+-]{1,128}; refuse locally what it would deny.
gate() {
  (( $# >= 1 && $# <= 6 )) || gate_die "gate takes a subcommand and at most 5 arguments"
  local a
  for a in "$@"; do
    [[ "$a" =~ ^[A-Za-z0-9._:=@+-]{1,128}$ ]] || gate_die "gate argument '$a' is outside [A-Za-z0-9._:=@+-]{1,128}"
  done
  ssh -F "$DEPLOY_GATE_SSH_CONFIG" "$DEPLOY_GATE_HOST" "$@"
}

gate_sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# The tool accepts regular files and directories only; fail here, before the upload.
gate_check_tar() {
  local tarfile="$1" size bad
  size="$(wc -c < "$tarfile" | tr -d ' ')"
  (( size <= GATE_MAX_UPLOAD_BYTES )) || gate_die "upload is ${size} bytes (gate limit $GATE_MAX_UPLOAD_BYTES)"
  bad="$(tar -tvf "$tarfile" | awk '{c = substr($1, 1, 1); if (c != "-" && c != "d") print}')"
  [[ -z "$bad" ]] || gate_die "upload holds members other than regular files and directories: $bad"
}

# gate_tar_has <tarfile> <path>: true if <path> (or ./<path>) is a member. The listing
# is captured first: grep -q in a pipe can SIGPIPE tar, which fails under pipefail.
gate_tar_has() {
  local members
  members="$(tar -tf "$1")"
  grep -qx -e "$2" -e "./$2" <<< "$members"
}

# gate_prepare <tarfile>: checks the upload and prints its SHA-256; the caller passes
# the sha to the plan/deploy subcommand and streams the same file on stdin.
gate_prepare() {
  local sha
  gate_check_tar "$1"
  sha="$(gate_sha256 "$1")"
  echo "upload: $(wc -c < "$1" | tr -d ' ') bytes, sha256 $sha" >&2
  printf '%s\n' "$sha"
}

# Accepts a bare stamp or a backup path ending in -<stamp>; prints the stamp.
gate_stamp() {
  local stamp="${1##*-}"
  [[ "$stamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || gate_die "expected a backup stamp YYYYMMDDTHHMMSSZ (see the 'backups' mode), got '${1:-}'"
  printf '%s\n' "$stamp"
}
