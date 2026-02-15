const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityReserve", function () {
  let owner, guardian, recipient, user;
  let token, reserve;

  const RESERVE_AMOUNT = ethers.utils.parseUnits("200000000", 9); // 200M IFR
  const MAX_PER_PERIOD = ethers.utils.parseUnits("50000000", 9);  // 50M IFR
  const LOCK_DURATION = 180 * 86400;  // 180 days
  const PERIOD_DURATION = 90 * 86400; // 90 days

  beforeEach(async () => {
    [owner, guardian, recipient, user] = await ethers.getSigners();

    const InfernoToken = await ethers.getContractFactory("InfernoToken");
    token = await InfernoToken.deploy(owner.address);
    await token.deployed();

    await token.setFeeExempt(owner.address, true);

    const LiquidityReserve = await ethers.getContractFactory("LiquidityReserve");
    reserve = await LiquidityReserve.deploy(
      token.address,
      LOCK_DURATION,
      MAX_PER_PERIOD,
      PERIOD_DURATION,
      guardian.address
    );
    await reserve.deployed();

    await token.setFeeExempt(reserve.address, true);
    await token.transfer(reserve.address, RESERVE_AMOUNT);
  });

  describe("Deployment", () => {
    it("sets all parameters correctly", async () => {
      expect(await reserve.owner()).to.equal(owner.address);
      expect(await reserve.guardian()).to.equal(guardian.address);
      expect(await reserve.token()).to.equal(token.address);
      expect(await reserve.periodDuration()).to.equal(PERIOD_DURATION);
      expect(await reserve.maxWithdrawPerPeriod()).to.equal(MAX_PER_PERIOD);
      expect(await reserve.totalWithdrawn()).to.equal(0);
      expect(await reserve.paused()).to.equal(false);
    });

    it("holds the reserve tokens", async () => {
      expect(await reserve.pendingBalance()).to.equal(RESERVE_AMOUNT);
    });

    it("reverts if token is zero address", async () => {
      const LR = await ethers.getContractFactory("LiquidityReserve");
      await expect(
        LR.deploy(ethers.constants.AddressZero, LOCK_DURATION, MAX_PER_PERIOD, PERIOD_DURATION, guardian.address)
      ).to.be.revertedWith("token=0");
    });

    it("reverts if guardian is zero address", async () => {
      const LR = await ethers.getContractFactory("LiquidityReserve");
      await expect(
        LR.deploy(token.address, LOCK_DURATION, MAX_PER_PERIOD, PERIOD_DURATION, ethers.constants.AddressZero)
      ).to.be.revertedWith("guardian=0");
    });

    it("reverts if lockDuration is zero", async () => {
      const LR = await ethers.getContractFactory("LiquidityReserve");
      await expect(
        LR.deploy(token.address, 0, MAX_PER_PERIOD, PERIOD_DURATION, guardian.address)
      ).to.be.revertedWith("lockDuration=0");
    });
  });

  describe("Lock period", () => {
    it("reverts withdraw before lock expires", async () => {
      await expect(
        reserve.withdraw(recipient.address, MAX_PER_PERIOD)
      ).to.be.revertedWith("locked");
    });

    it("availableToWithdraw returns 0 during lock", async () => {
      expect(await reserve.availableToWithdraw()).to.equal(0);
    });

    it("currentPeriod returns 0 during lock", async () => {
      expect(await reserve.currentPeriod()).to.equal(0);
    });
  });

  describe("withdraw() after lock", () => {
    beforeEach(async () => {
      // Advance past lock period
      await ethers.provider.send("evm_increaseTime", [LOCK_DURATION]);
      await ethers.provider.send("evm_mine", []);
    });

    it("allows withdrawal up to period limit", async () => {
      const amount = ethers.utils.parseUnits("30000000", 9); // 30M

      await expect(reserve.withdraw(recipient.address, amount))
        .to.emit(reserve, "Withdrawn")
        .withArgs(recipient.address, amount);

      expect(await token.balanceOf(recipient.address)).to.equal(amount);
      expect(await reserve.totalWithdrawn()).to.equal(amount);
    });

    it("allows multiple withdrawals up to period limit", async () => {
      const amount1 = ethers.utils.parseUnits("20000000", 9); // 20M
      const amount2 = ethers.utils.parseUnits("30000000", 9); // 30M

      await reserve.withdraw(recipient.address, amount1);
      await reserve.withdraw(recipient.address, amount2);

      expect(await reserve.totalWithdrawn()).to.equal(amount1.add(amount2));
      expect(await token.balanceOf(recipient.address)).to.equal(amount1.add(amount2));
    });

    it("reverts if exceeding period limit", async () => {
      const tooMuch = MAX_PER_PERIOD.add(1);
      await expect(
        reserve.withdraw(recipient.address, tooMuch)
      ).to.be.revertedWith("exceeds period limit");
    });

    it("reverts if two withdrawals exceed period limit", async () => {
      await reserve.withdraw(recipient.address, MAX_PER_PERIOD);
      await expect(
        reserve.withdraw(recipient.address, 1)
      ).to.be.revertedWith("exceeds period limit");
    });

    it("resets limit in next period", async () => {
      // Withdraw max in period 0
      await reserve.withdraw(recipient.address, MAX_PER_PERIOD);

      // Advance to period 1
      await ethers.provider.send("evm_increaseTime", [PERIOD_DURATION]);
      await ethers.provider.send("evm_mine", []);

      // Can withdraw again
      await expect(reserve.withdraw(recipient.address, MAX_PER_PERIOD))
        .to.emit(reserve, "Withdrawn");

      expect(await reserve.totalWithdrawn()).to.equal(MAX_PER_PERIOD.mul(2));
    });

    it("full staged withdrawal over 4 periods", async () => {
      for (let i = 0; i < 4; i++) {
        if (i > 0) {
          await ethers.provider.send("evm_increaseTime", [PERIOD_DURATION]);
          await ethers.provider.send("evm_mine", []);
        }
        await reserve.withdraw(recipient.address, MAX_PER_PERIOD);
      }

      expect(await reserve.totalWithdrawn()).to.equal(RESERVE_AMOUNT);
      expect(await reserve.pendingBalance()).to.equal(0);
    });

    it("reverts for non-owner", async () => {
      await expect(
        reserve.connect(user).withdraw(recipient.address, MAX_PER_PERIOD)
      ).to.be.revertedWith("not owner");
    });

    it("reverts on zero amount", async () => {
      await expect(
        reserve.withdraw(recipient.address, 0)
      ).to.be.revertedWith("amount=0");
    });

    it("reverts on zero address", async () => {
      await expect(
        reserve.withdraw(ethers.constants.AddressZero, MAX_PER_PERIOD)
      ).to.be.revertedWith("to=0");
    });

    it("reverts if amount exceeds balance", async () => {
      const tooMuch = RESERVE_AMOUNT.add(1);
      // Update period limit to allow it
      await reserve.setMaxWithdrawPerPeriod(tooMuch);
      await expect(
        reserve.withdraw(recipient.address, tooMuch)
      ).to.be.revertedWith("exceeds balance");
    });
  });

  describe("availableToWithdraw()", () => {
    it("returns full period limit after lock", async () => {
      await ethers.provider.send("evm_increaseTime", [LOCK_DURATION]);
      await ethers.provider.send("evm_mine", []);

      expect(await reserve.availableToWithdraw()).to.equal(MAX_PER_PERIOD);
    });

    it("decreases after withdrawal", async () => {
      await ethers.provider.send("evm_increaseTime", [LOCK_DURATION]);
      await ethers.provider.send("evm_mine", []);

      const amount = ethers.utils.parseUnits("20000000", 9);
      await reserve.withdraw(recipient.address, amount);

      expect(await reserve.availableToWithdraw()).to.equal(MAX_PER_PERIOD.sub(amount));
    });

    it("returns 0 when paused", async () => {
      await ethers.provider.send("evm_increaseTime", [LOCK_DURATION]);
      await ethers.provider.send("evm_mine", []);

      await reserve.connect(guardian).pause();
      expect(await reserve.availableToWithdraw()).to.equal(0);
    });
  });

  describe("Pause", () => {
    beforeEach(async () => {
      await ethers.provider.send("evm_increaseTime", [LOCK_DURATION]);
      await ethers.provider.send("evm_mine", []);
    });

    it("guardian can pause and block withdrawals", async () => {
      await expect(reserve.connect(guardian).pause()).to.emit(reserve, "Paused");
      await expect(
        reserve.withdraw(recipient.address, MAX_PER_PERIOD)
      ).to.be.revertedWith("paused");
    });

    it("guardian can unpause", async () => {
      await reserve.connect(guardian).pause();
      await expect(reserve.connect(guardian).unpause()).to.emit(reserve, "Unpaused");

      await expect(reserve.withdraw(recipient.address, MAX_PER_PERIOD))
        .to.emit(reserve, "Withdrawn");
    });

    it("non-guardian cannot pause", async () => {
      await expect(reserve.connect(user).pause()).to.be.revertedWith("not guardian");
    });
  });

  describe("setMaxWithdrawPerPeriod()", () => {
    it("owner can update", async () => {
      const newMax = ethers.utils.parseUnits("75000000", 9);
      await expect(reserve.setMaxWithdrawPerPeriod(newMax))
        .to.emit(reserve, "MaxWithdrawPerPeriodUpdated")
        .withArgs(newMax);
      expect(await reserve.maxWithdrawPerPeriod()).to.equal(newMax);
    });

    it("reverts for non-owner", async () => {
      await expect(
        reserve.connect(user).setMaxWithdrawPerPeriod(1)
      ).to.be.revertedWith("not owner");
    });

    it("reverts for zero", async () => {
      await expect(
        reserve.setMaxWithdrawPerPeriod(0)
      ).to.be.revertedWith("maxWithdraw=0");
    });
  });

  describe("setGuardian()", () => {
    it("owner can update guardian", async () => {
      await expect(reserve.setGuardian(user.address))
        .to.emit(reserve, "GuardianUpdated")
        .withArgs(user.address);
      expect(await reserve.guardian()).to.equal(user.address);
    });

    it("reverts for non-owner", async () => {
      await expect(
        reserve.connect(user).setGuardian(user.address)
      ).to.be.revertedWith("not owner");
    });

    it("reverts for zero address", async () => {
      await expect(
        reserve.setGuardian(ethers.constants.AddressZero)
      ).to.be.revertedWith("guardian=0");
    });
  });
});
