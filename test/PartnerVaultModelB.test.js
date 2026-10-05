import { expect } from "chai";
import fs from "node:fs";
import { ethers } from "./helpers/hardhat.js";

// T-275: executes the Model B recordMilestone template produced by the Benefits backend
// (golden fixture) against a locally deployed Governance + PartnerVault on the in-process
// Hardhat network. Nothing is signed for or sent to a real network.
const fixture = JSON.parse(fs.readFileSync(
  new URL("../apps/benefits-network/backend/tests/fixtures/model-b-recordMilestone-template.json", import.meta.url),
  "utf8"
));

describe("PartnerVault Model B settlement template (T-275)", function () {
  const parse = (value) => ethers.parseUnits(value, 9);
  const DELAY = 3600;
  const DAY = 86400;
  const govInterface = new ethers.Interface(["function propose(address target, bytes data) returns (uint256)"]);
  let owner, guardian, beneficiary, outsider;
  let token, gov, vault;

  async function increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  async function governed(target, data) {
    const id = await gov.proposalCount();
    await gov.propose(target, data);
    await increaseTime(DELAY);
    return gov.execute(id);
  }

  async function expectGovernedRevert(target, data) {
    let error;
    try {
      await governed(target, data);
    } catch (caught) {
      error = caught;
    }
    expect(error, "expected governed call to revert").to.be.instanceOf(Error);
    expect(error.message).to.match(/revert/i);
  }

  beforeEach(async () => {
    [owner, guardian, beneficiary, outsider] = await ethers.getSigners();
    const Governance = await ethers.getContractFactory("Governance");
    gov = await Governance.deploy(DELAY, guardian.address);
    await gov.waitForDeployment();
    const InfernoToken = await ethers.getContractFactory("InfernoToken");
    token = await InfernoToken.deploy(owner.address);
    await token.waitForDeployment();
    await token.setFeeExempt(owner.address, true);
    const PartnerVault = await ethers.getContractFactory("PartnerVault");
    vault = await PartnerVault.deploy(token.target, gov.target, guardian.address, 1500, parse("4000000"));
    await vault.waitForDeployment();
    await token.setFeeExempt(vault.target, true);
    await token.transfer(vault.target, parse("40000000"));
  });

  async function createPilot(partnerId, maxAllocation) {
    await governed(vault.target, vault.interface.encodeFunctionData("createPartner", [
      partnerId, beneficiary.address, maxAllocation, 180 * DAY, 0, 1,
    ]));
    await governed(vault.target, vault.interface.encodeFunctionData("activatePartner", [partnerId]));
  }

  it("matches the compiled recordMilestone/propose ABI and records exactly the template amount", async () => {
    const [tx] = fixture.template.transactions;
    expect(tx.value).to.equal("0");
    const [target, inner] = govInterface.decodeFunctionData("propose", tx.data);
    expect(target).to.equal(fixture.template.meta.partnerVault);
    expect(inner).to.equal(fixture.template.inner.data);
    // The template must use the selector of the compiled contracts.
    expect(tx.data.slice(0, 10)).to.equal(gov.interface.getFunction("propose").selector);
    expect(inner.slice(0, 10)).to.equal(vault.interface.getFunction("recordMilestone").selector);
    const decoded = vault.interface.decodeFunctionData("recordMilestone", inner);
    expect(decoded[0]).to.equal(fixture.partnerId);
    expect(decoded[1]).to.equal(fixture.milestoneId);
    expect(decoded[2]).to.equal(BigInt(fixture.unlockAmount));

    // Not callable directly: only Governance (PartnerVault admin) can record a milestone.
    await expect(outsider.sendTransaction({ to: vault.target, data: inner })).to.be.revertedWith("not admin");

    await createPilot(fixture.partnerId, parse("3000"));
    await expect(governed(vault.target, inner))
      .to.emit(vault, "MilestoneRecorded")
      .withArgs(fixture.partnerId, fixture.milestoneId, BigInt(fixture.unlockAmount));
    const partner = await vault.partners(fixture.partnerId);
    expect(partner.unlockedTotal).to.equal(BigInt(fixture.unlockAmount));
    expect(partner.rewardAccrued).to.equal(0n);
    expect(await vault.milestoneDone(fixture.partnerId, fixture.milestoneId)).to.equal(true);
    expect(await vault.totalRewarded()).to.equal(0n);

    // A replayed template for the same partner and month is rejected on-chain.
    await expectGovernedRevert(vault.target, inner);
  });

  it("stops exactly at the partner allocation", async () => {
    await createPilot(fixture.partnerId, parse("3000"));
    await governed(vault.target, fixture.template.inner.data);
    const record = (milestone, amount) => vault.interface.encodeFunctionData("recordMilestone", [fixture.partnerId, ethers.id(milestone), amount]);
    await expectGovernedRevert(vault.target, record("over", parse("1000") + 1n));
    await governed(vault.target, record("exact", parse("1000")));
    expect((await vault.partners(fixture.partnerId)).unlockedTotal).to.equal(parse("3000"));
    await expectGovernedRevert(vault.target, record("after-cap", 1n));
  });

  it("is not bounded by annualEmissionCap (only recordLockReward is)", async () => {
    const partnerId = ethers.id("model-b-large-pilot");
    await createPilot(partnerId, parse("5000000"));
    expect(await vault.annualEmissionCap()).to.equal(parse("4000000"));
    await governed(vault.target, vault.interface.encodeFunctionData("recordMilestone", [partnerId, ethers.id("2026-08"), parse("4500000")]));
    expect((await vault.partners(partnerId)).unlockedTotal).to.equal(parse("4500000"));
  });
});
