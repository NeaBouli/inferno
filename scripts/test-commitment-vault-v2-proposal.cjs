#!/usr/bin/env node
// Guards the CV-01 V2 Safe batch generator: exact targets, calldata and refusal of V1/invalid input.
const assert = require("node:assert/strict");
const { Interface } = require("ethers");
const { build, IFR_TOKEN, GOVERNANCE } = require("./commitment-vault-v2-proposal.cjs");

const V2 = "0x1111111111111111111111111111111111111111";
const gov = new Interface(["function propose(address,bytes)", "function execute(uint256)"]);
const tok = new Interface(["function setFeeExempt(address,bool)"]);

const { files } = build(V2, "17");
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

assert.equal(Object.keys(build(V2).files).length, 1, "without a proposal id only step 1 is built");
assert.throws(() => build("0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3"), /V1 vault/);
assert.throws(() => build("0x123"), /V2 address required/);
assert.throws(() => build(V2, "-1"), /non-negative integer/);
console.log("[commitment-vault-v2-proposal] PASS");
