#!/usr/bin/env bash
# CWA-06: move the FeeRouterV1 voucher signer off a Safe owner key onto a dedicated key.
# The new private key is generated on the production host inside the points-backend container
# and written straight to a root-only file; it never appears on screen, in chat, logs or git.
#
#   bash scripts/ops/rotate-voucher-signer.sh prepare    # create the new key on the host, print its ADDRESS
#   bash scripts/ops/rotate-voucher-signer.sh status     # show next/active signer addresses and the on-chain signer
#   bash scripts/ops/rotate-voucher-signer.sh activate   # after Governance executed proposal 18: switch the backend
#
# activate is retry-safe: the first run keeps one backup of the original env file (named in the marker file);
# a retry re-validates and reuses it instead of making a new one. Backup, marker and staging key are shredded only
# after a healthy restart with the expected signer. Runs are serialized by a lock directory on the host.
#
# Operator only (needs the host operator SSH key; the read-only agent key cannot do this).
set -euo pipefail

HOST="${SSH_HOST:-hetzner}"
ROOT="${REMOTE_ROOT:-/opt/inferno}"
ENV_FILE=".env.points-backend"
NEXT=".voucher-signer-next.key"
BACKUP="$ENV_FILE.voucher-rotation.bak"   # the original env file; holds the old signer key until cleanup
MARKER=".voucher-signer-last-backup"      # names $BACKUP once it is complete
LOCK=".voucher-signer-activate.lock"
RPC="${MAINNET_RPC:-https://ethereum-rpc.publicnode.com}"
FEE_ROUTER="0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a"
GOVERNANCE="0xc43d48E7FDA576C5022d0670B652A622E8caD041"
PROPOSAL_ID=18             # the queued FeeRouterV1.setVoucherSigner proposal
PROPOSAL_ETA=1791156347    # its ETA, 2026-10-04T23:25:47Z
SAFE_OWNERS="0x6b36687b0cd4386fb14cf565b67d7862110fed67 0x17f8dd6deccb3ff5d95691982b85a87d7d9872d4 0x0c4893dcf730e0ddc7d18cf9723932784fb4ed74 0xa0860f872a9cab34817d9a764e71ab43b942b275 0x32cf8b4f29a8f211804857ecf8bf0847f0bc0fe9"

die() { echo "ERROR: $*" >&2; exit 1; }
lower() { tr '[:upper:]' '[:lower:]'; }

rpc_call() { # $1 = JSON-RPC method, $2 = params JSON; prints the raw response or fails
  curl -fsS -m 20 -H 'content-type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}" "$RPC"
}

# Prints the 0x-prefixed lowercase hex "result" of a JSON-RPC response on stdin; fails on error or malformed JSON.
rpc_result() {
  python3 -c 'import json,re,sys
try:
    r=json.load(sys.stdin)
except Exception:
    sys.exit("malformed RPC response")
if not isinstance(r,dict) or "error" in r or not isinstance(r.get("result"),str) or not re.fullmatch(r"0x[0-9a-fA-F]*",r["result"]):
    sys.exit("RPC error or missing result")
print(r["result"].lower())'
}

# Prints the result of eth_call($1 = to, $2 = data) on Ethereum Mainnet; fails closed on any RPC problem.
mainnet_call() {
  local chain
  chain=$(rpc_call eth_chainId '[]' | rpc_result) || die "eth_chainId failed"
  [ "$chain" = "0x1" ] || die "RPC is not Ethereum Mainnet (chainId $chain)"
  rpc_call eth_call "[{\"to\":\"$1\",\"data\":\"$2\"},\"latest\"]" | rpc_result
}

# Prints FeeRouterV1.voucherSigner() from Ethereum Mainnet; fails closed on any RPC problem.
onchain_signer() {
  local word
  word=$(mainnet_call "$FEE_ROUTER" 0x88f4c137) || die "voucherSigner() call failed"
  [[ "$word" =~ ^0x0{24}[0-9a-f]{40}$ ]] || die "voucherSigner() returned an unexpected value"
  echo "0x${word:26:40}"
}

# Prints the address for the key in $1 (a file under $ROOT, read on the host); never prints the key.
remote_address_of() {
  ssh "$HOST" "set -euo pipefail; cd '$ROOT'; test -s '$1' || exit 3
    docker compose exec -T points-backend node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>console.log(new (require(\"ethers\").Wallet)(s.trim()).address))' < '$1'" | lower
}

# Fails unless Governance proposal $PROPOSAL_ID is exactly FeeRouterV1.setVoucherSigner($1) with the pinned ETA,
# executed and not cancelled.
check_executed_proposal() {
  local raw
  raw=$(mainnet_call "$GOVERNANCE" "0xc7f758a8$(printf '%064x' "$PROPOSAL_ID")") || die "getProposal($PROPOSAL_ID) call failed"
  python3 - "$raw" "$FEE_ROUTER" "$1" "$PROPOSAL_ETA" <<'PY' || die "Governance proposal $PROPOSAL_ID is not the executed setVoucherSigner($1)"
import sys
raw, router, signer, eta = sys.argv[1][2:], sys.argv[2].lower()[2:], sys.argv[3].lower()[2:], int(sys.argv[4])
# (address target, bytes data, uint256 eta, bool executed, bool cancelled), data = setVoucherSigner(signer)
want = ["0" * 24 + router, "%064x" % 0xa0, "%064x" % eta, "%064x" % 1, "%064x" % 0, "%064x" % 36,
        "af6e40d0" + "0" * 24 + signer[:32], signer[32:] + "0" * 56]
names = {0: "target", 2: "ETA", 3: "not executed", 4: "cancelled", 6: "data", 7: "data"}
if len(raw) != 64 * len(want):
    sys.exit("proposal check failed: unexpected encoding")
for i, exp in enumerate(want):
    if raw[64 * i:64 * (i + 1)] != exp:
        sys.exit("proposal check failed: " + names.get(i, "encoding"))
PY
}

remote_active_address() {
  ssh "$HOST" "cd '$ROOT' && docker compose exec -T points-backend node -e 'const k=process.env.VOUCHER_SIGNER_PRIVATE_KEY; console.log(k ? new (require(\"ethers\").Wallet)(k).address : \"none\")'" | lower
}

case "${1:-}" in
  prepare)
    ssh "$HOST" "set -euo pipefail; cd '$ROOT'; umask 077
      if [ -s '$NEXT' ]; then echo 'next key already exists (reusing it)' >&2; exit 0; fi
      docker compose exec -T points-backend node -e 'process.stdout.write(require(\"ethers\").Wallet.createRandom().privateKey)' > '$NEXT.tmp'
      [ \"\$(wc -c < '$NEXT.tmp')\" -eq 66 ] || { rm -f '$NEXT.tmp'; echo 'key generation failed' >&2; exit 1; }
      mv '$NEXT.tmp' '$NEXT'; chmod 600 '$NEXT'"
    addr=$(remote_address_of "$NEXT") || die "could not read the new key on $HOST"
    for o in $SAFE_OWNERS; do [ "$addr" != "$o" ] || die "generated address collides with a Safe owner (should be impossible)"; done
    echo "NEW VOUCHER SIGNER ADDRESS: $addr"
    echo "Next: MAINNET_RPC_URL=<rpc> node scripts/voucher-signer-rotation-proposal.cjs $addr $PROPOSAL_ID <outDir>"
    ;;
  status)
    echo "next (prepared): $(remote_address_of "$NEXT" 2>/dev/null || echo none)"
    echo "active (backend): $(remote_active_address)"
    echo "on-chain FeeRouterV1.voucherSigner: $(onchain_signer)"
    ;;
  activate)
    ssh "$HOST" "cd '$ROOT' && mkdir '$LOCK'" 2>/dev/null \
      || die "cannot create $ROOT/$LOCK: another activation is running or was killed (check the state, then remove it)"
    trap 'ssh "$HOST" "rmdir '"'$ROOT/$LOCK'"'" || echo "WARNING: could not remove $ROOT/$LOCK" >&2' EXIT
    addr=$(remote_address_of "$NEXT") || die "no prepared key on $HOST; run prepare first"
    check_executed_proposal "$addr"
    chain=$(onchain_signer)
    [ "$addr" = "$chain" ] || die "on-chain voucherSigner is $chain, prepared key is $addr: execute the Governance proposal first"
    # First run: back up the original env file, then name it in the marker. Retry: re-validate that backup and never
    # overwrite it. Any other state is refused before the env file changes. Keys are compared on the host, never printed.
    ssh "$HOST" "bash -s -- '$ROOT' '$ENV_FILE' '$NEXT' '$BACKUP' '$MARKER'" <<'REMOTE'
set -euo pipefail; cd "$1"; f=$2 next=$3 backup=$4 marker=$5; umask 077
fail() { echo "refusing: $*" >&2; exit 1; }
key_of() { # the signer key in env file $1 (empty if absent); fails on duplicate key lines
  [ "$(grep -c '^VOUCHER_SIGNER_PRIVATE_KEY=' "$1" || true)" -le 1 ] || return 1
  sed -n 's/^VOUCHER_SIGNER_PRIVATE_KEY=//p' "$1"
}
test -f "$f" || fail "missing $f"
{ test -f "$next" && [ "$(wc -c < "$next")" -eq 66 ] && grep -qxE '0x[0-9a-fA-F]{64}' "$next"; } || fail "$next missing or malformed"
new=$(cat "$next")
cur=$(key_of "$f") || fail "$f has several signer key lines"
if [ -e "$marker" ]; then
  [ "$(cat "$marker")" = "$backup" ] || fail "$marker does not name $backup"
  test -s "$backup" || fail "$marker names $backup, but it is missing"
  old=$(key_of "$backup") || fail "$backup has several signer key lines"
  [ "$old" != "$new" ] || fail "$backup holds the prepared key, not the original"
  [ "$cur" = "$old" ] || [ "$cur" = "$new" ] || fail "$f holds neither the original nor the prepared key"
else
  [ ! -e "$backup" ] || fail "$backup exists without $marker"
  [ "$cur" != "$new" ] || fail "$f already holds the prepared key, but $marker is missing"
  cp -p "$f" "$backup.tmp"; mv "$backup.tmp" "$backup"
  printf '%s\n' "$backup" > "$marker.tmp"; mv "$marker.tmp" "$marker"
fi
tmp=$(mktemp "$f.XXXXXX")
NEW="$new" awk 'BEGIN{d=0} /^VOUCHER_SIGNER_PRIVATE_KEY=/{print "VOUCHER_SIGNER_PRIVATE_KEY=" ENVIRON["NEW"]; d=1; next} {print} END{if(!d) print "VOUCHER_SIGNER_PRIVATE_KEY=" ENVIRON["NEW"]}' "$f" > "$tmp"
chmod 600 "$tmp"; chown --reference="$f" "$tmp" 2>/dev/null || true; mv "$tmp" "$f"
docker compose up -d --no-deps --force-recreate points-backend >/dev/null
REMOTE
    healthy=0
    for _ in $(seq 1 "${HEALTH_ATTEMPTS:-30}"); do
      if curl -fsS -m 5 "${HEALTH_URL:-https://points-api.ifrunit.tech/health}" >/dev/null 2>&1; then healthy=1; break; fi
      sleep "${HEALTH_INTERVAL:-4}"
    done
    rollback="$ROOT/$BACKUP (original env) and $ROOT/$NEXT are kept; rerun activate to retry"
    [ "$healthy" = 1 ] || die "points-backend did not become healthy; $rollback"
    active=$(remote_active_address)
    [ "$active" = "$addr" ] || die "backend signer is $active, expected $addr; $rollback"
    # The backup still holds the old Safe-owner key: remove exactly it, the staging file and the marker.
    ssh "$HOST" "set -euo pipefail; cd '$ROOT'
      [ \"\$(cat '$MARKER')\" = '$BACKUP' ] && test -s '$BACKUP' && test -s '$NEXT' \
        || { echo 'refusing cleanup: marker, backup or staging file changed' >&2; exit 1; }
      shred -u '$BACKUP' '$NEXT' '$MARKER'"
    echo "ACTIVE: backend and FeeRouterV1 both use $addr."
    echo "Shredded on $HOST: the original env backup kept by activate and the staging key file. Other copies (older"
    echo "env backups, release backups, host snapshots) were not checked by this script."
    echo "Remaining step: the former signer replaces his Safe owner key in all three Safes."
    ;;
  *) die "usage: $0 prepare|status|activate" ;;
esac
