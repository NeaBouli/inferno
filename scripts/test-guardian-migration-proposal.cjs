// Unit test for scripts/guardian-migration-proposal.cjs (CWA-09).
const assert = require("node:assert/strict");
const { Interface } = require("ethers");
const { build, C, TREASURY_SAFE, DEPLOYER } = require("./guardian-migration-proposal.cjs");

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
console.log("[guardian-migration-proposal] PASS");
