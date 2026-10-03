#!/usr/bin/env bash
# Local end-to-end test for scripts/ops/rotate-voucher-signer.sh (CWA-06).
# ssh and docker are replaced by shims that run the remote commands in a temp "host" directory;
# the on-chain check runs against a Mainnet fork where Governance sets the new signer, reached through a local
# proxy that reports chainId 1 and can serve malformed RPC responses and a failing /health endpoint.
# Usage: FORK_RPC=http://127.0.0.1:8549 bash scripts/test-rotate-voucher-signer.sh
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
cleanup() { [ -n "${proxy_pid:-}" ] && kill "$proxy_pid" 2>/dev/null; rm -rf "$work"; }
trap cleanup EXIT
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
: "${FORK_RPC:?FORK_RPC required}"
echo normal > "$work/rpc-mode"; echo up > "$work/health-mode"
cat > "$work/proxy.cjs" <<'JS'
// Test RPC proxy: chainId 1, forwards to the fork; modes inject malformed responses; /health follows health-mode.
const http = require("http"), fs = require("fs");
const [work, fork] = process.argv.slice(2);
const mode = (f) => fs.readFileSync(`${work}/${f}`, "utf8").trim();
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    const up = mode("health-mode") === "up";
    res.writeHead(up ? 200 : 503); return res.end(up ? "ok" : "down");
  }
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", async () => {
    const call = JSON.parse(body), m = mode("rpc-mode");
    const reply = (obj) => { res.writeHead(200, { "content-type": "application/json" }); res.end(typeof obj === "string" ? obj : JSON.stringify(obj)); };
    if (m === "nonjson") return reply("<html>gateway error</html>");
    if (m === "error") return reply({ jsonrpc: "2.0", id: call.id, error: { code: -32000, message: "boom" } });
    if (call.method === "eth_chainId") return reply({ jsonrpc: "2.0", id: call.id, result: m === "wrongchain" ? "0xaa36a7" : "0x1" });
    if (m === "short") return reply({ jsonrpc: "2.0", id: call.id, result: "0x1234" });
    if (m === "dirty") return reply({ jsonrpc: "2.0", id: call.id, result: "0x" + "ff".repeat(12) + "11".repeat(20) });
    const r = await fetch(fork, { method: "POST", headers: { "content-type": "application/json" }, body });
    reply(await r.text());
  });
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(`${work}/proxy-port`, String(server.address().port)));
JS
node "$work/proxy.cjs" "$work" "$FORK_RPC" & proxy_pid=$!
for _ in $(seq 1 50); do [ -s "$work/proxy-port" ] && break; sleep 0.1; done
proxy="http://127.0.0.1:$(cat "$work/proxy-port")"
export PATH="$bin:$PATH" REMOTE_ROOT="$host" MAINNET_RPC="$proxy" HEALTH_URL="$proxy/health" HEALTH_INTERVAL=0
S="$repo/scripts/ops/rotate-voucher-signer.sh"
env_untouched() { grep -q "^VOUCHER_SIGNER_PRIVATE_KEY=$OLD_KEY$" "$host/.env.points-backend" && [ -s "$host/.voucher-signer-next.key" ]; }

addr=$(bash "$S" prepare | sed -n 's/^NEW VOUCHER SIGNER ADDRESS: //p')
[[ "$addr" =~ ^0x[0-9a-f]{40}$ ]] || { echo "FAIL prepare: $addr"; exit 1; }
[ "$(stat -f %Lp "$host/.voucher-signer-next.key" 2>/dev/null || stat -c %a "$host/.voucher-signer-next.key")" = 600 ] || { echo "FAIL key mode"; exit 1; }
again=$(bash "$S" prepare 2>/dev/null | sed -n 's/^NEW VOUCHER SIGNER ADDRESS: //p'); [ "$again" = "$addr" ] || { echo "FAIL prepare not idempotent"; exit 1; }
if bash "$S" prepare 2>&1 | grep -q '0x[0-9a-f]\{64\}'; then echo "FAIL private key printed"; exit 1; fi

# Malformed or foreign RPC responses must stop activate before the host is touched.
for m in nonjson error wrongchain short dirty; do
  echo "$m" > "$work/rpc-mode"
  if bash "$S" activate >/dev/null 2>&1; then echo "FAIL activate accepted RPC mode $m"; exit 1; fi
  env_untouched || { echo "FAIL host changed under RPC mode $m"; exit 1; }
  if bash "$S" status 2>/dev/null | grep -q 'voucherSigner: 0x[0-9a-f]\{40\}'; then echo "FAIL status printed a signer under RPC mode $m"; exit 1; fi
done
echo normal > "$work/rpc-mode"

if bash "$S" activate >/dev/null 2>&1; then echo "FAIL activate before on-chain change"; exit 1; fi
grep -q "^VOUCHER_SIGNER_PRIVATE_KEY=$OLD_KEY$" "$host/.env.points-backend" || { echo "FAIL env changed early"; exit 1; }

# Governance (impersonated on the fork) executes setVoucherSigner(addr)
NODE_PATH="$repo/node_modules" ADDR="$addr" node -e '
const {ethers}=require("ethers");(async()=>{const p=new ethers.JsonRpcProvider(process.env.FORK_RPC);const g="0xc43d48E7FDA576C5022d0670B652A622E8caD041";
await p.send("hardhat_impersonateAccount",[g]);await p.send("hardhat_setBalance",[g,"0xde0b6b3a7640000"]);
const f=new ethers.Contract("0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a",["function setVoucherSigner(address)"],new ethers.JsonRpcSigner(p,g));
await (await f.setVoucherSigner(process.env.ADDR)).wait();})()'

# Health stays down: activate must fail and keep the rollback material (env backup with the old key + staging key).
echo down > "$work/health-mode"
if out=$(HEALTH_ATTEMPTS=2 bash "$S" activate 2>&1); then echo "FAIL activate succeeded with health down"; exit 1; fi
echo "$out" | grep -q "did not become healthy" || { echo "FAIL health-down message: $out"; exit 1; }
backup="$host/$(cat "$host/.voucher-signer-last-backup")"
grep -q "^VOUCHER_SIGNER_PRIVATE_KEY=$OLD_KEY$" "$backup" || { echo "FAIL rollback backup missing old key"; exit 1; }
[ -s "$host/.voucher-signer-next.key" ] || { echo "FAIL staging key removed on health failure"; exit 1; }
if echo "$out" | grep -q '0x[0-9a-f]\{64\}'; then echo "FAIL private key printed on failure"; exit 1; fi
# Operator rollback (as documented): move the backup back, then retry with a healthy backend.
mv "$backup" "$host/.env.points-backend"; rm "$host/.voucher-signer-last-backup"
env_untouched || { echo "FAIL rollback did not restore the old env"; exit 1; }
echo up > "$work/health-mode"

out=$(bash "$S" activate)
echo "$out" | grep -q "ACTIVE: backend and FeeRouterV1 both use $addr" || { echo "FAIL activate: $out"; exit 1; }
echo "$out" | grep -q "were not checked by this script" || { echo "FAIL shred statement not bounded: $out"; exit 1; }
! grep -q "$OLD_KEY" "$host"/.env.points-backend* || { echo "FAIL old key still on host"; exit 1; }
[ ! -e "$host/.voucher-signer-next.key" ] || { echo "FAIL staging key left"; exit 1; }
[ "$(grep -c '^VOUCHER_SIGNER_PRIVATE_KEY=' "$host/.env.points-backend")" = 1 ] || { echo "FAIL env key lines"; exit 1; }
grep -q '^PORT=3004$' "$host/.env.points-backend" || { echo "FAIL other env lines lost"; exit 1; }
grep -q 'up -d --no-deps --force-recreate points-backend' "$host/docker.log" || { echo "FAIL no recreate"; exit 1; }
st=$(bash "$S" status); echo "$st" | grep -q "active (backend): $addr" || { echo "FAIL status: $st"; exit 1; }
echo "[rotate-voucher-signer] PASS ($addr)"
