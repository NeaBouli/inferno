const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CommitmentVault", function () {
  let owner, governance, userA, userB, userC;
  let token, vault;

  const parse = (s) => ethers.utils.parseUnits(s, 9);
  const ONE_DAY = 86400;
  const THIRTY_DAYS = 30 * ONE_DAY;

  async function advanceTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine");
  }

  async function getTimestamp() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp;
  }

  beforeEach(async () => {
    [owner, governance, userA, userB, userC] = await ethers.getSigners();

    const InfernoToken = await ethers.getContractFactory("InfernoToken");
    token = await InfernoToken.deploy(owner.address);
    await token.deployed();

    // Make owner fee-exempt for clean transfers
    await token.setFeeExempt(owner.address, true);

    const CommitmentVault = await ethers.getContractFactory("CommitmentVault");
    vault = await CommitmentVault.deploy(token.address, governance.address);
    await vault.deployed();

    // Make vault fee-exempt (required for production)
    await token.setFeeExempt(vault.address, true);

    // Fund users
    await token.transfer(userA.address, parse("1000000"));
    await token.transfer(userB.address, parse("500000"));
    await token.transfer(userC.address, parse("100000"));

    // Make users fee-exempt so test math is clean
    await token.setFeeExempt(userA.address, true);
    await token.setFeeExempt(userB.address, true);
    await token.setFeeExempt(userC.address, true);
  });

  // ── T01–T05: Deployment ─────────────────────────────────────

  describe("Deployment", () => {
    it("T01: sets ifrToken correctly", async () => {
      expect(await vault.ifrToken()).to.equal(token.address);
    });

    it("T02: sets owner to governance", async () => {
      expect(await vault.owner()).to.equal(governance.address);
    });

    it("T03: p0 is not set initially", async () => {
      expect(await vault.p0Set()).to.be.false;
      expect(await vault.p0()).to.equal(0);
    });

    it("T04: totalLocked starts at 0", async () => {
      expect(await vault.totalLocked()).to.equal(0);
    });

    it("T05: reverts on zero token address", async () => {
      const CV = await ethers.getContractFactory("CommitmentVault");
      await expect(
        CV.deploy(ethers.constants.AddressZero, governance.address)
      ).to.be.revertedWith("token=0");
    });
  });

  // ── T06–T10: P0 Management ─────────────────────────────────

  describe("P0 Management", () => {
    it("T06: governance can set P0", async () => {
      const p0 = ethers.utils.parseEther("0.000001"); // 1 IFR = 0.000001 ETH
      await expect(vault.connect(governance).setP0(p0))
        .to.emit(vault, "P0Set").withArgs(p0);
      expect(await vault.p0()).to.equal(p0);
      expect(await vault.p0Set()).to.be.true;
    });

    it("T07: P0 can only be set once", async () => {
      await vault.connect(governance).setP0(1000);
      await expect(
        vault.connect(governance).setP0(2000)
      ).to.be.revertedWith("P0 already set");
    });

    it("T08: P0 must be > 0", async () => {
      await expect(
        vault.connect(governance).setP0(0)
      ).to.be.revertedWith("P0 must be > 0");
    });

    it("T09: non-governance cannot set P0", async () => {
      await expect(
        vault.connect(userA).setP0(1000)
      ).to.be.reverted;
    });

    it("T10: P0 value persists correctly", async () => {
      const val = ethers.utils.parseEther("0.00000123");
      await vault.connect(governance).setP0(val);
      expect(await vault.p0()).to.equal(val);
    });
  });

  // ── T11–T18: Lock Function ─────────────────────────────────

  describe("Lock", () => {
    it("T11: lock TIME_ONLY creates tranche", async () => {
      const now = await getTimestamp();
      const unlockTime = now + 365 * ONE_DAY;
      await token.connect(userA).approve(vault.address, parse("10000"));

      await expect(vault.connect(userA).lock(parse("10000"), 0, unlockTime, 0))
        .to.emit(vault, "Locked")
        .withArgs(userA.address, 0, parse("10000"), 0);

      expect(await vault.getTrancheCount(userA.address)).to.equal(1);
      expect(await vault.totalLocked()).to.equal(parse("10000"));
    });

    it("T12: lock PRICE_ONLY creates tranche", async () => {
      await token.connect(userA).approve(vault.address, parse("5000"));
      await vault.connect(userA).lock(parse("5000"), 1, 0, 200); // 2x P0
      const t = await vault.getTranche(userA.address, 0);
      expect(t.cType).to.equal(1);
      expect(t.p0Multiplier).to.equal(200);
    });

    it("T13: lock TIME_OR_PRICE creates tranche", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("5000"));
      await vault.connect(userA).lock(parse("5000"), 2, now + 365 * ONE_DAY, 500);
      const t = await vault.getTranche(userA.address, 0);
      expect(t.cType).to.equal(2);
    });

    it("T14: lock TIME_AND_PRICE creates tranche", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("5000"));
      await vault.connect(userA).lock(parse("5000"), 3, now + 365 * ONE_DAY, 1000);
      const t = await vault.getTranche(userA.address, 0);
      expect(t.cType).to.equal(3);
    });

    it("T15: reverts on amount=0", async () => {
      const now = await getTimestamp();
      await expect(
        vault.connect(userA).lock(0, 0, now + ONE_DAY, 0)
      ).to.be.revertedWith("amount=0");
    });

    it("T16: reverts TIME_ONLY with past unlock time", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("1000"));
      await expect(
        vault.connect(userA).lock(parse("1000"), 0, now - 100, 0)
      ).to.be.revertedWith("unlockTime must be future");
    });

    it("T17: reverts PRICE_ONLY with multiplier=0", async () => {
      await token.connect(userA).approve(vault.address, parse("1000"));
      await expect(
        vault.connect(userA).lock(parse("1000"), 1, 0, 0)
      ).to.be.revertedWith("multiplier=0");
    });

    it("T18: transfers tokens from user to vault", async () => {
      const before = await token.balanceOf(userA.address);
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 0, (await getTimestamp()) + ONE_DAY, 0);
      const after = await token.balanceOf(userA.address);
      expect(before.sub(after)).to.equal(parse("10000"));
      expect(await token.balanceOf(vault.address)).to.equal(parse("10000"));
    });
  });

  // ── T19–T25: Unlock ────────────────────────────────────────

  describe("Unlock", () => {
    it("T19: unlock TIME_ONLY after time passed", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);

      await advanceTime(ONE_DAY + 1);

      const before = await token.balanceOf(userA.address);
      await expect(vault.connect(userA).unlock(userA.address, 0))
        .to.emit(vault, "Unlocked");
      const after = await token.balanceOf(userA.address);
      expect(after.sub(before)).to.equal(parse("10000"));
    });

    it("T20: revert unlock before time condition met", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + 365 * ONE_DAY, 0);

      await expect(
        vault.connect(userA).unlock(userA.address, 0)
      ).to.be.revertedWith("condition not met");
    });

    it("T21: tokens always go to original wallet, not caller", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);

      await advanceTime(ONE_DAY + 1);

      // Mark condition met first (for auto-unlock)
      await vault.connect(userB).markConditionMet(userA.address, 0);

      await advanceTime(THIRTY_DAYS + 1);

      const beforeA = await token.balanceOf(userA.address);
      const beforeB = await token.balanceOf(userB.address);

      // userB triggers unlock for userA
      await vault.connect(userB).unlock(userA.address, 0);

      const afterA = await token.balanceOf(userA.address);
      const afterB = await token.balanceOf(userB.address);

      expect(afterA.sub(beforeA)).to.equal(parse("10000")); // userA gets tokens
      expect(afterB.sub(beforeB)).to.equal(0); // userB gets nothing
    });

    it("T22: revert double unlock", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);
      await advanceTime(ONE_DAY + 1);
      await vault.connect(userA).unlock(userA.address, 0);

      await expect(
        vault.connect(userA).unlock(userA.address, 0)
      ).to.be.revertedWith("already unlocked");
    });

    it("T23: totalLocked decreases after unlock", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);
      expect(await vault.totalLocked()).to.equal(parse("10000"));

      await advanceTime(ONE_DAY + 1);
      await vault.connect(userA).unlock(userA.address, 0);
      expect(await vault.totalLocked()).to.equal(0);
    });

    it("T24: revert unlock invalid trancheId", async () => {
      await expect(
        vault.connect(userA).unlock(userA.address, 99)
      ).to.be.revertedWith("invalid trancheId");
    });

    it("T25: tranche marked as unlocked after unlock", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);
      await advanceTime(ONE_DAY + 1);
      await vault.connect(userA).unlock(userA.address, 0);

      const t = await vault.getTranche(userA.address, 0);
      expect(t.unlocked).to.be.true;
      expect(t.amount).to.equal(0);
    });
  });

  // ── T26–T30: Auto-Unlock ───────────────────────────────────

  describe("Auto-Unlock", () => {
    it("T26: third party cannot unlock before 30 day delay", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);
      await advanceTime(ONE_DAY + 1);

      // Condition met but no markConditionMet called
      await expect(
        vault.connect(userB).unlock(userA.address, 0)
      ).to.be.revertedWith("auto-unlock: 30d delay");
    });

    it("T27: third party can unlock after markConditionMet + 30 days", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);

      await advanceTime(ONE_DAY + 1);
      await vault.connect(userC).markConditionMet(userA.address, 0);

      await advanceTime(THIRTY_DAYS + 1);
      await expect(vault.connect(userB).unlock(userA.address, 0))
        .to.emit(vault, "Unlocked");
    });

    it("T28: markConditionMet emits event", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);
      await advanceTime(ONE_DAY + 1);

      await expect(vault.connect(userC).markConditionMet(userA.address, 0))
        .to.emit(vault, "ConditionMet");
    });

    it("T29: markConditionMet reverts if condition not met", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + 365 * ONE_DAY, 0);

      await expect(
        vault.connect(userB).markConditionMet(userA.address, 0)
      ).to.be.revertedWith("condition not met");
    });

    it("T30: markConditionMet reverts if already marked", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);
      await advanceTime(ONE_DAY + 1);
      await vault.markConditionMet(userA.address, 0);

      await expect(
        vault.markConditionMet(userA.address, 0)
      ).to.be.revertedWith("already marked");
    });
  });

  // ── T31–T35: Multiple Tranches ─────────────────────────────

  describe("Multiple Tranches", () => {
    it("T31: user can have multiple tranches", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("30000"));

      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);
      await vault.connect(userA).lock(parse("10000"), 0, now + 2 * ONE_DAY, 0);
      await vault.connect(userA).lock(parse("10000"), 0, now + 3 * ONE_DAY, 0);

      expect(await vault.getTrancheCount(userA.address)).to.equal(3);
      expect(await vault.totalLocked()).to.equal(parse("30000"));
    });

    it("T32: unlocking one tranche doesn't affect others", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("20000"));

      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);
      await vault.connect(userA).lock(parse("10000"), 0, now + 365 * ONE_DAY, 0);

      await advanceTime(ONE_DAY + 1);
      await vault.connect(userA).unlock(userA.address, 0);

      // First tranche unlocked, second still locked
      const t0 = await vault.getTranche(userA.address, 0);
      const t1 = await vault.getTranche(userA.address, 1);
      expect(t0.unlocked).to.be.true;
      expect(t1.unlocked).to.be.false;
      expect(await vault.totalLocked()).to.equal(parse("10000"));
    });

    it("T33: getTranches returns all tranches", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("20000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);
      await vault.connect(userA).lock(parse("10000"), 1, 0, 200);

      const all = await vault.getTranches(userA.address);
      expect(all.length).to.equal(2);
      expect(all[0].cType).to.equal(0);
      expect(all[1].cType).to.equal(1);
    });

    it("T34: lockedBalance sums active tranches only", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("30000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);
      await vault.connect(userA).lock(parse("20000"), 0, now + 365 * ONE_DAY, 0);

      expect(await vault.lockedBalance(userA.address)).to.equal(parse("30000"));

      await advanceTime(ONE_DAY + 1);
      await vault.connect(userA).unlock(userA.address, 0);

      expect(await vault.lockedBalance(userA.address)).to.equal(parse("20000"));
    });

    it("T35: hasActiveLock returns correct status", async () => {
      expect(await vault.hasActiveLock(userA.address)).to.be.false;

      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);

      expect(await vault.hasActiveLock(userA.address)).to.be.true;

      await advanceTime(ONE_DAY + 1);
      await vault.connect(userA).unlock(userA.address, 0);

      expect(await vault.hasActiveLock(userA.address)).to.be.false;
    });
  });

  // ── T36–T40: Edge Cases & Oracle ───────────────────────────

  describe("Edge Cases & Oracle", () => {
    it("T36: PRICE_ONLY with no oracle returns condition not met", async () => {
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 1, 0, 200);

      // Set P0 but no oracle
      await vault.connect(governance).setP0(ethers.utils.parseEther("0.000001"));

      expect(await vault.isConditionMet(userA.address, 0)).to.be.false;
    });

    it("T37: setPriceOracle only by governance", async () => {
      await expect(
        vault.connect(userA).setPriceOracle(userB.address)
      ).to.be.reverted;

      await vault.connect(governance).setPriceOracle(userB.address);
      expect(await vault.priceOracle()).to.equal(userB.address);
    });

    it("T38: setPriceOracle emits event", async () => {
      await expect(vault.connect(governance).setPriceOracle(userB.address))
        .to.emit(vault, "PriceOracleUpdated").withArgs(userB.address);
    });

    it("T39: isConditionMet on already-unlocked tranche returns true", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);
      await advanceTime(ONE_DAY + 1);
      await vault.connect(userA).unlock(userA.address, 0);

      expect(await vault.isConditionMet(userA.address, 0)).to.be.true;
    });

    it("T40: multiple users can lock independently", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await token.connect(userB).approve(vault.address, parse("20000"));

      await vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0);
      await vault.connect(userB).lock(parse("20000"), 0, now + 2 * ONE_DAY, 0);

      expect(await vault.getTrancheCount(userA.address)).to.equal(1);
      expect(await vault.getTrancheCount(userB.address)).to.equal(1);
      expect(await vault.totalLocked()).to.equal(parse("30000"));
      expect(await vault.lockedBalance(userA.address)).to.equal(parse("10000"));
      expect(await vault.lockedBalance(userB.address)).to.equal(parse("20000"));
    });

    it("T41: MAX_TRANCHES limit enforced", async () => {
      const now = await getTimestamp();
      const amount = parse("100");
      await token.connect(userA).approve(vault.address, amount.mul(51));

      // Lock 50 tranches (max)
      for (let i = 0; i < 50; i++) {
        await vault.connect(userA).lock(amount, 0, now + (i + 1) * ONE_DAY, 0);
      }
      expect(await vault.getTrancheCount(userA.address)).to.equal(50);

      // 51st should revert
      await expect(
        vault.connect(userA).lock(amount, 0, now + 51 * ONE_DAY, 0)
      ).to.be.revertedWith("max tranches reached");
    });

    it("T42: lock reverts without approval", async () => {
      const now = await getTimestamp();
      await expect(
        vault.connect(userA).lock(parse("10000"), 0, now + ONE_DAY, 0)
      ).to.be.reverted;
    });

    it("T43: isConditionMet reverts on invalid trancheId", async () => {
      await expect(
        vault.isConditionMet(userA.address, 0)
      ).to.be.revertedWith("invalid trancheId");
    });

    it("T44: TIME_OR_PRICE unlocks on time alone", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 2, now + ONE_DAY, 500);

      // Time passes, no price oracle
      await advanceTime(ONE_DAY + 1);
      expect(await vault.isConditionMet(userA.address, 0)).to.be.true;

      await vault.connect(userA).unlock(userA.address, 0);
      expect((await vault.getTranche(userA.address, 0)).unlocked).to.be.true;
    });

    it("T45: TIME_AND_PRICE requires both (time alone not enough)", async () => {
      const now = await getTimestamp();
      await token.connect(userA).approve(vault.address, parse("10000"));
      await vault.connect(userA).lock(parse("10000"), 3, now + ONE_DAY, 500);

      await advanceTime(ONE_DAY + 1);
      // Time met, but price not met (no oracle)
      expect(await vault.isConditionMet(userA.address, 0)).to.be.false;
    });
  });
});
