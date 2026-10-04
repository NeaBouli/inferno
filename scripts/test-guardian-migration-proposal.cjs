// Unit test for scripts/guardian-migration-proposal.cjs (CWA-09).
// Covers the offline fixture, the pinned queued-proposal verification (exact id/target/calldata/ETA,
// executed/cancelled refusal, wrong-chain and unreadable RPC) and the CLI mode boundary.
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { Interface } = require("ethers");
const {
  build, buildVerifiedExecute, verifyQueuedProposals, rpcCaller,
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

  // CLI boundary: no mode writes files without verification; fixture mode is explicit.
  const run = (args, env = {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, "guardian-migration-proposal.cjs"), ...args], { env: { ...process.env, ...env } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (status) => resolve({ status, out }));
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t242-guardian-"));
  let r = await run([], {});
  assert.notEqual(r.status, 0);
  assert.match(r.out, /usage: --execute/);
  r = await run(["19", tmp], {});
  assert.notEqual(r.status, 0, "a bare positional id (legacy form) must not write anything");
  assert.equal(fs.readdirSync(tmp).length, 0);
  r = await run(["--execute", tmp], { MAINNET_RPC_URL: "http://127.0.0.1:9" });
  assert.notEqual(r.status, 0, "--execute must refuse an unreachable RPC");
  assert.equal(fs.readdirSync(tmp).length, 0, "no execute file without on-chain verification");
  r = await run(["--fixture", "19", tmp]);
  assert.equal(r.status, 0);
  assert.deepEqual(fs.readdirSync(tmp).sort(), ["guardian-deployer-txs.json", "guardian-step1-safe.json", "guardian-step2-execute.json"]);
  assert.match(r.out, /do not sign/);
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log("[guardian-migration-proposal] PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
