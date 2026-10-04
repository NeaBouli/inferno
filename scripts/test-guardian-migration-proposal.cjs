// Unit test for scripts/guardian-migration-proposal.cjs (CWA-09).
// Covers the offline fixture, the pinned queued-proposal verification (exact id/target/calldata/ETA,
// executed/cancelled refusal, wrong-chain and unreadable RPC), the rpcCaller transport boundary (non-2xx,
// malformed envelope, timeout) and the CLI mode boundary (--execute only, verified output only).
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { Interface } = require("ethers");
const {
  build, buildVerifiedExecute, verifyQueuedProposals, rpcCaller, RPC_TIMEOUT_MS,
  C, TREASURY_SAFE, DEPLOYER, QUEUED, QUEUED_ETA, GUARDIAN_INNER,
} = require("./guardian-migration-proposal.cjs");

const gov = new Interface(["function setGuardian(address)", "function propose(address,bytes)", "function execute(uint256)"]);
const g = new Interface(["function setGuardian(address)", "function transferGuardian(address)"]);
const f = build("19");
const s1 = f["guardian-step1-safe.json"].transactions, s2 = f["guardian-step2-execute.json"].transactions;
assert.equal(f["guardian-step1-safe.json"].chainId, "1");
assert.deepEqual(s1.map((t) => t.to), [C.Governance, C.Governance, C.Governance]);
assert.ok(s1.every((t) => t.value === "0"));
assert.equal(gov.decodeFunctionData("setGuardian", s1[0].data)[0], TREASURY_SAFE);
for (const [i, target] of [[1, C.LiquidityReserve], [2, C.BurnReserve]]) {
  const [to, data] = gov.decodeFunctionData("propose", s1[i].data);
  assert.equal(to, target);
  assert.equal(g.decodeFunctionData("setGuardian", data)[0], TREASURY_SAFE);
}
assert.deepEqual(s2.map((t) => gov.decodeFunctionData("execute", t.data)[0]), [19n, 20n]);
const d = f["guardian-deployer-txs.json"];
assert.equal(d.from, DEPLOYER);
assert.deepEqual(d.transactions.map((t) => t.to), [C.IFRLock, C.PartnerVault, C.Vesting]);
assert.equal(g.decodeFunctionData("setGuardian", d.transactions[0].data)[0], TREASURY_SAFE);
assert.equal(g.decodeFunctionData("setGuardian", d.transactions[1].data)[0], TREASURY_SAFE);
assert.equal(g.decodeFunctionData("transferGuardian", d.transactions[2].data)[0], TREASURY_SAFE);
assert.throws(() => build("x"), /non-negative integer/);
assert.throws(() => build("-1"), /non-negative integer/);

// The queued Mainnet operations are pinned by exact bytes (read-only evidence at block 26119897).
assert.deepEqual(QUEUED.map((p) => p.id), [19n, 20n]);
assert.deepEqual(QUEUED.map((p) => p.target), [C.LiquidityReserve, C.BurnReserve]);
assert.equal(QUEUED_ETA, 1791158171n, "ETA 2026-10-04T23:56:11.000Z");
assert.equal(GUARDIAN_INNER, "0x8a0dac4a0000000000000000000000005ad6193ed6e1e31ed10977e73e3b609acbfece3b");
const EXEC_19 = "0xfe0d94c1" + "13".padStart(64, "0");
const EXEC_20 = "0xfe0d94c1" + "14".padStart(64, "0");

// Fake eth_call answering Governance.getProposal with queued mainnet-shaped values; refuses any other id.
const govAbi = new Interface(["function getProposal(uint256) view returns (address,bytes,uint256,bool,bool)"]);
const fakeCall = (overrides = {}) => async (to, callData) => {
  assert.equal(to, C.Governance);
  const id = govAbi.decodeFunctionData("getProposal", callData)[0];
  const p = QUEUED.find((q) => q.id === id);
  assert.ok(p, `verifier must only read the pinned ids, got #${id}`);
  const v = { target: p.target, data: GUARDIAN_INNER, eta: QUEUED_ETA, executed: false, cancelled: false, ...overrides[id.toString()] };
  return govAbi.encodeFunctionResult("getProposal", [v.target, v.data, v.eta, v.executed, v.cancelled]);
};

(async () => {
  const files = await buildVerifiedExecute(fakeCall());
  const txs = files["guardian-step2-execute.json"].transactions;
  assert.deepEqual(Object.keys(files), ["guardian-step2-execute.json"], "verified mode writes only the execute batch");
  assert.deepEqual(txs.map((t) => t.data), [EXEC_19, EXEC_20]);
  assert.ok(txs.every((t) => t.to === C.Governance && t.value === "0"));

  // Negative matrix: every drift from the pinned queued content must refuse.
  await assert.rejects(verifyQueuedProposals(fakeCall({ 19: { eta: 0n } })), /#19 does not exist/);
  await assert.rejects(verifyQueuedProposals(fakeCall({ 20: { target: C.Governance } })), /#20 targets .* not BurnReserve/);
  await assert.rejects(verifyQueuedProposals(fakeCall({ 19: { data: g.encodeFunctionData("setGuardian", [DEPLOYER]) } })), /#19 data is not LiquidityReserve\.setGuardian/);
  await assert.rejects(verifyQueuedProposals(fakeCall({ 20: { eta: QUEUED_ETA + 1n } })), /#20 ETA .* is not the pinned/);
  await assert.rejects(verifyQueuedProposals(fakeCall({ 19: { executed: true } })), /#19 is already executed/);
  await assert.rejects(verifyQueuedProposals(fakeCall({ 20: { cancelled: true } })), /#20 is cancelled/);
  await assert.rejects(verifyQueuedProposals(async () => { throw new Error("connection refused"); }), /connection refused/);

  // rpcCaller: wrong chain refuses before any eth_call; RPC errors and unreadable endpoints refuse.
  const withRpc = async (chainIdHex, fn) => {
    const calls = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const r = JSON.parse(body || "{}");
        calls.push(r.method);
        const EMPTY = govAbi.encodeFunctionResult("getProposal", ["0x0000000000000000000000000000000000000000", "0x", 0n, false, false]);
        const result = r.method === "eth_chainId" ? chainIdHex : EMPTY;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: r.id, result }));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      return await fn(`http://127.0.0.1:${server.address().port}`, calls);
    } finally {
      server.close();
    }
  };
  await withRpc("0x5", async (url, calls) => {
    await assert.rejects(verifyQueuedProposals(rpcCaller(url)), /not Ethereum Mainnet/);
    assert.deepEqual(calls, ["eth_chainId"], "no eth_call may leave a wrong-chain client");
  });
  await withRpc("0x1", async (url) => {
    await assert.rejects(verifyQueuedProposals(rpcCaller(url)), /#19 does not exist/, "empty getProposal result (eta 0) refuses");
  });
  const dead = rpcCaller("http://127.0.0.1:9");
  await assert.rejects(verifyQueuedProposals(dead));

  // rpcCaller transport (global.fetch stub, no network): only a 2xx response carrying a well-formed
  // JSON-RPC envelope (jsonrpc "2.0", the request id, a hex result, no error) is accepted; every refusal
  // is generic and nothing is returned to write.
  const realFetch = global.fetch;
  const stubFetch = (respond) => {
    global.fetch = async (_url, init) => {
      assert.ok(init.signal instanceof AbortSignal, "every RPC request must carry a timeout signal");
      return respond(JSON.parse(init.body), init);
    };
  };
  const reply = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const chainOk = (req) => ({ jsonrpc: "2.0", id: req.id, result: "0x1" });
  const GENERIC = /^refusing: RPC (eth_chainId|eth_call) (failed|returned an invalid response)$/;
  const refuses = (caller, re = GENERIC) => assert.rejects(buildVerifiedExecute(caller), (e) => re.test(e.message));
  try {
    for (const status of [500, 502, 404]) {
      stubFetch((req) => reply(status, chainOk(req)));
      await refuses(rpcCaller("http://rpc.invalid"), /^refusing: RPC eth_chainId failed$/);
    }
    const malformed = [
      () => "not json",
      () => "null",
      (req) => [chainOk(req)],
      (req) => ({ id: req.id, result: "0x1" }),
      (req) => ({ jsonrpc: "1.0", id: req.id, result: "0x1" }),
      (req) => ({ jsonrpc: "2.0", id: req.id + 1, result: "0x1" }),
      (req) => ({ jsonrpc: "2.0", result: "0x1" }),
      (req) => ({ jsonrpc: "2.0", id: req.id, result: "0x1", error: { code: -32000, message: "upstream detail" } }),
      (req) => ({ jsonrpc: "2.0", id: req.id, result: 1 }),
      (req) => ({ jsonrpc: "2.0", id: req.id, result: "0xzz" }),
    ];
    for (const body of malformed) {
      stubFetch((req) => reply(200, body(req)));
      await refuses(rpcCaller("http://rpc.invalid"), /^refusing: RPC eth_chainId (failed|returned an invalid response)$/);
    }
    stubFetch((req) => reply(200, req.method === "eth_chainId" ? chainOk(req) : { jsonrpc: "2.0", id: req.id, error: { message: "upstream detail" } }));
    await refuses(rpcCaller("http://rpc.invalid"), /^refusing: RPC eth_call returned an invalid response$/);
    stubFetch((req) => reply(500, req.method === "eth_chainId" ? chainOk(req) : { jsonrpc: "2.0", id: req.id, result: "0x" }));
    await refuses(rpcCaller("http://rpc.invalid"), /^refusing: RPC eth_chainId failed$/);
    stubFetch((_req, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
    // AbortSignal.timeout timers are unref'd; keep the loop alive so a missing timeout fails instead of exiting.
    const started = Date.now();
    const keepAlive = setTimeout(() => {}, 5000);
    await refuses(rpcCaller("http://rpc.invalid", { timeoutMs: 50 }), /^refusing: RPC eth_chainId failed$/);
    clearTimeout(keepAlive);
    assert.ok(Date.now() - started < 5000, "a hanging RPC must be aborted by the timeout");
  } finally {
    global.fetch = realFetch;
  }
  assert.equal(RPC_TIMEOUT_MS, 10_000);

  // CLI boundary: --execute is the only mode and writes nothing unless verification passes. Every run uses
  // the empty tmp dir as cwd so a stray relative write would be caught too.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t242a-guardian-"));
  const run = (args, env = {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, "guardian-migration-proposal.cjs"), ...args], { cwd: tmp, env: { ...process.env, ...env } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (status) => resolve({ status, out }));
  });
  const refusesCli = async (args, env, re, why) => {
    const r = await run(args, env);
    assert.notEqual(r.status, 0, why);
    assert.match(r.out, re, why);
    assert.deepEqual(fs.readdirSync(tmp), [], `${why}: no file may be written`);
  };
  const withServer = async (handler, fn) => {
    const server = http.createServer(handler);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      return await fn(`http://127.0.0.1:${server.address().port}`);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  };
  const USAGE = /usage: --execute \[outDir\]/;
  await refusesCli([], {}, USAGE, "no mode");
  await refusesCli(["19", tmp], {}, USAGE, "a bare positional id (legacy form)");
  await refusesCli(["--fixture", "19", tmp], {}, USAGE, "the removed --fixture mode");
  await refusesCli(["--fixture", "19"], {}, USAGE, "the removed --fixture mode without outDir");
  await refusesCli(["--execute", tmp, "extra"], {}, USAGE, "an unexpected extra argument");
  await refusesCli(["--execute", "--fixture"], {}, USAGE, "a flag in the outDir position");
  await refusesCli(["--execute", tmp], { MAINNET_RPC_URL: "http://127.0.0.1:9" }, /^refusing: RPC eth_chainId failed$/m, "an unreachable RPC");
  await withServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(body).id, result: "0x1" }));
    });
  }, (url) => refusesCli(["--execute", tmp], { MAINNET_RPC_URL: url }, /^refusing: RPC eth_chainId failed$/m, "HTTP 500 with a valid-looking body"));
  await withServer(() => {}, (url) => refusesCli(["--execute", tmp], { MAINNET_RPC_URL: url }, /^refusing: RPC eth_chainId failed$/m, "a hanging RPC (timeout)"));
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log("[guardian-migration-proposal] PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
