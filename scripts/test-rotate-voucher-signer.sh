#!/usr/bin/env bash
# Local end-to-end test for scripts/ops/rotate-voucher-signer.sh (CWA-06).
# ssh and docker are replaced by shims that run the remote commands in a temp "host" directory;
# the on-chain check runs against a Mainnet fork where Governance sets the new signer, reached through a local
# proxy that reports chainId 1 and can serve malformed RPC responses and a failing /health endpoint. The proxy
# answers Governance.getProposal(18) itself from a fixture (executed / pending / cancelled / wrong content).
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
echo normal > "$work/rpc-mode"; echo up > "$work/health-mode"; echo ok > "$work/proposal-mode"
cat > "$work/proxy.cjs" <<'JS'
// Test RPC proxy: chainId 1, forwards to the fork; modes inject malformed responses; /health follows health-mode.
const http = require("http"), fs = require("fs"), { Interface } = require("ethers");
const [work, fork] = process.argv.slice(2);
const GOV = "0xc43d48e7fda576c5022d0670b652a622e8cad041", ROUTER = "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a", ETA = 1791156347n;
const gov = new Interface(["function getProposal(uint256) view returns (address,bytes,uint256,bool,bool)"]);
const router = new Interface(["function setVoucherSigner(address)"]);
function proposal(m, id) { // getProposal(id) fixture for the prepared signer in $work/addr
  const data = router.encodeFunctionData("setVoucherSigner", [m === "wrongdata" ? "0x" + "77".repeat(20) : mode("addr")]);
  const p = [m === "wrongtarget" ? GOV : ROUTER, data, m === "wrongeta" ? ETA + 1n : ETA, m !== "unexecuted", m === "cancelled"];
  return gov.encodeFunctionResult("getProposal", id === 18n ? p : [ROUTER, "0x", 0n, false, false]);
}
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
    const to = call.params?.[0]?.to?.toLowerCase(), input = call.params?.[0]?.data || "";
    if (call.method === "eth_call" && to === GOV && input.startsWith("0xc7f758a8")) {
      const pm = mode("proposal-mode");
      if (pm === "rpcerror") return reply({ jsonrpc: "2.0", id: call.id, error: { code: -32000, message: "boom" } });
      return reply({ jsonrpc: "2.0", id: call.id, result: proposal(pm, gov.decodeFunctionData("getProposal", input)[0]) });
    }
    const r = await fetch(fork, { method: "POST", headers: { "content-type": "application/json" }, body });
    reply(await r.text());
  });
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(`${work}/proxy-port`, String(server.address().port)));
JS
NODE_PATH="$repo/node_modules" node "$work/proxy.cjs" "$work" "$FORK_RPC" & proxy_pid=$!
for _ in $(seq 1 50); do [ -s "$work/proxy-port" ] && break; sleep 0.1; done
proxy="http://127.0.0.1:$(cat "$work/proxy-port")"
export PATH="$bin:$PATH" REMOTE_ROOT="$host" MAINNET_RPC="$proxy" HEALTH_URL="$proxy/health" HEALTH_INTERVAL=0
S="$repo/scripts/ops/rotate-voucher-signer.sh"
BACKUP="$host/.env.points-backend.voucher-rotation.bak"; MARKER="$host/.voucher-signer-last-backup"; LOCK="$host/.voucher-signer-activate.lock"
env_untouched() {
  grep -q "^VOUCHER_SIGNER_PRIVATE_KEY=$OLD_KEY$" "$host/.env.points-backend" && [ -s "$host/.voucher-signer-next.key" ] \
    && [ ! -e "$BACKUP" ] && [ ! -e "$MARKER" ] && [ ! -e "$LOCK" ]
}
snapshot() { (cd "$host" && ls -A | grep -v '^docker.log$' | sort | while read -r f; do [ -f "$f" ] && echo "$f $(cksum < "$f")" || echo "$f"; done); }

addr=$(bash "$S" prepare | sed -n 's/^NEW VOUCHER SIGNER ADDRESS: //p')
[[ "$addr" =~ ^0x[0-9a-f]{40}$ ]] || { echo "FAIL prepare: $addr"; exit 1; }
[ "$(stat -f %Lp "$host/.voucher-signer-next.key" 2>/dev/null || stat -c %a "$host/.voucher-signer-next.key")" = 600 ] || { echo "FAIL key mode"; exit 1; }
again=$(bash "$S" prepare 2>/dev/null | sed -n 's/^NEW VOUCHER SIGNER ADDRESS: //p'); [ "$again" = "$addr" ] || { echo "FAIL prepare not idempotent"; exit 1; }
if bash "$S" prepare 2>&1 | grep -q '0x[0-9a-f]\{64\}'; then echo "FAIL private key printed"; exit 1; fi
echo "$addr" > "$work/addr"

# Malformed or foreign RPC responses must stop activate before the host is touched.
for m in nonjson error wrongchain short dirty; do
  echo "$m" > "$work/rpc-mode"
  if bash "$S" activate >/dev/null 2>&1; then echo "FAIL activate accepted RPC mode $m"; exit 1; fi
  env_untouched || { echo "FAIL host changed under RPC mode $m"; exit 1; }
  if bash "$S" status 2>/dev/null | grep -q 'voucherSigner: 0x[0-9a-f]\{40\}'; then echo "FAIL status printed a signer under RPC mode $m"; exit 1; fi
done
echo normal > "$work/rpc-mode"

# Proposal 18 must be exactly setVoucherSigner(prepared) with the pinned ETA, executed and not cancelled.
for m in unexecuted cancelled wrongdata wrongeta wrongtarget rpcerror; do
  echo "$m" > "$work/proposal-mode"
  if out=$(bash "$S" activate 2>&1); then echo "FAIL activate accepted proposal mode $m"; exit 1; fi
  echo "$out" | grep -q "proposal 18\|getProposal(18)" || { echo "FAIL proposal mode $m message: $out"; exit 1; }
  env_untouched || { echo "FAIL host changed under proposal mode $m"; exit 1; }
done
echo ok > "$work/proposal-mode"

if bash "$S" activate >/dev/null 2>&1; then echo "FAIL activate before on-chain change"; exit 1; fi
env_untouched || { echo "FAIL env changed early"; exit 1; }

# A held lock (concurrent or killed activation) refuses before anything is read or changed, and stays in place.
mkdir "$LOCK"
if out=$(bash "$S" activate 2>&1); then echo "FAIL activate ran while locked"; exit 1; fi
echo "$out" | grep -q "another activation" || { echo "FAIL lock message: $out"; exit 1; }
[ -d "$LOCK" ] || { echo "FAIL refused run removed the foreign lock"; exit 1; }
rmdir "$LOCK"; env_untouched || { echo "FAIL host changed while locked"; exit 1; }

# Governance (impersonated on the fork) executes setVoucherSigner(addr)
NODE_PATH="$repo/node_modules" ADDR="$addr" node -e '
const {ethers}=require("ethers");(async()=>{const p=new ethers.JsonRpcProvider(process.env.FORK_RPC);const g="0xc43d48E7FDA576C5022d0670B652A622E8caD041";
await p.send("hardhat_impersonateAccount",[g]);await p.send("hardhat_setBalance",[g,"0xde0b6b3a7640000"]);
const f=new ethers.Contract("0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a",["function setVoucherSigner(address)"],new ethers.JsonRpcSigner(p,g));
await (await f.setVoucherSigner(process.env.ADDR)).wait();})()'

# Health stays down twice: both runs fail, the first keeps the one original backup and the retry must not replace it.
echo down > "$work/health-mode"
for run in 1 2; do
  if out=$(HEALTH_ATTEMPTS=2 bash "$S" activate 2>&1); then echo "FAIL activate succeeded with health down ($run)"; exit 1; fi
  echo "$out" | grep -q "did not become healthy" || { echo "FAIL health-down message ($run): $out"; exit 1; }
  if echo "$out" | grep -q '0x[0-9a-f]\{64\}'; then echo "FAIL private key printed on failure"; exit 1; fi
  [ "$(cat "$MARKER")" = .env.points-backend.voucher-rotation.bak ] || { echo "FAIL marker ($run)"; exit 1; }
  grep -qx "VOUCHER_SIGNER_PRIVATE_KEY=$OLD_KEY" "$BACKUP" || { echo "FAIL original backup lost the old key ($run)"; exit 1; }
  [ "$(grep -l "$OLD_KEY" "$host"/.env.points-backend* | wc -l | tr -d ' ')" = 1 ] || { echo "FAIL old key not in exactly one backup ($run)"; exit 1; }
  [ "$(ls -A "$host" | grep -c '^\.env\.points-backend')" = 2 ] || { echo "FAIL stray env copies ($run)"; ls -A "$host"; exit 1; }
  ! grep -q "$OLD_KEY" "$host/.env.points-backend" || { echo "FAIL env not switched ($run)"; exit 1; }
  [ -s "$host/.voucher-signer-next.key" ] && [ ! -e "$LOCK" ] || { echo "FAIL staging key or lock state ($run)"; exit 1; }
done
echo up > "$work/health-mode"

# Inconsistent marker / backup / staging state is refused with the host left exactly as it was.
refused() { # $1 = label; activate must fail without changing any host file
  local before; before=$(snapshot)
  if out=$(bash "$S" activate 2>&1); then echo "FAIL activate accepted $1"; exit 1; fi
  [ "$(snapshot)" = "$before" ] || { echo "FAIL host changed for $1: $out"; exit 1; }
}
cp -p "$MARKER" "$work/marker"; echo .env.points-backend.bak-other > "$MARKER"; refused "a marker naming another file"
cp -p "$work/marker" "$MARKER"
mv "$BACKUP" "$work/backup"; refused "a marker whose backup is missing"; mv "$work/backup" "$BACKUP"
cp -p "$host/.env.points-backend" "$work/env"; cp -p "$BACKUP" "$host/.env.points-backend"   # even with the env rolled back
mv "$MARKER" "$work/marker"; refused "a backup without marker"; mv "$work/marker" "$MARKER"
cp -p "$work/env" "$host/.env.points-backend"
mv "$host/.voucher-signer-next.key" "$work/next"; refused "a marker without staging key"
printf '0x1234' > "$host/.voucher-signer-next.key"; refused "a malformed staging key"
mv "$work/next" "$host/.voucher-signer-next.key"
cp -p "$BACKUP" "$work/backup"; cp "$host/.env.points-backend" "$BACKUP"; refused "a backup holding the prepared key"
cp -p "$work/backup" "$BACKUP"
printf 'VOUCHER_SIGNER_PRIVATE_KEY=0x%064d\n' 7 >> "$host/.env.points-backend"; refused "an env file with two key lines"
sed -i.x '$d' "$host/.env.points-backend"; rm -f "$host/.env.points-backend.x"

# Documented rollback keeps the backup in place (copy, not move); the retry then switches and cleans up.
cp -p "$BACKUP" "$host/.env.points-backend"
grep -qx "VOUCHER_SIGNER_PRIVATE_KEY=$OLD_KEY" "$host/.env.points-backend" || { echo "FAIL rollback did not restore the old env"; exit 1; }
out=$(bash "$S" activate)
echo "$out" | grep -q "ACTIVE: backend and FeeRouterV1 both use $addr" || { echo "FAIL activate: $out"; exit 1; }
echo "$out" | grep -q "were not checked by this script" || { echo "FAIL shred statement not bounded: $out"; exit 1; }
! grep -q "$OLD_KEY" "$host"/.env.points-backend* || { echo "FAIL old key still on host"; exit 1; }
[ ! -e "$host/.voucher-signer-next.key" ] || { echo "FAIL staging key left"; exit 1; }
[ ! -e "$BACKUP" ] && [ ! -e "$MARKER" ] && [ ! -e "$LOCK" ] || { echo "FAIL backup, marker or lock left"; exit 1; }
[ "$(grep -c '^VOUCHER_SIGNER_PRIVATE_KEY=' "$host/.env.points-backend")" = 1 ] || { echo "FAIL env key lines"; exit 1; }
grep -q '^PORT=3004$' "$host/.env.points-backend" || { echo "FAIL other env lines lost"; exit 1; }
grep -q 'up -d --no-deps --force-recreate points-backend' "$host/docker.log" || { echo "FAIL no recreate"; exit 1; }
st=$(bash "$S" status); echo "$st" | grep -q "active (backend): $addr" || { echo "FAIL status: $st"; exit 1; }
echo "[rotate-voucher-signer] PASS ($addr)"
