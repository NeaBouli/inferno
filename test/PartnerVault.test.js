const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PartnerVault", function () {
  let owner, guardian, beneficiaryA, beneficiaryB, userA;
  let token, vault;

  const parse = (s) => ethers.utils.parseUnits(s, 9);
  const PARTNER_POOL = parse("40000000");
  const DAY = 86400;
  const YEAR = 365 * DAY;

  const PID_A = ethers.utils.id("partner-alpha");
  const PID_B = ethers.utils.id("partner-beta");
  const MS_1 = ethers.utils.id("milestone-1");
  const MS_2 = ethers.utils.id("milestone-2");

  // Default partner params
  const MAX_ALLOC = parse("1000000"); // 1M IFR
  const VESTING = 180 * DAY;          // 6 months
  const CLIFF = 30 * DAY;             // 30 days
  const TIER = 1;

  // Constructor params
  const REWARD_BPS = 1500;             // 15%
  const ANNUAL_CAP = parse("4000000"); // 4M IFR

  async function deployVault() {
    const InfernoToken = await ethers.getContractFactory("InfernoToken");
    token = await InfernoToken.deploy(owner.address);
    await token.deployed();
    await token.setFeeExempt(owner.address, true);

    const PartnerVault = await ethers.getContractFactory("PartnerVault");
    vault = await PartnerVault.deploy(
      token.address,
      owner.address,
      guardian.address,
      REWARD_BPS,
      ANNUAL_CAP
    );
    await vault.deployed();

    // Fund vault with 40M IFR
    await token.transfer(vault.address, PARTNER_POOL);
    // Make vault fee-exempt
    await token.setFeeExempt(vault.address, true);
  }

  async function createAndActivate(partnerId, beneficiary, maxAlloc) {
    await vault.createPartner(
      partnerId,
      beneficiary,
      maxAlloc || MAX_ALLOC,
      VESTING,
      CLIFF,
      TIER
    );
    await vault.activatePartner(partnerId);
  }

  async function advanceTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  beforeEach(async () => {
    [owner, guardian, beneficiaryA, beneficiaryB, userA] =
      await ethers.getSigners();
    await deployVault();
  });

  // ── 1. Deployment ─────────────────────────────────────────

  describe("Deployment", () => {
    it("sets initial parameters correctly", async () => {
      expect(await vault.ifrToken()).to.equal(token.address);
      expect(await vault.admin()).to.equal(owner.address);
      expect(await vault.guardian()).to.equal(guardian.address);
      expect(await vault.rewardBps()).to.equal(REWARD_BPS);
      expect(await vault.annualEmissionCap()).to.equal(ANNUAL_CAP);
      expect(await vault.totalAllocated()).to.equal(0);
      expect(await vault.totalRewarded()).to.equal(0);
      expect(await vault.totalClaimed()).to.equal(0);
    });

    it("PARTNER_POOL constant is 40M * 10^9", async () => {
      expect(await vault.PARTNER_POOL()).to.equal(PARTNER_POOL);
    });

    it("vault holds 40M IFR", async () => {
      expect(await vault.pendingBalance()).to.equal(PARTNER_POOL);
    });

    it("reverts on zero token address", async () => {
      const F = await ethers.getContractFactory("PartnerVault");
      await expect(
        F.deploy(ethers.constants.AddressZero, owner.address, guardian.address, REWARD_BPS, ANNUAL_CAP)
      ).to.be.revertedWith("token=0");
    });

    it("reverts on zero admin", async () => {
      const F = await ethers.getContractFactory("PartnerVault");
      await expect(
        F.deploy(token.address, ethers.constants.AddressZero, guardian.address, REWARD_BPS, ANNUAL_CAP)
      ).to.be.revertedWith("admin=0");
    });

    it("reverts on rewardBps out of range", async () => {
      const F = await ethers.getContractFactory("PartnerVault");
      await expect(
        F.deploy(token.address, owner.address, guardian.address, 100, ANNUAL_CAP)
      ).to.be.revertedWith("bps out of range");
      await expect(
        F.deploy(token.address, owner.address, guardian.address, 3000, ANNUAL_CAP)
      ).to.be.revertedWith("bps out of range");
    });

    it("reverts on annualEmissionCap out of range", async () => {
      const F = await ethers.getContractFactory("PartnerVault");
      await expect(
        F.deploy(token.address, owner.address, guardian.address, REWARD_BPS, parse("500000"))
      ).to.be.revertedWith("cap out of range");
      await expect(
        F.deploy(token.address, owner.address, guardian.address, REWARD_BPS, parse("20000000"))
      ).to.be.revertedWith("cap out of range");
    });
  });

  // ── 2. createPartner ──────────────────────────────────────

  describe("createPartner", () => {
    it("creates a partner with correct data", async () => {
      await expect(
        vault.createPartner(PID_A, beneficiaryA.address, MAX_ALLOC, VESTING, CLIFF, TIER)
      )
        .to.emit(vault, "PartnerCreated")
        .withArgs(PID_A, beneficiaryA.address, MAX_ALLOC, VESTING, CLIFF, TIER);

      const p = await vault.partners(PID_A);
      expect(p.beneficiary).to.equal(beneficiaryA.address);
      expect(p.maxAllocation).to.equal(MAX_ALLOC);
      expect(p.vestingDuration).to.equal(VESTING);
      expect(p.cliff).to.equal(CLIFF);
      expect(p.active).to.equal(false);
      expect(p.tier).to.equal(TIER);
      expect(await vault.totalAllocated()).to.equal(MAX_ALLOC);
    });

    it("reverts if not admin", async () => {
      await expect(
        vault.connect(userA).createPartner(PID_A, beneficiaryA.address, MAX_ALLOC, VESTING, CLIFF, TIER)
      ).to.be.revertedWith("not admin");
    });

    it("reverts on duplicate partnerId", async () => {
      await vault.createPartner(PID_A, beneficiaryA.address, MAX_ALLOC, VESTING, CLIFF, TIER);
      await expect(
        vault.createPartner(PID_A, beneficiaryB.address, MAX_ALLOC, VESTING, CLIFF, TIER)
      ).to.be.revertedWith("already exists");
    });

    it("reverts on zero beneficiary", async () => {
      await expect(
        vault.createPartner(PID_A, ethers.constants.AddressZero, MAX_ALLOC, VESTING, CLIFF, TIER)
      ).to.be.revertedWith("beneficiary=0");
    });

    it("reverts if exceeds PARTNER_POOL", async () => {
      await expect(
        vault.createPartner(PID_A, beneficiaryA.address, PARTNER_POOL.add(1), VESTING, CLIFF, TIER)
      ).to.be.revertedWith("exceeds pool");
    });

    it("reverts on vestingDuration out of bounds", async () => {
      await expect(
        vault.createPartner(PID_A, beneficiaryA.address, MAX_ALLOC, 90 * DAY, CLIFF, TIER)
      ).to.be.revertedWith("vesting out of range");
      await expect(
        vault.createPartner(PID_A, beneficiaryA.address, MAX_ALLOC, 400 * DAY, CLIFF, TIER)
      ).to.be.revertedWith("vesting out of range");
    });

    it("reverts if cliff > vestingDuration", async () => {
      await expect(
        vault.createPartner(PID_A, beneficiaryA.address, MAX_ALLOC, VESTING, VESTING + 1, TIER)
      ).to.be.revertedWith("cliff>vesting");
    });

    it("reverts on zero allocation", async () => {
      await expect(
        vault.createPartner(PID_A, beneficiaryA.address, 0, VESTING, CLIFF, TIER)
      ).to.be.revertedWith("allocation=0");
    });
  });

  // ── 3. activatePartner ────────────────────────────────────

  describe("activatePartner", () => {
    beforeEach(async () => {
      await vault.createPartner(PID_A, beneficiaryA.address, MAX_ALLOC, VESTING, CLIFF, TIER);
    });

    it("activates a partner", async () => {
      await expect(vault.activatePartner(PID_A))
        .to.emit(vault, "PartnerActivated")
        .withArgs(PID_A);
      const p = await vault.partners(PID_A);
      expect(p.active).to.equal(true);
    });

    it("reverts if not admin", async () => {
      await expect(
        vault.connect(userA).activatePartner(PID_A)
      ).to.be.revertedWith("not admin");
    });

    it("reverts if already active", async () => {
      await vault.activatePartner(PID_A);
      await expect(vault.activatePartner(PID_A)).to.be.revertedWith(
        "already active"
      );
    });

    it("reverts for non-existent partner", async () => {
      await expect(vault.activatePartner(PID_B)).to.be.revertedWith(
        "not found"
      );
    });
  });

  // ── 4. recordMilestone ────────────────────────────────────

  describe("recordMilestone", () => {
    beforeEach(async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
    });

    it("records a milestone and sets vestingStart", async () => {
      const unlock = parse("100000");
      await expect(vault.recordMilestone(PID_A, MS_1, unlock))
        .to.emit(vault, "MilestoneRecorded")
        .withArgs(PID_A, MS_1, unlock);

      const p = await vault.partners(PID_A);
      expect(p.unlockedTotal).to.equal(unlock);
      expect(p.vestingStart).to.be.gt(0);
    });

    it("accumulates multiple milestones", async () => {
      await vault.recordMilestone(PID_A, MS_1, parse("200000"));
      await vault.recordMilestone(PID_A, MS_2, parse("300000"));
      const p = await vault.partners(PID_A);
      expect(p.unlockedTotal).to.equal(parse("500000"));
    });

    it("reverts if partner not active", async () => {
      await vault.createPartner(PID_B, beneficiaryB.address, MAX_ALLOC, VESTING, CLIFF, TIER);
      await expect(
        vault.recordMilestone(PID_B, MS_1, parse("100000"))
      ).to.be.revertedWith("not active");
    });

    it("reverts on milestone replay", async () => {
      await vault.recordMilestone(PID_A, MS_1, parse("100000"));
      await expect(
        vault.recordMilestone(PID_A, MS_1, parse("50000"))
      ).to.be.revertedWith("milestone done");
    });

    it("reverts if exceeds maxAllocation", async () => {
      await expect(
        vault.recordMilestone(PID_A, MS_1, MAX_ALLOC.add(1))
      ).to.be.revertedWith("exceeds allocation");
    });

    it("reverts if milestones finalized", async () => {
      await vault.finalizeMilestones(PID_A);
      await expect(
        vault.recordMilestone(PID_A, MS_1, parse("100000"))
      ).to.be.revertedWith("milestones final");
    });

    it("reverts on zero amount", async () => {
      await expect(
        vault.recordMilestone(PID_A, MS_1, 0)
      ).to.be.revertedWith("amount=0");
    });
  });

  // ── 5. recordLockReward ───────────────────────────────────

  describe("recordLockReward", () => {
    beforeEach(async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
    });

    it("calculates reward correctly (lockAmount * rewardBps / 10000)", async () => {
      const lockAmount = parse("10000"); // 10,000 IFR
      const expectedReward = lockAmount.mul(REWARD_BPS).div(10000); // 1,500 IFR

      await expect(vault.recordLockReward(PID_A, lockAmount, userA.address))
        .to.emit(vault, "LockRewardRecorded")
        .withArgs(PID_A, userA.address, lockAmount, expectedReward);

      const p = await vault.partners(PID_A);
      expect(p.rewardAccrued).to.equal(expectedReward);
      expect(await vault.totalRewarded()).to.equal(expectedReward);
    });

    it("sets vestingStart on first reward if no milestones yet", async () => {
      const p1 = await vault.partners(PID_A);
      expect(p1.vestingStart).to.equal(0);

      await vault.recordLockReward(PID_A, parse("10000"), userA.address);

      const p2 = await vault.partners(PID_A);
      expect(p2.vestingStart).to.be.gt(0);
    });

    it("reverts if exceeds partner cap", async () => {
      // 1M allocation, at 15% reward, lock ~6.667M IFR to fill
      // unlockedTotal + rewardAccrued + reward <= maxAllocation
      const bigLock = parse("7000000"); // 7M * 15% = 1.05M > 1M cap
      await expect(
        vault.recordLockReward(PID_A, bigLock, userA.address)
      ).to.be.revertedWith("exceeds allocation");
    });

    it("reverts if exceeds annual emission cap", async () => {
      // Create partner with huge allocation to avoid partner cap
      await vault.createPartner(
        PID_B,
        beneficiaryB.address,
        parse("30000000"), // 30M
        VESTING,
        CLIFF,
        TIER
      );
      await vault.activatePartner(PID_B);

      // Annual cap = 4M IFR. At 15%, need to lock 4M/0.15 = ~26.67M to exceed
      const bigLock = parse("27000000"); // 27M * 15% = 4.05M > 4M annual cap
      await expect(
        vault.recordLockReward(PID_B, bigLock, userA.address)
      ).to.be.revertedWith("exceeds annual cap");
    });

    it("annual cap resets after 365 days", async () => {
      // Create partner with big allocation
      await vault.createPartner(
        PID_B,
        beneficiaryB.address,
        parse("20000000"),
        VESTING,
        CLIFF,
        TIER
      );
      await vault.activatePartner(PID_B);

      // Use up most of annual cap
      await vault.recordLockReward(PID_B, parse("26000000"), userA.address); // 3.9M reward

      // This should fail (only 100K left in annual cap) — use different wallet (already rewarded)
      await expect(
        vault.recordLockReward(PID_B, parse("2000000"), beneficiaryA.address) // 300K reward > 100K remaining
      ).to.be.revertedWith("exceeds annual cap");

      // Advance 1 year
      await advanceTime(YEAR + 1);

      // Now it should work (cap reset, different wallet)
      await vault.recordLockReward(PID_B, parse("2000000"), beneficiaryB.address);
      expect(await vault.yearlyEmitted()).to.equal(parse("300000"));
    });

    it("reverts on zero lockAmount", async () => {
      await expect(
        vault.recordLockReward(PID_A, 0, userA.address)
      ).to.be.revertedWith("amount=0");
    });

    it("reverts if not authorized", async () => {
      await expect(
        vault.connect(userA).recordLockReward(PID_A, parse("10000"), userA.address)
      ).to.be.revertedWith("not authorized");
    });
  });

  // ── 6. Vesting math ──────────────────────────────────────

  describe("Vesting math", () => {
    beforeEach(async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
    });

    it("returns 0 before vestingStart", async () => {
      expect(await vault.vestedAmount(PID_A)).to.equal(0);
      expect(await vault.claimable(PID_A)).to.equal(0);
    });

    it("returns 0 during cliff", async () => {
      await vault.recordMilestone(PID_A, MS_1, parse("100000"));
      await advanceTime(CLIFF / 2); // halfway through cliff
      expect(await vault.vestedAmount(PID_A)).to.equal(0);
    });

    it("partial vesting after cliff", async () => {
      const amount = parse("300000");
      await vault.recordMilestone(PID_A, MS_1, amount);

      // Advance past cliff + half of effective vesting
      const effectiveDuration = VESTING - CLIFF;
      await advanceTime(CLIFF + effectiveDuration / 2);

      const vested = await vault.vestedAmount(PID_A);
      // Should be approximately 50% of amount
      const halfAmount = amount.div(2);
      const tolerance = parse("2000"); // small tolerance for block time
      expect(vested).to.be.gte(halfAmount.sub(tolerance));
      expect(vested).to.be.lte(halfAmount.add(tolerance));
    });

    it("full vesting after vestingDuration", async () => {
      const amount = parse("500000");
      await vault.recordMilestone(PID_A, MS_1, amount);
      await advanceTime(VESTING + 1);
      expect(await vault.vestedAmount(PID_A)).to.equal(amount);
    });

    it("milestone + reward combined in vesting calculation", async () => {
      const milestoneAmt = parse("200000");
      const lockAmount = parse("100000");
      const rewardAmt = lockAmount.mul(REWARD_BPS).div(10000); // 15000

      await vault.recordMilestone(PID_A, MS_1, milestoneAmt);
      await vault.recordLockReward(PID_A, lockAmount, userA.address);

      const totalEarned = milestoneAmt.add(rewardAmt);

      // After full vesting
      await advanceTime(VESTING + 1);
      expect(await vault.vestedAmount(PID_A)).to.equal(totalEarned);
    });

    it("vesting with zero cliff starts immediately", async () => {
      // Create partner with no cliff
      const pid = ethers.utils.id("no-cliff");
      await vault.createPartner(pid, beneficiaryA.address, MAX_ALLOC, VESTING, 0, TIER);
      await vault.activatePartner(pid);

      await vault.recordMilestone(pid, MS_1, parse("180000"));

      // After half vesting duration
      await advanceTime(VESTING / 2);

      const vested = await vault.vestedAmount(pid);
      const half = parse("90000");
      const tolerance = parse("1000");
      expect(vested).to.be.gte(half.sub(tolerance));
      expect(vested).to.be.lte(half.add(tolerance));
    });
  });

  // ── 7. claim ──────────────────────────────────────────────

  describe("claim", () => {
    beforeEach(async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
      await vault.recordMilestone(PID_A, MS_1, parse("300000"));
    });

    it("transfers correct amount to beneficiary", async () => {
      await advanceTime(VESTING + 1); // fully vested

      const balBefore = await token.balanceOf(beneficiaryA.address);
      await expect(vault.claim(PID_A))
        .to.emit(vault, "Claimed")
        .withArgs(PID_A, beneficiaryA.address, parse("300000"));

      const balAfter = await token.balanceOf(beneficiaryA.address);
      expect(balAfter.sub(balBefore)).to.equal(parse("300000"));

      const p = await vault.partners(PID_A);
      expect(p.claimedTotal).to.equal(parse("300000"));
      expect(await vault.totalClaimed()).to.equal(parse("300000"));
    });

    it("partial claim then more vesting then claim again", async () => {
      const effectiveDuration = VESTING - CLIFF;

      // Advance past cliff + half effective duration
      await advanceTime(CLIFF + effectiveDuration / 2);

      // First claim (approx 50%)
      await vault.claim(PID_A);
      const p1 = await vault.partners(PID_A);
      expect(p1.claimedTotal).to.be.gt(0);

      // Advance to full vesting
      await advanceTime(effectiveDuration);

      // Second claim (remaining)
      await vault.claim(PID_A);
      const p2 = await vault.partners(PID_A);
      expect(p2.claimedTotal).to.equal(parse("300000"));
    });

    it("reverts when nothing claimable", async () => {
      // Still in cliff
      await expect(vault.claim(PID_A)).to.be.revertedWith("nothing claimable");
    });

    it("reverts when paused", async () => {
      await advanceTime(VESTING + 1);
      await vault.connect(guardian).pause();
      await expect(vault.claim(PID_A)).to.be.revertedWith("EnforcedPause");
    });

    it("beneficiary change: future claims go to new address", async () => {
      await advanceTime(VESTING + 1);

      // Change beneficiary before claiming
      await vault.setPartnerBeneficiary(PID_A, beneficiaryB.address);

      const balBefore = await token.balanceOf(beneficiaryB.address);
      await vault.claim(PID_A);
      const balAfter = await token.balanceOf(beneficiaryB.address);

      expect(balAfter.sub(balBefore)).to.equal(parse("300000"));
    });

    it("anyone can call claim (permissionless)", async () => {
      await advanceTime(VESTING + 1);

      const balBefore = await token.balanceOf(beneficiaryA.address);
      // userA (not beneficiary, not admin) calls claim
      await vault.connect(userA).claim(PID_A);
      const balAfter = await token.balanceOf(beneficiaryA.address);

      expect(balAfter.sub(balBefore)).to.equal(parse("300000"));
    });
  });

  // ── 8. Governance parameter changes ───────────────────────

  describe("Governance parameters", () => {
    it("setRewardBps within bounds", async () => {
      await expect(vault.setRewardBps(2000))
        .to.emit(vault, "RewardBpsUpdated")
        .withArgs(REWARD_BPS, 2000);
      expect(await vault.rewardBps()).to.equal(2000);
    });

    it("revert: setRewardBps out of bounds (low)", async () => {
      await expect(vault.setRewardBps(100)).to.be.revertedWith(
        "bps out of range"
      );
    });

    it("revert: setRewardBps out of bounds (high)", async () => {
      await expect(vault.setRewardBps(3000)).to.be.revertedWith(
        "bps out of range"
      );
    });

    it("setAnnualEmissionCap within bounds", async () => {
      const newCap = parse("8000000");
      await expect(vault.setAnnualEmissionCap(newCap))
        .to.emit(vault, "AnnualCapUpdated")
        .withArgs(ANNUAL_CAP, newCap);
      expect(await vault.annualEmissionCap()).to.equal(newCap);
    });

    it("revert: setAnnualEmissionCap out of bounds", async () => {
      await expect(
        vault.setAnnualEmissionCap(parse("500000"))
      ).to.be.revertedWith("cap out of range");
      await expect(
        vault.setAnnualEmissionCap(parse("20000000"))
      ).to.be.revertedWith("cap out of range");
    });

    it("setPartnerAllocation increase", async () => {
      await vault.createPartner(PID_A, beneficiaryA.address, MAX_ALLOC, VESTING, CLIFF, TIER);
      const newMax = parse("2000000");
      await expect(vault.setPartnerAllocation(PID_A, newMax))
        .to.emit(vault, "AllocationUpdated")
        .withArgs(PID_A, MAX_ALLOC, newMax);

      const p = await vault.partners(PID_A);
      expect(p.maxAllocation).to.equal(newMax);
      expect(await vault.totalAllocated()).to.equal(newMax);
    });

    it("setPartnerAllocation decrease", async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
      await vault.recordMilestone(PID_A, MS_1, parse("200000"));

      // Can decrease to 200K (= earned) but not below
      await vault.setPartnerAllocation(PID_A, parse("200000"));
      const p = await vault.partners(PID_A);
      expect(p.maxAllocation).to.equal(parse("200000"));
    });

    it("revert: decrease below already earned", async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
      await vault.recordMilestone(PID_A, MS_1, parse("200000"));

      await expect(
        vault.setPartnerAllocation(PID_A, parse("100000"))
      ).to.be.revertedWith("below earned");
    });

    it("revert: allocation increase exceeds pool", async () => {
      await vault.createPartner(PID_A, beneficiaryA.address, PARTNER_POOL, VESTING, CLIFF, TIER);
      await expect(
        vault.setPartnerAllocation(PID_A, PARTNER_POOL.add(1))
      ).to.be.revertedWith("exceeds pool");
    });
  });

  // ── 9. Fee-exempt requirement ─────────────────────────────

  describe("Fee-exempt requirement", () => {
    it("claim delivers correct amount when vault is feeExempt", async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
      await vault.recordMilestone(PID_A, MS_1, parse("100000"));

      // Make beneficiary fee-exempt too for clean assertion
      await token.setFeeExempt(beneficiaryA.address, true);

      await advanceTime(VESTING + 1);

      const balBefore = await token.balanceOf(beneficiaryA.address);
      await vault.claim(PID_A);
      const balAfter = await token.balanceOf(beneficiaryA.address);

      expect(balAfter.sub(balBefore)).to.equal(parse("100000"));
    });

    it("claim delivers less without feeExempt (fees deducted)", async () => {
      // Remove fee exemption
      await token.setFeeExempt(vault.address, false);

      await createAndActivate(PID_A, beneficiaryA.address);
      await vault.recordMilestone(PID_A, MS_1, parse("100000"));
      await advanceTime(VESTING + 1);

      const balBefore = await token.balanceOf(beneficiaryA.address);
      await vault.claim(PID_A);
      const balAfter = await token.balanceOf(beneficiaryA.address);

      // Beneficiary receives less due to fees
      const received = balAfter.sub(balBefore);
      expect(received).to.be.lt(parse("100000"));
    });
  });

  // ── 10. Edge cases ────────────────────────────────────────

  describe("Edge cases", () => {
    it("claim with 0 earned reverts", async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
      await advanceTime(VESTING + 1);
      await expect(vault.claim(PID_A)).to.be.revertedWith("nothing claimable");
    });

    it("partner with only milestones (no lock rewards)", async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
      await vault.recordMilestone(PID_A, MS_1, parse("500000"));
      await advanceTime(VESTING + 1);

      await vault.claim(PID_A);
      const p = await vault.partners(PID_A);
      expect(p.claimedTotal).to.equal(parse("500000"));
      expect(p.rewardAccrued).to.equal(0);
    });

    it("partner with only lock rewards (no milestones)", async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
      await vault.recordLockReward(PID_A, parse("100000"), userA.address); // 15000 reward
      await advanceTime(VESTING + 1);

      const expectedReward = parse("100000").mul(REWARD_BPS).div(10000);
      await vault.claim(PID_A);
      const p = await vault.partners(PID_A);
      expect(p.claimedTotal).to.equal(expectedReward);
      expect(p.unlockedTotal).to.equal(0);
    });

    it("multiple partners, global caps hold", async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
      await vault.createPartner(
        PID_B,
        beneficiaryB.address,
        MAX_ALLOC,
        VESTING,
        CLIFF,
        TIER
      );
      await vault.activatePartner(PID_B);

      await vault.recordMilestone(PID_A, MS_1, parse("200000"));
      await vault.recordMilestone(PID_B, MS_1, parse("300000"));

      await advanceTime(VESTING + 1);
      await vault.claim(PID_A);
      await vault.claim(PID_B);

      expect(await vault.totalClaimed()).to.equal(parse("500000"));
      expect(await vault.totalAllocated()).to.equal(MAX_ALLOC.mul(2));
    });

    it("finalizeMilestones prevents further milestones", async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
      await vault.recordMilestone(PID_A, MS_1, parse("100000"));

      await expect(vault.finalizeMilestones(PID_A))
        .to.emit(vault, "MilestonesFinalized")
        .withArgs(PID_A);

      await expect(
        vault.recordMilestone(PID_A, MS_2, parse("50000"))
      ).to.be.revertedWith("milestones final");
    });

    it("lock rewards still work after milestones finalized", async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
      await vault.recordMilestone(PID_A, MS_1, parse("100000"));
      await vault.finalizeMilestones(PID_A);

      // Lock rewards should still work
      await vault.recordLockReward(PID_A, parse("50000"), userA.address);
      const p = await vault.partners(PID_A);
      expect(p.rewardAccrued).to.equal(parse("50000").mul(REWARD_BPS).div(10000));
    });
  });

  // ── Guardian & Admin ──────────────────────────────────────

  describe("Guardian & Admin", () => {
    it("guardian can pause and unpause", async () => {
      await vault.connect(guardian).pause();
      await createAndActivate(PID_A, beneficiaryA.address);
      await vault.recordMilestone(PID_A, MS_1, parse("100000"));
      await advanceTime(VESTING + 1);

      await expect(vault.claim(PID_A)).to.be.revertedWith("EnforcedPause");

      await vault.connect(guardian).unpause();
      await vault.claim(PID_A); // should work now
    });

    it("guardian can update guardian", async () => {
      await expect(vault.connect(guardian).setGuardian(userA.address))
        .to.emit(vault, "GuardianUpdated")
        .withArgs(guardian.address, userA.address);
      expect(await vault.guardian()).to.equal(userA.address);
    });

    it("non-guardian cannot pause", async () => {
      await expect(vault.connect(userA).pause()).to.be.revertedWith(
        "not guardian"
      );
    });

    it("admin can update admin", async () => {
      await expect(vault.setAdmin(userA.address))
        .to.emit(vault, "AdminUpdated")
        .withArgs(owner.address, userA.address);
      expect(await vault.admin()).to.equal(userA.address);
    });

    it("non-admin cannot update admin", async () => {
      await expect(
        vault.connect(userA).setAdmin(userA.address)
      ).to.be.revertedWith("not admin");
    });
  });

  // ── 11. authorizedCaller ────────────────────────────────────

  describe("authorizedCaller", () => {
    beforeEach(async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
    });

    it("setAuthorizedCaller sets caller and emits event", async () => {
      await expect(vault.setAuthorizedCaller(userA.address, true))
        .to.emit(vault, "AuthorizedCallerUpdated")
        .withArgs(userA.address, true);
      expect(await vault.authorizedCaller(userA.address)).to.equal(true);
    });

    it("setAuthorizedCaller reverts if not admin", async () => {
      await expect(
        vault.connect(userA).setAuthorizedCaller(userA.address, true)
      ).to.be.revertedWith("not admin");
    });

    it("setAuthorizedCaller reverts on zero address", async () => {
      await expect(
        vault.setAuthorizedCaller(ethers.constants.AddressZero, true)
      ).to.be.revertedWith("caller=0");
    });

    it("authorized caller can call recordLockReward", async () => {
      await vault.setAuthorizedCaller(userA.address, true);
      const lockAmount = parse("10000");
      const expectedReward = lockAmount.mul(REWARD_BPS).div(10000);

      await expect(
        vault.connect(userA).recordLockReward(PID_A, lockAmount, beneficiaryA.address)
      )
        .to.emit(vault, "LockRewardRecorded")
        .withArgs(PID_A, beneficiaryA.address, lockAmount, expectedReward);
    });

    it("non-authorized non-admin is rejected", async () => {
      await expect(
        vault.connect(userA).recordLockReward(PID_A, parse("10000"), beneficiaryA.address)
      ).to.be.revertedWith("not authorized");
    });

    it("revoking authorized caller blocks subsequent calls", async () => {
      await vault.setAuthorizedCaller(userA.address, true);
      // First call succeeds
      await vault.connect(userA).recordLockReward(PID_A, parse("10000"), beneficiaryA.address);

      // Revoke
      await vault.setAuthorizedCaller(userA.address, false);
      expect(await vault.authorizedCaller(userA.address)).to.equal(false);

      // Second call fails
      await expect(
        vault.connect(userA).recordLockReward(PID_A, parse("10000"), beneficiaryB.address)
      ).to.be.revertedWith("not authorized");
    });

    it("admin can still call recordLockReward regardless", async () => {
      // admin (owner) can always call, no need to be in authorizedCaller
      await vault.recordLockReward(PID_A, parse("10000"), userA.address);
      const p = await vault.partners(PID_A);
      expect(p.rewardAccrued).to.be.gt(0);
    });
  });

  // ── 12. Anti-double-count ───────────────────────────────────

  describe("Anti-double-count", () => {
    beforeEach(async () => {
      await createAndActivate(PID_A, beneficiaryA.address);
      await createAndActivate(PID_B, beneficiaryB.address);
    });

    it("recordLockReward with wallet param works correctly", async () => {
      await vault.recordLockReward(PID_A, parse("10000"), userA.address);
      expect(await vault.walletRewardClaimed(userA.address, PID_A)).to.equal(true);
    });

    it("same wallet + same partner reverts with 'already rewarded'", async () => {
      await vault.recordLockReward(PID_A, parse("10000"), userA.address);
      await expect(
        vault.recordLockReward(PID_A, parse("5000"), userA.address)
      ).to.be.revertedWith("already rewarded");
    });

    it("same wallet + different partner succeeds", async () => {
      await vault.recordLockReward(PID_A, parse("10000"), userA.address);
      // Same wallet, different partner — should work
      await vault.recordLockReward(PID_B, parse("10000"), userA.address);
      expect(await vault.walletRewardClaimed(userA.address, PID_B)).to.equal(true);
    });

    it("different wallet + same partner succeeds", async () => {
      await vault.recordLockReward(PID_A, parse("10000"), userA.address);
      // Different wallet, same partner
      await vault.recordLockReward(PID_A, parse("10000"), beneficiaryB.address);
      expect(await vault.walletRewardClaimed(beneficiaryB.address, PID_A)).to.equal(true);
    });

    it("zero wallet address reverts", async () => {
      await expect(
        vault.recordLockReward(PID_A, parse("10000"), ethers.constants.AddressZero)
      ).to.be.revertedWith("wallet=0");
    });
  });

  // ── 13. Algorithmic Emission Throttle ───────────────────────

  describe("Algo Throttle", () => {
    let ifrLock;

    beforeEach(async () => {
      await createAndActivate(PID_A, beneficiaryA.address);

      // Deploy real IFRLock for throttle tests
      const IFRLock = await ethers.getContractFactory("IFRLock");
      ifrLock = await IFRLock.deploy(token.address, guardian.address);
      await ifrLock.deployed();

      // Make IFRLock fee-exempt for lock/unlock
      await token.setFeeExempt(ifrLock.address, true);
    });

    it("without ifrLock set, uses flat rewardBps (backward compat)", async () => {
      // ifrLock not set → _effectiveRewardBps() = rewardBps
      const lockAmount = parse("10000");
      const expectedReward = lockAmount.mul(REWARD_BPS).div(10000);

      await vault.recordLockReward(PID_A, lockAmount, userA.address);
      const p = await vault.partners(PID_A);
      expect(p.rewardAccrued).to.equal(expectedReward);
    });

    it("setIFRLock works as admin and emits event", async () => {
      await expect(vault.setIFRLock(ifrLock.address))
        .to.emit(vault, "IFRLockUpdated")
        .withArgs(ethers.constants.AddressZero, ifrLock.address);
      expect(await vault.ifrLock()).to.equal(ifrLock.address);
    });

    it("setIFRLock reverts for non-admin", async () => {
      await expect(
        vault.connect(userA).setIFRLock(ifrLock.address)
      ).to.be.revertedWith("not admin");
    });

    it("low lock ratio (< 1%) → full rewardBps", async () => {
      // Lock < 1% of 1B = < 10M IFR
      // Lock 5M IFR (0.5%)
      await token.setFeeExempt(userA.address, true);
      await token.transfer(userA.address, parse("5000000"));
      await token.connect(userA).approve(ifrLock.address, parse("5000000"));
      await ifrLock.connect(userA).lock(parse("5000000"));

      await vault.setIFRLock(ifrLock.address);

      const lockAmount = parse("10000");
      const expectedReward = lockAmount.mul(REWARD_BPS).div(10000); // full rate

      await vault.recordLockReward(PID_A, lockAmount, beneficiaryA.address);
      const p = await vault.partners(PID_A);
      expect(p.rewardAccrued).to.equal(expectedReward);
    });

    it("high lock ratio (>= 50%) → MIN_REWARD_BPS floor", async () => {
      // Lock 50% of 1B = 500M IFR
      // Owner has most tokens, make fee-exempt
      await token.setFeeExempt(owner.address, true);
      await token.approve(ifrLock.address, parse("500000000"));
      await ifrLock.connect(owner).lock(parse("500000000"));

      await vault.setIFRLock(ifrLock.address);

      const lockAmount = parse("10000");
      const minReward = lockAmount.mul(500).div(10000); // MIN_REWARD_BPS = 500

      await vault.recordLockReward(PID_A, lockAmount, beneficiaryA.address);
      const p = await vault.partners(PID_A);
      expect(p.rewardAccrued).to.equal(minReward);
    });

    it("mid lock ratio → interpolated value", async () => {
      // Lock 25.5% of supply → midpoint of [1%, 50%] range
      // lockRatio = 2550 bps
      // drop = (1500 - 500) * (2550 - 100) / (5000 - 100) = 1000 * 2450 / 4900 = 500
      // effective = 1500 - 500 = 1000
      await token.setFeeExempt(owner.address, true);
      await token.approve(ifrLock.address, parse("255000000"));
      await ifrLock.connect(owner).lock(parse("255000000"));

      await vault.setIFRLock(ifrLock.address);

      const lockAmount = parse("10000");
      const expectedReward = lockAmount.mul(1000).div(10000); // effective BPS = 1000

      await vault.recordLockReward(PID_A, lockAmount, beneficiaryA.address);
      const p = await vault.partners(PID_A);
      expect(p.rewardAccrued).to.equal(expectedReward);
    });

    it("effective BPS always >= MIN_REWARD_BPS", async () => {
      // Lock 90% — well above 50% threshold, should still get MIN_REWARD_BPS
      await token.setFeeExempt(owner.address, true);
      await token.approve(ifrLock.address, parse("900000000"));
      await ifrLock.connect(owner).lock(parse("900000000"));

      await vault.setIFRLock(ifrLock.address);

      const lockAmount = parse("10000");
      const minReward = lockAmount.mul(500).div(10000); // MIN_REWARD_BPS = 500

      await vault.recordLockReward(PID_A, lockAmount, beneficiaryA.address);
      const p = await vault.partners(PID_A);
      expect(p.rewardAccrued).to.equal(minReward);
    });

    it("effective BPS never exceeds rewardBps", async () => {
      // No locks at all → should use rewardBps
      await vault.setIFRLock(ifrLock.address);

      const lockAmount = parse("10000");
      const maxReward = lockAmount.mul(REWARD_BPS).div(10000);

      await vault.recordLockReward(PID_A, lockAmount, beneficiaryA.address);
      const p = await vault.partners(PID_A);
      expect(p.rewardAccrued).to.equal(maxReward);
    });

    it("TOTAL_SUPPLY constant matches 1B * 10^9", async () => {
      expect(await vault.TOTAL_SUPPLY()).to.equal(parse("1000000000"));
    });

    it("setIFRLock to zero address disables throttle", async () => {
      await vault.setIFRLock(ifrLock.address);

      // Lock 50% to activate throttle
      await token.setFeeExempt(owner.address, true);
      await token.approve(ifrLock.address, parse("500000000"));
      await ifrLock.connect(owner).lock(parse("500000000"));

      // Record with throttled rate
      await vault.recordLockReward(PID_A, parse("10000"), userA.address);
      const p1 = await vault.partners(PID_A);
      const throttledReward = p1.rewardAccrued;

      // Reset ifrLock to zero → disables throttle
      await vault.setIFRLock(ethers.constants.AddressZero);

      // Record again (different wallet) with flat rate
      await vault.recordLockReward(PID_A, parse("10000"), beneficiaryA.address);
      const p2 = await vault.partners(PID_A);
      const secondReward = p2.rewardAccrued.sub(throttledReward);

      // Flat rate should be higher than throttled rate
      expect(secondReward).to.be.gt(throttledReward);
    });
  });

  // ── Integration Tests ─────────────────────────────────────

  describe("Integration: full lifecycle", () => {
    it("create → activate → milestone → lockReward → vest → claim", async () => {
      // 1. Create and activate partner
      await createAndActivate(PID_A, beneficiaryA.address, MAX_ALLOC);
      const p0 = await vault.partners(PID_A);
      expect(p0.active).to.equal(true);
      expect(p0.unlockedTotal).to.equal(0);
      expect(p0.rewardAccrued).to.equal(0);

      // 2. Record milestone (500K unlocked)
      const milestoneAmount = parse("500000");
      await vault.recordMilestone(PID_A, MS_1, milestoneAmount);

      // 3. Record lock reward (10K lock → 1.5K reward at 15%)
      const lockAmount = parse("10000");
      await vault.recordLockReward(PID_A, lockAmount, userA.address);
      const p1 = await vault.partners(PID_A);
      const expectedReward = lockAmount.mul(REWARD_BPS).div(10000);
      expect(p1.rewardAccrued).to.equal(expectedReward);
      expect(p1.unlockedTotal.add(p1.rewardAccrued)).to.equal(milestoneAmount.add(expectedReward));

      // 4. Advance past cliff + half vesting
      await advanceTime(CLIFF + VESTING / 2);

      // 5. Claim — beneficiary receives partial vesting
      const balBefore = await token.balanceOf(beneficiaryA.address);
      await vault.claim(PID_A);
      const balAfter = await token.balanceOf(beneficiaryA.address);
      expect(balAfter.sub(balBefore)).to.be.gt(0);

      // 6. Advance past full vesting
      await advanceTime(VESTING);
      await vault.claim(PID_A);
      const totalClaimed = await vault.totalClaimed();
      expect(totalClaimed).to.be.gt(0);
    });

    it("two partners, independent vesting timelines", async () => {
      await createAndActivate(PID_A, beneficiaryA.address, MAX_ALLOC);
      await createAndActivate(PID_B, beneficiaryB.address, MAX_ALLOC);

      // Milestone for partner A now
      await vault.recordMilestone(PID_A, MS_1, parse("200000"));

      // Advance 90 days, then milestone for partner B
      await advanceTime(90 * DAY);
      await vault.recordMilestone(PID_B, MS_1, parse("300000"));

      // Advance past A's full vesting but B still mid-vesting
      // A started at t=0, needs CLIFF + VESTING = 210d total.
      // We already advanced 90d, so 120d more covers A fully.
      // B started at t=90d, needs 210d total. At t=210d, B has 120d = still in vesting.
      await advanceTime(120 * DAY);

      // A should be fully claimable (210d > CLIFF+VESTING)
      const claimableA = await vault.claimable(PID_A);
      expect(claimableA).to.equal(parse("200000"));

      // B still mid-vesting (only 120d into 210d = CLIFF+VESTING)
      const claimableB = await vault.claimable(PID_B);
      expect(claimableB).to.be.lt(parse("300000"));
      expect(claimableB).to.be.gt(0);
    });

    it("authorizedCaller records reward, beneficiary claims", async () => {
      await createAndActivate(PID_A, beneficiaryA.address, MAX_ALLOC);
      await vault.recordMilestone(PID_A, MS_1, parse("100000"));

      // Set userA as authorized caller
      await vault.setAuthorizedCaller(userA.address, true);

      // Authorized caller records lock reward
      await vault.connect(userA).recordLockReward(PID_A, parse("5000"), beneficiaryB.address);

      // Advance past vesting
      await advanceTime(VESTING + CLIFF);

      // Claim as anyone (permissionless)
      const balBefore = await token.balanceOf(beneficiaryA.address);
      await vault.connect(userA).claim(PID_A);
      const balAfter = await token.balanceOf(beneficiaryA.address);
      expect(balAfter.sub(balBefore)).to.be.gt(0);
    });

    it("milestone + lock reward + anti-double-count + claim", async () => {
      await createAndActivate(PID_A, beneficiaryA.address, MAX_ALLOC);

      // Milestone
      await vault.recordMilestone(PID_A, MS_1, parse("50000"));

      // Lock reward from userA
      await vault.recordLockReward(PID_A, parse("2000"), userA.address);

      // Same wallet + same partner → reverts
      await expect(
        vault.recordLockReward(PID_A, parse("2000"), userA.address)
      ).to.be.revertedWith("already rewarded");

      // Same wallet + different partner → OK
      await createAndActivate(PID_B, beneficiaryB.address, MAX_ALLOC);
      await vault.recordMilestone(PID_B, MS_1, parse("50000"));
      await vault.recordLockReward(PID_B, parse("2000"), userA.address);

      // Advance and claim both
      await advanceTime(VESTING + CLIFF);
      await vault.claim(PID_A);
      await vault.claim(PID_B);

      const totalClaimed = await vault.totalClaimed();
      expect(totalClaimed).to.be.gt(0);
    });

    it("finalize milestones, then only lock rewards add to earned", async () => {
      await createAndActivate(PID_A, beneficiaryA.address, MAX_ALLOC);
      await vault.recordMilestone(PID_A, MS_1, parse("100000"));
      await vault.finalizeMilestones(PID_A);

      // Further milestones blocked
      await expect(
        vault.recordMilestone(PID_A, MS_2, parse("50000"))
      ).to.be.revertedWith("milestones final");

      // Lock rewards still work
      await vault.recordLockReward(PID_A, parse("5000"), userA.address);
      const p = await vault.partners(PID_A);
      const expectedReward = parse("5000").mul(REWARD_BPS).div(10000);
      expect(p.unlockedTotal.add(p.rewardAccrued)).to.equal(parse("100000").add(expectedReward));
    });

    it("guardian pause blocks claim, unpause resumes", async () => {
      await createAndActivate(PID_A, beneficiaryA.address, MAX_ALLOC);
      await vault.recordMilestone(PID_A, MS_1, parse("100000"));
      await advanceTime(VESTING + CLIFF);

      // Pause
      await vault.connect(guardian).pause();
      await expect(vault.claim(PID_A)).to.be.reverted;

      // Unpause
      await vault.connect(guardian).unpause();
      await vault.claim(PID_A);
      expect(await vault.totalClaimed()).to.be.gt(0);
    });
  });
});
