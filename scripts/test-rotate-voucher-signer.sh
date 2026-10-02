#!/usr/bin/env bash
# Local end-to-end test for scripts/ops/rotate-voucher-signer.sh (CWA-06).
# ssh and docker are replaced by shims that run the remote commands in a temp "host" directory;
# the on-chain check runs against a Mainnet fork where Governance sets the new signer.
# Usage: FORK_RPC=http://127.0.0.1:8549 bash scripts/test-rotate-voucher-signer.sh
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
host="$work/host"; bin="$work/bin"; mkdir -p "$host" "$bin"
OLD_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # public Hardhat test key
printf 'DATABASE_URL=file:/data/points.db\nVOUCHER_SIGNER_PRIVATE_KEY=%s\nPORT=3004\n' "$OLD_KEY" > "$host/.env.points-backend"
cat > "$bin/ssh" <<SH
#!/usr/bin/env bash
shift; cd "$host"; exec bash -c "\$*"
SH
cat > "$bin/docker" <<SH
#!/usr/bin/env bash
# docker compose exec -T points-backend node -e <code>  -> node with the backend env file
if [ "\$2" = exec ]; then shift 5; set -a; . "$host/.env.points-backend"; set +a; NODE_PATH="$repo/node_modules" exec node "\$@"; fi
echo "\$*" >> "$host/docker.log"
SH
command -v shred >/dev/null || printf '#!/usr/bin/env bash\n[ "$1" = -u ] && shift; rm -f -- "$@"\n' > "$bin/shred"   # macOS has no shred
chmod +x "$bin/"*
export PATH="$bin:$PATH" REMOTE_ROOT="$host" MAINNET_RPC="${FORK_RPC:?FORK_RPC required}" HEALTH_URL="${FORK_RPC}"
S="$repo/scripts/ops/rotate-voucher-signer.sh"

addr=$(bash "$S" prepare | sed -n 's/^NEW VOUCHER SIGNER ADDRESS: //p')
[[ "$addr" =~ ^0x[0-9a-f]{40}$ ]] || { echo "FAIL prepare: $addr"; exit 1; }
[ "$(stat -f %Lp "$host/.voucher-signer-next.key" 2>/dev/null || stat -c %a "$host/.voucher-signer-next.key")" = 600 ] || { echo "FAIL key mode"; exit 1; }
again=$(bash "$S" prepare 2>/dev/null | sed -n 's/^NEW VOUCHER SIGNER ADDRESS: //p'); [ "$again" = "$addr" ] || { echo "FAIL prepare not idempotent"; exit 1; }
if bash "$S" prepare 2>&1 | grep -q '0x[0-9a-f]\{64\}'; then echo "FAIL private key printed"; exit 1; fi

if bash "$S" activate >/dev/null 2>&1; then echo "FAIL activate before on-chain change"; exit 1; fi
grep -q "^VOUCHER_SIGNER_PRIVATE_KEY=$OLD_KEY$" "$host/.env.points-backend" || { echo "FAIL env changed early"; exit 1; }

# Governance (impersonated on the fork) executes setVoucherSigner(addr)
NODE_PATH="$repo/node_modules" ADDR="$addr" node -e '
const {ethers}=require("ethers");(async()=>{const p=new ethers.JsonRpcProvider(process.env.FORK_RPC);const g="0xc43d48E7FDA576C5022d0670B652A622E8caD041";
await p.send("hardhat_impersonateAccount",[g]);await p.send("hardhat_setBalance",[g,"0xde0b6b3a7640000"]);
const f=new ethers.Contract("0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a",["function setVoucherSigner(address)"],new ethers.JsonRpcSigner(p,g));
await (await f.setVoucherSigner(process.env.ADDR)).wait();})()'

out=$(bash "$S" activate)
echo "$out" | grep -q "ACTIVE: backend and FeeRouterV1 both use $addr" || { echo "FAIL activate: $out"; exit 1; }
! grep -q "$OLD_KEY" "$host"/.env.points-backend* || { echo "FAIL old key still on host"; exit 1; }
[ ! -e "$host/.voucher-signer-next.key" ] || { echo "FAIL staging key left"; exit 1; }
[ "$(grep -c '^VOUCHER_SIGNER_PRIVATE_KEY=' "$host/.env.points-backend")" = 1 ] || { echo "FAIL env key lines"; exit 1; }
grep -q '^PORT=3004$' "$host/.env.points-backend" || { echo "FAIL other env lines lost"; exit 1; }
grep -q 'up -d --no-deps --force-recreate points-backend' "$host/docker.log" || { echo "FAIL no recreate"; exit 1; }
st=$(bash "$S" status); echo "$st" | grep -q "active (backend): $addr" || { echo "FAIL status: $st"; exit 1; }
echo "[rotate-voucher-signer] PASS ($addr)"
