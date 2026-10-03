// Unit test for scripts/pool-fee-receiver-proposal.cjs (Lane 3 decision B, CWA-02).
const assert = require("node:assert/strict");
const { Interface } = require("ethers");
const { build, IFR_TOKEN, GOVERNANCE, BUYBACK_CONTROLLER } = require("./pool-fee-receiver-proposal.cjs");

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
console.log("[pool-fee-receiver-proposal] PASS");
