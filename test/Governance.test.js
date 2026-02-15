const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Governance", function () {
  let owner, guardian, user;
  let gov, token;

  const DELAY = 2 * 86400; // 2 days
  const ONE_HOUR = 3600;

  beforeEach(async () => {
    [owner, guardian, user] = await ethers.getSigners();

    const Governance = await ethers.getContractFactory("Governance");
    gov = await Governance.deploy(DELAY, guardian.address);
    await gov.deployed();

    // Deploy InfernoToken with Governance as future owner
    const InfernoToken = await ethers.getContractFactory("InfernoToken");
    token = await InfernoToken.deploy(owner.address);
    await token.deployed();
  });

  async function increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  describe("Deployment", () => {
    it("sets owner, guardian, and delay correctly", async () => {
      expect(await gov.owner()).to.equal(owner.address);
      expect(await gov.guardian()).to.equal(guardian.address);
      expect(await gov.delay()).to.equal(DELAY);
      expect(await gov.proposalCount()).to.equal(0);
    });

    it("reverts if delay below MIN_DELAY", async () => {
      const Gov = await ethers.getContractFactory("Governance");
      await expect(Gov.deploy(60, guardian.address)).to.be.revertedWith("delay out of range");
    });

    it("reverts if delay above MAX_DELAY", async () => {
      const Gov = await ethers.getContractFactory("Governance");
      await expect(Gov.deploy(31 * 86400, guardian.address)).to.be.revertedWith("delay out of range");
    });

    it("reverts if guardian is zero address", async () => {
      const Gov = await ethers.getContractFactory("Governance");
      await expect(Gov.deploy(DELAY, ethers.constants.AddressZero)).to.be.revertedWith("guardian=0");
    });

    it("accepts MIN_DELAY", async () => {
      const Gov = await ethers.getContractFactory("Governance");
      const g = await Gov.deploy(ONE_HOUR, guardian.address);
      await g.deployed();
      expect(await g.delay()).to.equal(ONE_HOUR);
    });

    it("accepts MAX_DELAY", async () => {
      const Gov = await ethers.getContractFactory("Governance");
      const g = await Gov.deploy(30 * 86400, guardian.address);
      await g.deployed();
      expect(await g.delay()).to.equal(30 * 86400);
    });
  });

  describe("propose()", () => {
    it("creates proposal with correct eta and emits event", async () => {
      const data = token.interface.encodeFunctionData("setFeeRates", [100, 50, 50]);

      const tx = await gov.propose(token.address, data);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      expect(await gov.proposalCount()).to.equal(1);

      const proposal = await gov.getProposal(0);
      expect(proposal.target).to.equal(token.address);
      expect(proposal.data).to.equal(data);
      expect(proposal.eta).to.equal(block.timestamp + DELAY);
      expect(proposal.executed).to.equal(false);
      expect(proposal.cancelled).to.equal(false);
    });

    it("emits ProposalCreated", async () => {
      const data = token.interface.encodeFunctionData("setFeeRates", [100, 50, 50]);
      await expect(gov.propose(token.address, data))
        .to.emit(gov, "ProposalCreated");
    });

    it("increments proposalCount", async () => {
      const data = "0x12345678";
      await gov.propose(token.address, data);
      await gov.propose(token.address, data);
      expect(await gov.proposalCount()).to.equal(2);
    });

    it("reverts for non-owner", async () => {
      await expect(
        gov.connect(user).propose(token.address, "0x12345678")
      ).to.be.revertedWith("not owner");
    });

    it("reverts for zero target", async () => {
      await expect(
        gov.propose(ethers.constants.AddressZero, "0x12345678")
      ).to.be.revertedWith("target=0");
    });
  });

  describe("execute()", () => {
    let data;

    beforeEach(async () => {
      // Transfer token ownership to Governance
      await token.transferOwnership(gov.address);

      data = token.interface.encodeFunctionData("setFeeRates", [100, 25, 75]);
      await gov.propose(token.address, data);
    });

    it("executes proposal after delay", async () => {
      await increaseTime(DELAY);

      await expect(gov.execute(0))
        .to.emit(gov, "ProposalExecuted")
        .withArgs(0);

      expect(await token.senderBurnBps()).to.equal(100);
      expect(await token.recipientBurnBps()).to.equal(25);
      expect(await token.poolFeeBps()).to.equal(75);

      const proposal = await gov.getProposal(0);
      expect(proposal.executed).to.equal(true);
    });

    it("reverts before eta (too early)", async () => {
      await increaseTime(DELAY - 100);
      await expect(gov.execute(0)).to.be.revertedWith("too early");
    });

    it("reverts if already executed", async () => {
      await increaseTime(DELAY);
      await gov.execute(0);
      await expect(gov.execute(0)).to.be.revertedWith("already executed");
    });

    it("reverts if cancelled", async () => {
      await gov.cancel(0);
      await increaseTime(DELAY);
      await expect(gov.execute(0)).to.be.revertedWith("cancelled");
    });

    it("reverts for non-owner", async () => {
      await increaseTime(DELAY);
      await expect(gov.connect(user).execute(0)).to.be.revertedWith("not owner");
    });

    it("reverts for non-existent proposal", async () => {
      await expect(gov.execute(99)).to.be.revertedWith("proposal not found");
    });

    it("reverts if target call fails", async () => {
      // Propose fee rates > 5% which will revert
      const badData = token.interface.encodeFunctionData("setFeeRates", [300, 200, 200]);
      await gov.propose(token.address, badData);
      await increaseTime(DELAY);

      await expect(gov.execute(1)).to.be.reverted;
    });
  });

  describe("cancel()", () => {
    beforeEach(async () => {
      const data = "0x12345678";
      await gov.propose(token.address, data);
    });

    it("owner can cancel", async () => {
      await expect(gov.cancel(0))
        .to.emit(gov, "ProposalCancelled")
        .withArgs(0);

      const proposal = await gov.getProposal(0);
      expect(proposal.cancelled).to.equal(true);
    });

    it("guardian can cancel", async () => {
      await expect(gov.connect(guardian).cancel(0))
        .to.emit(gov, "ProposalCancelled")
        .withArgs(0);
    });

    it("reverts for unauthorized", async () => {
      await expect(gov.connect(user).cancel(0)).to.be.revertedWith("not authorized");
    });

    it("reverts if already executed", async () => {
      await token.transferOwnership(gov.address);

      const data = token.interface.encodeFunctionData("setFeeRates", [100, 25, 75]);
      await gov.propose(token.address, data);
      await increaseTime(DELAY);
      await gov.execute(1);

      await expect(gov.cancel(1)).to.be.revertedWith("already executed");
    });

    it("reverts if already cancelled", async () => {
      await gov.cancel(0);
      await expect(gov.cancel(0)).to.be.revertedWith("already cancelled");
    });
  });

  describe("setDelay() via timelock", () => {
    it("can update delay through own timelock", async () => {
      const newDelay = 4 * 86400; // 4 days
      const data = gov.interface.encodeFunctionData("setDelay", [newDelay]);

      await gov.propose(gov.address, data);
      await increaseTime(DELAY);

      await expect(gov.execute(0))
        .to.emit(gov, "DelayUpdated")
        .withArgs(DELAY, newDelay);

      expect(await gov.delay()).to.equal(newDelay);
    });

    it("reverts if called directly (not through timelock)", async () => {
      await expect(gov.setDelay(ONE_HOUR)).to.be.revertedWith("not self");
    });

    it("reverts for invalid delay via timelock", async () => {
      const badData = gov.interface.encodeFunctionData("setDelay", [60]); // < MIN_DELAY
      await gov.propose(gov.address, badData);
      await increaseTime(DELAY);

      await expect(gov.execute(0)).to.be.reverted;
    });
  });

  describe("setGuardian()", () => {
    it("owner can update guardian", async () => {
      await expect(gov.setGuardian(user.address))
        .to.emit(gov, "GuardianUpdated")
        .withArgs(guardian.address, user.address);

      expect(await gov.guardian()).to.equal(user.address);
    });

    it("reverts for non-owner", async () => {
      await expect(gov.connect(user).setGuardian(user.address)).to.be.revertedWith("not owner");
    });

    it("reverts for zero address", async () => {
      await expect(gov.setGuardian(ethers.constants.AddressZero)).to.be.revertedWith("guardian=0");
    });
  });

  describe("setOwner()", () => {
    it("owner can transfer ownership", async () => {
      await expect(gov.setOwner(user.address))
        .to.emit(gov, "OwnerUpdated")
        .withArgs(owner.address, user.address);

      expect(await gov.owner()).to.equal(user.address);
    });

    it("reverts for non-owner", async () => {
      await expect(gov.connect(user).setOwner(user.address)).to.be.revertedWith("not owner");
    });

    it("reverts for zero address", async () => {
      await expect(gov.setOwner(ethers.constants.AddressZero)).to.be.revertedWith("owner=0");
    });
  });

  describe("Integration: Governance as protocol owner", () => {
    beforeEach(async () => {
      // Transfer InfernoToken ownership to Governance
      await token.transferOwnership(gov.address);
    });

    it("can change fee rates via timelock", async () => {
      const data = token.interface.encodeFunctionData("setFeeRates", [150, 30, 120]);
      await gov.propose(token.address, data);
      await increaseTime(DELAY);
      await gov.execute(0);

      expect(await token.senderBurnBps()).to.equal(150);
      expect(await token.recipientBurnBps()).to.equal(30);
      expect(await token.poolFeeBps()).to.equal(120);
    });

    it("can set feeExempt via timelock", async () => {
      const data = token.interface.encodeFunctionData("setFeeExempt", [user.address, true]);
      await gov.propose(token.address, data);
      await increaseTime(DELAY);
      await gov.execute(0);

      expect(await token.feeExempt(user.address)).to.equal(true);
    });

    it("can update poolFeeReceiver via timelock", async () => {
      const data = token.interface.encodeFunctionData("setPoolFeeReceiver", [user.address]);
      await gov.propose(token.address, data);
      await increaseTime(DELAY);
      await gov.execute(0);

      expect(await token.poolFeeReceiver()).to.equal(user.address);
    });

    it("direct calls to token revert (Governance is owner, not deployer)", async () => {
      await expect(
        token.setFeeRates(100, 50, 50)
      ).to.be.reverted;
    });
  });
});
