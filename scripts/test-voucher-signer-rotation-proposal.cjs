// Unit test for scripts/voucher-signer-rotation-proposal.cjs (CWA-06).
const assert = require("node:assert/strict");
const { Interface, Wallet } = require("ethers");
const { build, FEE_ROUTER, GOVERNANCE, FORBIDDEN } = require("./voucher-signer-rotation-proposal.cjs");

const gov = new Interface(["function propose(address,bytes)", "function execute(uint256)"]);
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
console.log("[voucher-signer-rotation-proposal] PASS");
