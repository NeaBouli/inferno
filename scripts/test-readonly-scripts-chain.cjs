// Wrong-chain rejection for the read-only CLI scripts (Codex review on PR #192):
// scripts/check-balances.js and scripts/check-ownership.js must refuse to read when the RPC
// endpoint reports a chainId other than 1, and must not perform any eth_call in that case.
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

// The fake RPC runs in this process, so the child must be spawned asynchronously (spawnSync would block it).
function run(script, url) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], { env: { ...process.env, MAINNET_RPC_URL: url } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, out }); });
  });
}

async function withRpc(chainIdHex, fn) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const reqs = [].concat(JSON.parse(body || "[]"));
      const out = reqs.map((r) => {
        calls.push(r.method);
        const result = r.method === "eth_chainId" ? chainIdHex : r.method === "net_version" ? String(parseInt(chainIdHex, 16)) : r.method === "eth_blockNumber" ? "0x1" : "0x";
        return { jsonrpc: "2.0", id: r.id, result };
      });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(Array.isArray(JSON.parse(body)) ? out : out[0]));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, calls);
  } finally {
    server.close();
  }
}

(async () => {
  for (const script of ["check-balances.js", "check-ownership.js"]) {
    await withRpc("0x5", async (url, calls) => {
      const r = await run(script, url);
      assert.notEqual(r.status, 0, `${script} must exit non-zero on chainId 5`);
      assert.match(r.out, /expected Ethereum Mainnet \(1\)/, `${script} must explain the chain mismatch`);
      assert.ok(!calls.includes("eth_call"), `${script} must not read contract state on a wrong chain`);
    });
  }
  console.log("[readonly-scripts-chain] PASS - check-balances/check-ownership refuse non-Mainnet chainId before any eth_call");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
