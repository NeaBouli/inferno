import { expect } from "chai";
import { ethers } from "./helpers/hardhat.js";

describe("BootstrapVaultV3", function () {
  let owner, userA, userB, userC;
  let ifrToken, weth, router, locker, vault;
  let startTime;

  const DURATION = 90 * 24 * 60 * 60; // 90 days
  const IFR_ALLOCATION = ethers.parseEther("100000000"); // 100M IFR
  const MIN_CONTRIBUTION = ethers.parseEther("0.01");
  const MAX_CONTRIBUTION = ethers.parseEther("2");
  const LP_LOCK_DURATION = 365 * 24 * 60 * 60; // 12 months
  const REFUND_GRACE_PERIOD = 30 * 24 * 60 * 60; // 30 days

  const pe = (s) => ethers.parseEther(s);

  beforeEach(async () => {
    [owner, userA, userB, userC] = await ethers.getSigners();

    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockToken");
    ifrToken = await MockToken.deploy("Inferno Token", "IFR");
    await ifrToken.waitForDeployment();

    weth = await MockToken.deploy("Wrapped ETH", "WETH");
    await weth.waitForDeployment();

    // Deploy mock router (also acts as factory)
    const MockBootstrapRouter = await ethers.getContractFactory("MockBootstrapRouter");
    router = await MockBootstrapRouter.deploy(weth.target);
    await router.waitForDeployment();

    // Deploy mock Team.Finance locker
    const MockTeamFinanceLocker = await ethers.getContractFactory("MockTeamFinanceLocker");
    locker = await MockTeamFinanceLocker.deploy();
    await locker.waitForDeployment();

    // Deploy BootstrapVaultV3
    const block = await ethers.provider.getBlock("latest");
    startTime = block.timestamp + 10;

    const BootstrapVaultV3 = await ethers.getContractFactory("BootstrapVaultV3");
    vault = await BootstrapVaultV3.deploy(
      ifrToken.target,
      router.target,
      locker.target,
      startTime,
      DURATION,
      IFR_ALLOCATION,
      MIN_CONTRIBUTION,
      MAX_CONTRIBUTION,
      LP_LOCK_DURATION
    );
    await vault.waitForDeployment();

    // Fund vault directly with 2x allocation (simulates LiqRes.withdraw)
    await ifrToken.mint(vault.target, BigInt(IFR_ALLOCATION)*BigInt(2));

    // Advance to startTime
    await ethers.provider.send("evm_setNextBlockTimestamp", [startTime]);
    await ethers.provider.send("evm_mine", []);
  });

  // ── Deployment ────────────────────────────────────────────

  describe("Deployment", () => {
    it("sets all immutable parameters correctly", async () => {
      expect(await vault.ifrToken()).to.equal(ifrToken.target);
      expect(await vault.uniswapRouter()).to.equal(router.target);
      expect(await vault.teamFinanceLocker()).to.equal(locker.target);
      expect(await vault.startTime()).to.equal(startTime);
      expect(await vault.endTime()).to.equal(startTime + DURATION);
      expect(await vault.ifrAllocation()).to.equal(IFR_ALLOCATION);
      expect(await vault.minContribution()).to.equal(MIN_CONTRIBUTION);
      expect(await vault.maxContribution()).to.equal(MAX_CONTRIBUTION);
      expect(await vault.lpLockDuration()).to.equal(LP_LOCK_DURATION);
      expect(await vault.totalETHRaised()).to.equal(0);
      expect(await vault.finalised()).to.equal(false);
      expect(await vault.REFUND_GRACE_PERIOD()).to.equal(REFUND_GRACE_PERIOD);
    });

    it("reverts with zero address or invalid parameters", async () => {
      const BootstrapVaultV3 = await ethers.getContractFactory("BootstrapVaultV3");
      const args = [ifrToken.target, router.target, locker.target,
        startTime, DURATION, IFR_ALLOCATION, MIN_CONTRIBUTION, MAX_CONTRIBUTION, LP_LOCK_DURATION];

      // ifrToken=0
      await expect(BootstrapVaultV3.deploy(
        ethers.ZeroAddress, args[1], args[2], args[3], args[4], args[5], args[6], args[7], args[8]
      )).to.be.revertedWith("ifrToken=0");

      // router=0
      await expect(BootstrapVaultV3.deploy(
        args[0], ethers.ZeroAddress, args[2], args[3], args[4], args[5], args[6], args[7], args[8]
      )).to.be.revertedWith("router=0");

      // max < min
      await expect(BootstrapVaultV3.deploy(
        args[0], args[1], args[2], args[3], args[4], args[5], pe("2"), pe("1"), args[8]
      )).to.be.revertedWith("max<min");
    });
  });

  // ── Contribution ────────────────────────────────────────────

  describe("Contribution", () => {
    it("accepts valid ETH contribution", async () => {
      await expect(vault.connect(userA).contribute({ value: pe("1") }))
        .to.emit(vault, "Contributed")
        .withArgs(userA.address, pe("1"), pe("1"));

      expect(await vault.contributions(userA.address)).to.equal(pe("1"));
      expect(await vault.totalETHRaised()).to.equal(pe("1"));
    });

    it("rejects below minContribution", async () => {
      await expect(
        vault.connect(userA).contribute({ value: pe("0.005") })
      ).to.be.revertedWith("below min");
    });

    it("rejects above maxContribution per wallet", async () => {
      await expect(
        vault.connect(userA).contribute({ value: pe("3") })
      ).to.be.revertedWith("exceeds max");
    });

    it("allows multiple contributions up to max", async () => {
      await vault.connect(userA).contribute({ value: pe("1") });
      await vault.connect(userA).contribute({ value: pe("1") });
      expect(await vault.contributions(userA.address)).to.equal(pe("2"));

      // Third should fail (would exceed 2 ETH max)
      await expect(
        vault.connect(userA).contribute({ value: pe("0.01") })
      ).to.be.revertedWith("exceeds max");
    });

    it("rejects after endTime", async () => {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        vault.connect(userA).contribute({ value: pe("1") })
      ).to.be.revertedWith("ended");
    });

    it("rejects contribution after finalisation", async () => {
      await vault.connect(userA).contribute({ value: pe("1") });
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);
      await vault.finalise();

      // endTime has passed, so "ended" fires before "finalised"
      await expect(
        vault.connect(userB).contribute({ value: pe("1") })
      ).to.be.revertedWith("ended");
    });

    it("tracks totalETHRaised correctly across multiple users", async () => {
      await vault.connect(userA).contribute({ value: pe("1") });
      await vault.connect(userB).contribute({ value: pe("0.5") });
      await vault.connect(userC).contribute({ value: pe("2") });

      expect(await vault.totalETHRaised()).to.equal(pe("3.5"));
      expect(await vault.contributions(userA.address)).to.equal(pe("1"));
      expect(await vault.contributions(userB.address)).to.equal(pe("0.5"));
      expect(await vault.contributions(userC.address)).to.equal(pe("2"));
    });

    it("getEstimatedIFR returns correct estimate", async () => {
      await vault.connect(userA).contribute({ value: pe("1") });
      await vault.connect(userB).contribute({ value: pe("1") });

      // userA contributed 50%, so estimate = 50M IFR
      expect(await vault.getEstimatedIFR(userA.address)).to.equal(BigInt(IFR_ALLOCATION)/BigInt(2));
      expect(await vault.getEstimatedIFR(userB.address)).to.equal(BigInt(IFR_ALLOCATION)/BigInt(2));
      // non-contributor
      expect(await vault.getEstimatedIFR(userC.address)).to.equal(0);
    });
  });

  // ── Finalisation ────────────────────────────────────────────

  describe("Finalisation", () => {
    beforeEach(async () => {
      await vault.connect(userA).contribute({ value: pe("1") });
    });

    it("reverts before endTime", async () => {
      await expect(vault.finalise()).to.be.revertedWith("bootstrap active");
    });

    it("succeeds after endTime (permissionless)", async () => {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      // Anyone can call finalise — using userB (not owner)
      await expect(vault.connect(userB).finalise()).to.not.revert(ethers);
      expect(await vault.finalised()).to.equal(true);
    });

    it("reverts if called twice", async () => {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      await vault.finalise();
      await expect(vault.finalise()).to.be.revertedWith("already finalised");
    });

    it("reverts if vault has insufficient IFR balance", async () => {
      // Deploy a new vault WITHOUT funding it
      const block = await ethers.provider.getBlock("latest");
      const st = block.timestamp + 10;

      const BootstrapVaultV3 = await ethers.getContractFactory("BootstrapVaultV3");
      const unfundedVault = await BootstrapVaultV3.deploy(
        ifrToken.target, router.target, locker.target,
        st, DURATION, IFR_ALLOCATION, MIN_CONTRIBUTION, MAX_CONTRIBUTION, LP_LOCK_DURATION
      );
      await unfundedVault.waitForDeployment();

      // Advance to start, contribute, advance to end
      await ethers.provider.send("evm_setNextBlockTimestamp", [st]);
      await ethers.provider.send("evm_mine", []);
      await unfundedVault.connect(userA).contribute({ value: pe("1") });
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(unfundedVault.finalise())
        .to.be.revertedWith("BootstrapVault: insufficient IFR balance");
    });

    it("creates Uniswap V2 LP", async () => {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      await vault.finalise();

      // LP token address should be set
      const lpAddr = await vault.lpTokenAddress();
      expect(lpAddr).to.not.equal(ethers.ZeroAddress);

      // Router should have received ifrAllocation IFR
      expect(await ifrToken.balanceOf(router.target)).to.equal(IFR_ALLOCATION);

      // Router should have received all ETH
      expect(await ethers.provider.getBalance(router.target)).to.equal(pe("1"));
    });

    it("locks LP via Team.Finance", async () => {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      await vault.finalise();

      const lockId = await vault.lpLockId();
      expect(lockId).to.equal(1); // First lock

      // LP tokens should be in the locker, not the vault
      const lpAddr = await vault.lpTokenAddress();
      const lpTokenContract = await ethers.getContractAt("MockLPToken", lpAddr);
      expect(await lpTokenContract.balanceOf(locker.target)).to.equal(pe("1"));
      expect(await lpTokenContract.balanceOf(vault.target)).to.equal(0);
    });

    it("emits Finalised event with correct params", async () => {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      const lpAddr = await router.lpToken();
      const expectedIfrPerETH = BigInt(BigInt(IFR_ALLOCATION)*BigInt(pe('1')))/BigInt(pe('1')); // 100M * 1e18 / 1e18

      await expect(vault.finalise())
        .to.emit(vault, "Finalised")
        .withArgs(pe("1"), expectedIfrPerETH, lpAddr, 1);
    });
  });

  // ── Claim ────────────────────────────────────────────

  describe("Claim", () => {
    beforeEach(async () => {
      await vault.connect(userA).contribute({ value: pe("1") });
      await vault.connect(userB).contribute({ value: pe("1") });
    });

    it("reverts before finalisation", async () => {
      await expect(vault.connect(userA).claim()).to.be.revertedWith("not finalised");
    });

    it("returns correct IFR proportional to contribution", async () => {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);
      await vault.finalise();

      const balBefore = await ifrToken.balanceOf(userA.address);
      await vault.connect(userA).claim();
      const balAfter = await ifrToken.balanceOf(userA.address);

      // userA contributed 50%, gets 50M IFR
      expect(BigInt(balAfter)-BigInt(balBefore)).to.equal(BigInt(IFR_ALLOCATION)/BigInt(2));
    });

    it("reverts if called twice (already claimed)", async () => {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);
      await vault.finalise();

      await vault.connect(userA).claim();
      await expect(vault.connect(userA).claim()).to.be.revertedWith("already claimed");
    });

    it("reverts for non-contributors", async () => {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);
      await vault.finalise();

      await expect(vault.connect(userC).claim()).to.be.revertedWith("no contribution");
    });
  });

  // ── Refund ────────────────────────────────────────────

  describe("Refund", () => {
    it("refunds ETH after grace period expires", async () => {
      await vault.connect(userA).contribute({ value: pe("1") });

      // Time travel: endTime + 30 days + 1 second
      await ethers.provider.send("evm_increaseTime", [DURATION + REFUND_GRACE_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      const balBefore = await ethers.provider.getBalance(userA.address);
      const tx = await vault.connect(userA).refund();
      const receipt = await tx.wait();
      const gasUsed = BigInt(receipt.gasUsed)*BigInt(receipt.gasPrice);
      const balAfter = await ethers.provider.getBalance(userA.address);

      // ETH balance increased by 1 ETH minus gas
      expect(BigInt(BigInt(balAfter)-BigInt(balBefore))+BigInt(gasUsed)).to.equal(pe("1"));

      // Contribution zeroed out
      expect(await vault.contributions(userA.address)).to.equal(0);

      // Event emitted
      await expect(tx)
        .to.emit(vault, "Refunded")
        .withArgs(userA.address, pe("1"));
    });

    it("reverts before grace period expires", async () => {
      await vault.connect(userA).contribute({ value: pe("1") });

      // Time travel: endTime + 29 days (still within grace period)
      await ethers.provider.send("evm_increaseTime", [DURATION + 29 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        vault.connect(userA).refund()
      ).to.be.revertedWith("grace period active");
    });

    it("reverts after finalise() was called", async () => {
      await vault.connect(userA).contribute({ value: pe("1") });

      // Finalise after endTime
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);
      await vault.finalise();

      // Time travel past grace period
      await ethers.provider.send("evm_increaseTime", [REFUND_GRACE_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        vault.connect(userA).refund()
      ).to.be.revertedWith("already finalised");
    });

    it("refund reduces totalETHRaised", async () => {
      await vault.connect(userA).contribute({ value: pe("1") });
      await vault.connect(userB).contribute({ value: pe("0.5") });
      await vault.connect(userC).contribute({ value: pe("0.5") });

      expect(await vault.totalETHRaised()).to.equal(pe("2"));

      // Time travel past grace period
      await ethers.provider.send("evm_increaseTime", [DURATION + REFUND_GRACE_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      // Charlie refunds
      await vault.connect(userC).refund();

      // totalETHRaised must be reduced
      expect(await vault.totalETHRaised()).to.equal(pe("1.5"));
    });

    it("sets hasRefundOccurred on refund", async () => {
      await vault.connect(userA).contribute({ value: pe("1") });

      expect(await vault.hasRefundOccurred()).to.equal(false);

      await ethers.provider.send("evm_increaseTime", [DURATION + REFUND_GRACE_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      await vault.connect(userA).refund();
      expect(await vault.hasRefundOccurred()).to.equal(true);
    });

    it("finalise reverts after refund occurred", async () => {
      await vault.connect(userA).contribute({ value: pe("1") });
      await vault.connect(userB).contribute({ value: pe("1") });

      // Time travel past grace period
      await ethers.provider.send("evm_increaseTime", [DURATION + REFUND_GRACE_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      // userB refunds
      await vault.connect(userB).refund();

      // finalise must now revert
      await expect(vault.finalise()).to.be.revertedWith("refund occurred");
    });

    it("reverts on double refund", async () => {
      await vault.connect(userA).contribute({ value: pe("1") });

      // Time travel past grace period
      await ethers.provider.send("evm_increaseTime", [DURATION + REFUND_GRACE_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      // First refund succeeds
      await vault.connect(userA).refund();

      // Second refund reverts
      await expect(
        vault.connect(userA).refund()
      ).to.be.revertedWith("no contribution");
    });
  });

  // ── Edge Cases ────────────────────────────────────────────

  describe("Edge Cases", () => {
    it("finalise() with 0 contributions", async () => {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(vault.finalise())
        .to.emit(vault, "Finalised")
        .withArgs(0, 0, ethers.ZeroAddress, 0);

      expect(await vault.finalised()).to.equal(true);
      expect(await vault.lpTokenAddress()).to.equal(ethers.ZeroAddress);
    });

    it("single contributor gets 100% IFR", async () => {
      await vault.connect(userA).contribute({ value: pe("1") });

      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);
      await vault.finalise();

      const balBefore = await ifrToken.balanceOf(userA.address);
      await vault.connect(userA).claim();
      const balAfter = await ifrToken.balanceOf(userA.address);

      // Single contributor gets 100% of ifrAllocation
      expect(BigInt(balAfter)-BigInt(balBefore)).to.equal(IFR_ALLOCATION);
    });
  });
});
