#!/usr/bin/env node
// Guards the CV-01 V2 Safe batch generator: exact targets, calldata and refusal of any address but the deployed V2.
const assert = require("node:assert/strict");
const { Interface } = require("ethers");
const { build, verifyOnChain, IFR_TOKEN, GOVERNANCE, V2, CV01_PROPOSAL_ID } = require("./commitment-vault-v2-proposal.cjs");

assert.equal(V2, "0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F");
const gov = new Interface(["function propose(address,bytes)", "function execute(uint256)"]);
const tok = new Interface(["function setFeeExempt(address,bool)"]);

const { files, inner: generatedInner } = build(V2, "17");
const step1 = files["cv01-v2-step1-propose.json"];
assert.equal(step1.chainId, "1");
assert.equal(step1.transactions.length, 1);
assert.equal(step1.transactions[0].to, GOVERNANCE);
assert.equal(step1.transactions[0].value, "0");
const [target, inner] = gov.decodeFunctionData("propose", step1.transactions[0].data);
assert.equal(target, IFR_TOKEN);
const [account, exempt] = tok.decodeFunctionData("setFeeExempt", inner);
assert.equal(account, V2);
assert.equal(exempt, true);

const step2 = files["cv01-v2-step2-execute.json"];
assert.equal(step2.transactions[0].to, GOVERNANCE);
assert.equal(gov.decodeFunctionData("execute", step2.transactions[0].data)[0], 17n);

// Proposal #17 as queued on Mainnet (Governance.getProposal(17).data); the batch bytes must not drift.
const INNER_17 = "0x8ebfc796" + V2.slice(2).toLowerCase().padStart(64, "0") + "1".padStart(64, "0");
assert.equal(generatedInner, INNER_17);
assert.equal(
  step1.transactions[0].data,
  "0x9d481848" + IFR_TOKEN.slice(2).toLowerCase().padStart(64, "0") + "40".padStart(64, "0") + "44".padStart(64, "0") +
    INNER_17.slice(2).padEnd(192, "0")
);
assert.equal(step2.transactions[0].data, "0xfe0d94c1" + "11".padStart(64, "0"));
assert.equal(build(V2.toLowerCase(), "17").inner, INNER_17, "lowercase input of the same address is accepted");

assert.equal(Object.keys(build(V2).files).length, 1, "without a proposal id only step 1 is built");
assert.throws(() => build("0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3"), /V1 vault/);
assert.throws(() => build("0x1111111111111111111111111111111111111111"), /not the deployed V2/);
assert.throws(() => build("0x8efae0c85ad6d44c731caeda1cbc275904fc7c8e"), /not the deployed V2/);
assert.throws(() => build("0x123"), /V2 address required/);
assert.throws(() => build(undefined), /V2 address required/);
assert.throws(() => build(V2, "-1"), /non-negative integer/);

// Step 2 is pinned to proposal #17: Governance.execute(id) would run an unrelated proposal for any other id.
assert.equal(CV01_PROPOSAL_ID, 17);
for (const wrong of ["0", "16", "18", "21", "170"]) {
  assert.throws(() => build(V2, wrong), /pinned to Governance proposal #17/, `step 2 for proposal ${wrong} must be refused`);
}
assert.equal(build(V2, "017").files["cv01-v2-step2-execute.json"].transactions[0].data, "0xfe0d94c1" + "11".padStart(64, "0"));

// Optional read-only validation of the queued proposal.
(async () => {
  const govAbi = new Interface(["function getProposal(uint256) view returns (address,bytes,uint256,bool,bool)"]);
  const fake = (target, data, eta, executed, cancelled) => async (to, callData) => {
    assert.equal(to, GOVERNANCE);
    assert.equal(govAbi.decodeFunctionData("getProposal", callData)[0], 17n);
    return govAbi.encodeFunctionResult("getProposal", [target, data, eta, executed, cancelled]);
  };
  const eta = 1791150791n;
  assert.equal((await verifyOnChain(fake(IFR_TOKEN, INNER_17, eta, false, false))).eta, eta);
  await assert.rejects(verifyOnChain(fake(IFR_TOKEN, INNER_17, 0n, false, false)), /does not exist/);
  await assert.rejects(verifyOnChain(fake(GOVERNANCE, INNER_17, eta, false, false)), /not InfernoToken/);
  const otherInner = tok.encodeFunctionData("setFeeExempt", ["0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3", true]);
  await assert.rejects(verifyOnChain(fake(IFR_TOKEN, otherInner, eta, false, false)), /not setFeeExempt\(V2, true\)/);
  await assert.rejects(verifyOnChain(fake(IFR_TOKEN, tok.encodeFunctionData("setFeeExempt", [V2, false]), eta, false, false)), /not setFeeExempt/);
  await assert.rejects(verifyOnChain(fake(IFR_TOKEN, INNER_17, eta, true, false)), /already executed/);
  await assert.rejects(verifyOnChain(fake(IFR_TOKEN, INNER_17, eta, false, true)), /cancelled/);
  console.log("[commitment-vault-v2-proposal] PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
