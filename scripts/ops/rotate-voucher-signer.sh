#!/usr/bin/env bash
# CWA-06: move the FeeRouterV1 voucher signer off a Safe owner key onto a dedicated key.
# The new private key is generated on the production host inside the points-backend container
# and written straight to a root-only file; it never appears on screen, in chat, logs or git.
#
#   bash scripts/ops/rotate-voucher-signer.sh prepare    # create the new key on the host, print its ADDRESS
#   bash scripts/ops/rotate-voucher-signer.sh status     # show next/active signer addresses and the on-chain signer
#   bash scripts/ops/rotate-voucher-signer.sh activate   # after Governance executed setVoucherSigner(new): switch the backend
#
# Operator only (needs the host operator SSH key; the read-only agent key cannot do this).
set -euo pipefail

HOST="${SSH_HOST:-hetzner}"
ROOT="${REMOTE_ROOT:-/opt/inferno}"
ENV_FILE=".env.points-backend"
NEXT=".voucher-signer-next.key"
RPC="${MAINNET_RPC:-https://ethereum-rpc.publicnode.com}"
FEE_ROUTER="0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a"
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

# Prints FeeRouterV1.voucherSigner() from Ethereum Mainnet; fails closed on any RPC problem.
onchain_signer() {
  local chain word
  chain=$(rpc_call eth_chainId '[]' | rpc_result) || die "eth_chainId failed"
  [ "$chain" = "0x1" ] || die "RPC is not Ethereum Mainnet (chainId $chain)"
  word=$(rpc_call eth_call "[{\"to\":\"$FEE_ROUTER\",\"data\":\"0x88f4c137\"},\"latest\"]" | rpc_result) || die "voucherSigner() call failed"
  [[ "$word" =~ ^0x0{24}[0-9a-f]{40}$ ]] || die "voucherSigner() returned an unexpected value"
  echo "0x${word:26:40}"
}

# Prints the address for the key in $1 (a file under $ROOT, read on the host); never prints the key.
remote_address_of() {
  ssh "$HOST" "set -euo pipefail; cd '$ROOT'; test -s '$1' || exit 3
    docker compose exec -T points-backend node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>console.log(new (require(\"ethers\").Wallet)(s.trim()).address))' < '$1'" | lower
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
    echo "Next: node scripts/voucher-signer-rotation-proposal.cjs $addr <Governance.proposalCount()> <outDir>"
    ;;
  status)
    echo "next (prepared): $(remote_address_of "$NEXT" 2>/dev/null || echo none)"
    echo "active (backend): $(remote_active_address)"
    echo "on-chain FeeRouterV1.voucherSigner: $(onchain_signer)"
    ;;
  activate)
    addr=$(remote_address_of "$NEXT") || die "no prepared key on $HOST; run prepare first"
    chain=$(onchain_signer)
    [ "$addr" = "$chain" ] || die "on-chain voucherSigner is $chain, prepared key is $addr: execute the Governance proposal first"
    ssh "$HOST" "set -euo pipefail; cd '$ROOT'; umask 077
      f='$ENV_FILE'; test -f \"\$f\" || { echo \"missing \$f\" >&2; exit 1; }
      ts=\$(date -u +%Y%m%dT%H%M%SZ); cp -p \"\$f\" \"\$f.bak-\$ts\"
      tmp=\$(mktemp \"\$f.XXXXXX\")
      NEW=\"\$(cat '$NEXT')\" awk 'BEGIN{d=0} /^VOUCHER_SIGNER_PRIVATE_KEY=/{print \"VOUCHER_SIGNER_PRIVATE_KEY=\" ENVIRON[\"NEW\"]; d=1; next} {print} END{if(!d) print \"VOUCHER_SIGNER_PRIVATE_KEY=\" ENVIRON[\"NEW\"]}' \"\$f\" > \"\$tmp\"
      chmod 600 \"\$tmp\"; chown --reference=\"\$f\" \"\$tmp\" 2>/dev/null || true; mv \"\$tmp\" \"\$f\"
      echo \"\$f.bak-\$ts\" > .voucher-signer-last-backup
      docker compose up -d --no-deps --force-recreate points-backend >/dev/null"
    healthy=0
    for _ in $(seq 1 "${HEALTH_ATTEMPTS:-30}"); do
      if curl -fsS -m 5 "${HEALTH_URL:-https://points-api.ifrunit.tech/health}" >/dev/null 2>&1; then healthy=1; break; fi
      sleep "${HEALTH_INTERVAL:-4}"
    done
    rollback="the env backup named in $ROOT/.voucher-signer-last-backup and $ROOT/$NEXT are kept for rollback"
    [ "$healthy" = 1 ] || die "points-backend did not become healthy; $rollback"
    active=$(remote_active_address)
    [ "$active" = "$addr" ] || die "backend signer is $active, expected $addr; $rollback"
    # The backup still holds the old Safe-owner key: remove it and the staging file once the switch is verified.
    ssh "$HOST" "set -euo pipefail; cd '$ROOT'; b=\$(cat .voucher-signer-last-backup); shred -u \"\$b\" '$NEXT' .voucher-signer-last-backup"
    echo "ACTIVE: backend and FeeRouterV1 both use $addr."
    echo "Shredded on $HOST: the env backup made by this run and the staging key file. Other copies (older env backups,"
    echo "release backups, host snapshots) were not checked by this script."
    echo "Remaining step: the former signer replaces his Safe owner key in all three Safes."
    ;;
  *) die "usage: $0 prepare|status|activate" ;;
esac
