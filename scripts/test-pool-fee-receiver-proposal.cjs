// Unit test for scripts/pool-fee-receiver-proposal.cjs (Lane 3 decision B, CWA-02).
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
  build, buildVerifiedExecute, verifyQueuedProposal, rpcCaller,
  IFR_TOKEN, GOVERNANCE, BUYBACK_CONTROLLER, QUEUED, QUEUED_ETA, POOL_FEE_INNER,
} = require("./pool-fee-receiver-proposal.cjs");

const gov = new Interface(["function propose(address,bytes)", "function execute(uint256)"]);
const token = new Interface(["function setPoolFeeReceiver(address)"]);
const f = build("21");
const s1 = f["lane3-poolfee-step1-propose.json"], s2 = f["lane3-poolfee-step2-execute.json"];
assert.equal(s1.chainId, "1");
assert.equal(s1.transactions.length, 1);
assert.equal(s1.transactions[0].to, GOVERNANCE);
assert.equal(s1.transactions[0].value, "0");
const [target, data] = gov.decodeFunctionData("propose", s1.transactions[0].data);
assert.equal(target, IFR_TOKEN);
assert.equal(token.decodeFunctionData("setPoolFeeReceiver", data)[0], BUYBACK_CONTROLLER);
assert.equal(gov.decodeFunctionData("execute", s2.transactions[0].data)[0], 21n);
assert.throws(() => build("abc"), /non-negative integer/);
assert.throws(() => build("-3"), /non-negative integer/);

// The queued Mainnet operation is pinned by exact bytes (read-only evidence at block 26119897).
assert.equal(QUEUED.id, 21n);
assert.equal(QUEUED.target, IFR_TOKEN);
assert.equal(QUEUED_ETA, 1791159503n, "ETA 2026-10-05T00:18:23.000Z");
assert.equal(POOL_FEE_INNER, "0x4fea8f590000000000000000000000001e0547d50005a4af66abd5e6915ebfaa2d711f7c");
const EXEC_21 = "0xfe0d94c1" + "15".padStart(64, "0");

// Fake eth_call answering Governance.getProposal; refuses any id but the pinned one.
const govAbi = new Interface(["function getProposal(uint256) view returns (address,bytes,uint256,bool,bool)"]);
const fakeCall = (overrides = {}) => async (to, callData) => {
  assert.equal(to, GOVERNANCE);
  const id = govAbi.decodeFunctionData("getProposal", callData)[0];
  assert.equal(id, QUEUED.id, "verifier must only read the pinned id");
  const v = { target: IFR_TOKEN, data: POOL_FEE_INNER, eta: QUEUED_ETA, executed: false, cancelled: false, ...overrides };
  return govAbi.encodeFunctionResult("getProposal", [v.target, v.data, v.eta, v.executed, v.cancelled]);
};

(async () => {
  const files = await buildVerifiedExecute(fakeCall());
  assert.deepEqual(Object.keys(files), ["lane3-poolfee-step2-execute.json"], "verified mode writes only the execute batch");
  const txs = files["lane3-poolfee-step2-execute.json"].transactions;
  assert.equal(txs.length, 1);
  assert.equal(txs[0].to, GOVERNANCE);
  assert.equal(txs[0].value, "0");
  assert.equal(txs[0].data, EXEC_21);

  // Negative matrix: every drift from the pinned queued content must refuse.
  await assert.rejects(verifyQueuedProposal(fakeCall({ eta: 0n })), /#21 does not exist/);
  await assert.rejects(verifyQueuedProposal(fakeCall({ target: GOVERNANCE })), /#21 targets .* not InfernoToken/);
  await assert.rejects(verifyQueuedProposal(fakeCall({ data: token.encodeFunctionData("setPoolFeeReceiver", [GOVERNANCE]) })), /#21 data is not InfernoToken\.setPoolFeeReceiver/);
  await assert.rejects(verifyQueuedProposal(fakeCall({ eta: QUEUED_ETA + 1n })), /#21 ETA .* is not the pinned/);
  await assert.rejects(verifyQueuedProposal(fakeCall({ executed: true })), /#21 is already executed/);
  await assert.rejects(verifyQueuedProposal(fakeCall({ cancelled: true })), /#21 is cancelled/);
  await assert.rejects(verifyQueuedProposal(async () => { throw new Error("connection refused"); }), /connection refused/);

  // rpcCaller: wrong chain refuses before any eth_call; unreadable/empty endpoints refuse.
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
    await assert.rejects(verifyQueuedProposal(rpcCaller(url)), /not Ethereum Mainnet/);
    assert.deepEqual(calls, ["eth_chainId"], "no eth_call may leave a wrong-chain client");
  });
  await withRpc("0x1", async (url) => {
    await assert.rejects(verifyQueuedProposal(rpcCaller(url)), /#21 does not exist/, "empty getProposal result (eta 0) refuses");
  });
  await assert.rejects(verifyQueuedProposal(rpcCaller("http://127.0.0.1:9")));

  // CLI boundary: no mode writes files without verification; fixture mode is explicit.
  const run = (args, env = {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, "pool-fee-receiver-proposal.cjs"), ...args], { env: { ...process.env, ...env } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (status) => resolve({ status, out }));
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t242-poolfee-"));
  let r = await run([], {});
  assert.notEqual(r.status, 0);
  assert.match(r.out, /usage: --execute/);
  r = await run(["21", tmp], {});
  assert.notEqual(r.status, 0, "a bare positional id (legacy form) must not write anything");
  assert.equal(fs.readdirSync(tmp).length, 0);
  r = await run(["--execute", tmp], { MAINNET_RPC_URL: "http://127.0.0.1:9" });
  assert.notEqual(r.status, 0, "--execute must refuse an unreachable RPC");
  assert.equal(fs.readdirSync(tmp).length, 0, "no execute file without on-chain verification");
  r = await run(["--fixture", "21", tmp]);
  assert.equal(r.status, 0);
  assert.deepEqual(fs.readdirSync(tmp).sort(), ["lane3-poolfee-step1-propose.json", "lane3-poolfee-step2-execute.json"]);
  assert.match(r.out, /do not sign/);
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log("[pool-fee-receiver-proposal] PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
