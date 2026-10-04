// Unit test for scripts/voucher-signer-rotation-proposal.cjs (CWA-06).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { Interface, Wallet, getAddress } = require("ethers");
const {
  build, checkQueued, writeExecute, QUEUED, FEE_ROUTER, GOVERNANCE, FORBIDDEN,
} = require("./voucher-signer-rotation-proposal.cjs");

const gov = new Interface([
  "function propose(address,bytes)", "function execute(uint256)",
  "function getProposal(uint256) view returns (address,bytes,uint256,bool,bool)",
]);
const router = new Interface(["function setVoucherSigner(address)"]);
const fresh = Wallet.createRandom().address;

const { files, signer } = build(fresh.toLowerCase(), "18");
assert.equal(signer, fresh);
const step1 = files["cwa06-voucher-step1-propose.json"];
const step2 = files["cwa06-voucher-step2-execute.json"];
assert.equal(step1.chainId, "1");
assert.equal(step1.transactions.length, 1);
assert.equal(step1.transactions[0].to, GOVERNANCE);
assert.equal(step1.transactions[0].value, "0");
const [target, data] = gov.decodeFunctionData("propose", step1.transactions[0].data);
assert.equal(target, FEE_ROUTER);
assert.equal(router.decodeFunctionData("setVoucherSigner", data)[0], fresh);
assert.equal(gov.decodeFunctionData("execute", step2.transactions[0].data)[0], 18n);
assert.equal(step2.transactions[0].to, GOVERNANCE);

assert.equal(Object.keys(build(fresh).files).length, 1, "without proposalId only step 1 is written");
for (const address of Object.keys(FORBIDDEN)) {
  assert.throws(() => build(address, "18"), /refusing/, `${address} must be refused`);
  assert.throws(() => build(address.toLowerCase(), "18"), /refusing/, `${address} (lowercase) must be refused`);
}
assert.throws(() => build("0x0000000000000000000000000000000000000000"), /zero address/);
assert.throws(() => build("not-an-address"), /required/);
assert.throws(() => build(fresh, "-1"), /non-negative integer/);
assert.throws(() => build(fresh, "1e3"), /non-negative integer/);

// Queued proposal 18 binding (pure check).
assert.equal(QUEUED.signer, getAddress(QUEUED.signer));
const queuedData = router.encodeFunctionData("setVoucherSigner", [QUEUED.signer]);
const good = [FEE_ROUTER, queuedData, QUEUED.eta, false, false];
checkQueued(good);
const bad = {
  target: [GOVERNANCE, queuedData, QUEUED.eta, false, false],
  data: [FEE_ROUTER, router.encodeFunctionData("setVoucherSigner", [fresh]), QUEUED.eta, false, false],
  eta: [FEE_ROUTER, queuedData, QUEUED.eta + 1n, false, false],
  executed: [FEE_ROUTER, queuedData, QUEUED.eta, true, false],
  cancelled: [FEE_ROUTER, queuedData, QUEUED.eta, false, true],
};
for (const [name, proposal] of Object.entries(bad)) assert.throws(() => checkQueued(proposal), Error, `${name} must be refused`);

// CLI path against a fake RPC: the execute file is written only for proposal 18 with matching live state.
async function withRpc(mode, fn) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const call = JSON.parse(body);
      calls.push(call.method);
      const reply = (obj) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };
      if (mode === "down") { res.writeHead(502); return res.end("bad gateway"); }
      if (call.method === "eth_chainId") return reply({ jsonrpc: "2.0", id: call.id, result: mode === "wrongchain" ? "0xaa36a7" : "0x1" });
      if (mode === "error") return reply({ jsonrpc: "2.0", id: call.id, error: { code: -32000, message: "boom" } });
      assert.equal(call.params[0].to, GOVERNANCE);
      assert.equal(gov.decodeFunctionData("getProposal", call.params[0].data)[0], 18n);
      const proposal = mode === "ok" ? good : bad[mode];
      reply({ jsonrpc: "2.0", id: call.id, result: gov.encodeFunctionResult("getProposal", proposal) });
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
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "cwa06-"));
  const file = path.join(out, "cwa06-voucher-step2-execute.json");
  try {
    for (const mode of ["down", "wrongchain", "error", ...Object.keys(bad)]) {
      await withRpc(mode, (url) => assert.rejects(writeExecute(QUEUED.signer, "18", out, url)));
      assert.equal(fs.existsSync(file), false, `${mode}: no execute file may be written`);
    }
    await withRpc("ok", async (url, calls) => {
      await assert.rejects(writeExecute(QUEUED.signer, "19", out, url), /only the queued proposal 18/);
      await assert.rejects(writeExecute(fresh, "18", out, url), /only the queued proposal 18/);
      assert.equal(calls.length, 0, "a foreign id or signer is refused before any RPC call");
      assert.equal(await writeExecute(QUEUED.signer.toLowerCase(), "18", out, url), file);
    });
    const step2 = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(fs.readdirSync(out).length, 1, "only the execute file is production output");
    assert.equal(step2.chainId, "1");
    assert.equal(step2.transactions.length, 1);
    assert.equal(step2.transactions[0].to, GOVERNANCE);
    assert.equal(step2.transactions[0].value, "0");
    assert.equal(step2.transactions[0].data, gov.encodeFunctionData("execute", [18n]));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
  console.log("[voucher-signer-rotation-proposal] PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
