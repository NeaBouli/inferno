const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BootstrapVaultV2", function () {
  let owner, userA, userB, userC;
  let ifrToken, weth, router, locker, vault;
  let startTime;

  const DURATION = 90 * 24 * 60 * 60; // 90 days
  const IFR_ALLOCATION = ethers.utils.parseEther("100000000"); // 100M IFR
  const MIN_CONTRIBUTION = ethers.utils.parseEther("0.01");
  const MAX_CONTRIBUTION = ethers.utils.parseEther("2");
  const LP_LOCK_DURATION = 365 * 24 * 60 * 60; // 12 months

  const pe = (s) => ethers.utils.parseEther(s);

  beforeEach(async () => {
    [owner, userA, userB, userC] = await ethers.getSigners();

    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockToken");
    ifrToken = await MockToken.deploy("Inferno Token", "IFR");
    await ifrToken.deployed();

    weth = await MockToken.deploy("Wrapped ETH", "WETH");
    await weth.deployed();

    // Deploy mock router (also acts as factory)
    const MockBootstrapRouter = await ethers.getContractFactory("MockBootstrapRouter");
    router = await MockBootstrapRouter.deploy(weth.address);
    await router.deployed();

    // Deploy mock Team.Finance locker
    const MockTeamFinanceLocker = await ethers.getContractFactory("MockTeamFinanceLocker");
    locker = await MockTeamFinanceLocker.deploy();
    await locker.deployed();

    // Deploy BootstrapVaultV2 (no ifrSource param)
    const block = await ethers.provider.getBlock("latest");
    startTime = block.timestamp + 10;

    const BootstrapVaultV2 = await ethers.getContractFactory("BootstrapVaultV2");
    vault = await BootstrapVaultV2.deploy(
      ifrToken.address,
      router.address,
      locker.address,
      startTime,
      DURATION,
      IFR_ALLOCATION,
      MIN_CONTRIBUTION,
      MAX_CONTRIBUTION,
      LP_LOCK_DURATION
    );
    await vault.deployed();

    // Fund vault directly with 2x allocation (simulates LiqRes.withdraw)
    await ifrToken.mint(vault.address, IFR_ALLOCATION.mul(2));

    // Advance to startTime
    await ethers.provider.send("evm_setNextBlockTimestamp", [startTime]);
    await ethers.provider.send("evm_mine", []);
  });

  // ── Deployment ────────────────────────────────────────────

  describe("Deployment", () => {
    it("sets all immutable parameters correctly", async () => {
      expect(await vault.ifrToken()).to.equal(ifrToken.address);
      expect(await vault.uniswapRouter()).to.equal(router.address);
      expect(await vault.teamFinanceLocker()).to.equal(locker.address);
      expect(await vault.startTime()).to.equal(startTime);
      expect(await vault.endTime()).to.equal(startTime + DURATION);
      expect(await vault.ifrAllocation()).to.equal(IFR_ALLOCATION);
      expect(await vault.minContribution()).to.equal(MIN_CONTRIBUTION);
      expect(await vault.maxContribution()).to.equal(MAX_CONTRIBUTION);
      expect(await vault.lpLockDuration()).to.equal(LP_LOCK_DURATION);
      expect(await vault.totalETHRaised()).to.equal(0);
      expect(await vault.finalised()).to.equal(false);
    });

    it("reverts with zero address or invalid parameters", async () => {
      const BootstrapVaultV2 = await ethers.getContractFactory("BootstrapVaultV2");
      const args = [ifrToken.address, router.address, locker.address,
        startTime, DURATION, IFR_ALLOCATION, MIN_CONTRIBUTION, MAX_CONTRIBUTION, LP_LOCK_DURATION];

      // ifrToken=0
      await expect(BootstrapVaultV2.deploy(
        ethers.constants.AddressZero, args[1], args[2], args[3], args[4], args[5], args[6], args[7], args[8]
      )).to.be.revertedWith("ifrToken=0");

      // router=0
      await expect(BootstrapVaultV2.deploy(
        args[0], ethers.constants.AddressZero, args[2], args[3], args[4], args[5], args[6], args[7], args[8]
      )).to.be.revertedWith("router=0");

      // max < min
      await expect(BootstrapVaultV2.deploy(
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
      expect(await vault.getEstimatedIFR(userA.address)).to.equal(IFR_ALLOCATION.div(2));
      expect(await vault.getEstimatedIFR(userB.address)).to.equal(IFR_ALLOCATION.div(2));
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
      await expect(vault.connect(userB).finalise()).to.not.be.reverted;
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

      const BootstrapVaultV2 = await ethers.getContractFactory("BootstrapVaultV2");
      const unfundedVault = await BootstrapVaultV2.deploy(
        ifrToken.address, router.address, locker.address,
        st, DURATION, IFR_ALLOCATION, MIN_CONTRIBUTION, MAX_CONTRIBUTION, LP_LOCK_DURATION
      );
      await unfundedVault.deployed();

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
      expect(lpAddr).to.not.equal(ethers.constants.AddressZero);

      // Router should have received ifrAllocation IFR
      expect(await ifrToken.balanceOf(router.address)).to.equal(IFR_ALLOCATION);

      // Router should have received all ETH
      expect(await ethers.provider.getBalance(router.address)).to.equal(pe("1"));
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
      expect(await lpTokenContract.balanceOf(locker.address)).to.equal(pe("1"));
      expect(await lpTokenContract.balanceOf(vault.address)).to.equal(0);
    });

    it("emits Finalised event with correct params", async () => {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      const lpAddr = await router.lpToken();
      const expectedIfrPerETH = IFR_ALLOCATION.mul(pe("1")).div(pe("1")); // 100M * 1e18 / 1e18

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
      expect(balAfter.sub(balBefore)).to.equal(IFR_ALLOCATION.div(2));
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

  // ── Edge Cases ────────────────────────────────────────────

  describe("Edge Cases", () => {
    it("finalise() with 0 contributions", async () => {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(vault.finalise())
        .to.emit(vault, "Finalised")
        .withArgs(0, 0, ethers.constants.AddressZero, 0);

      expect(await vault.finalised()).to.equal(true);
      expect(await vault.lpTokenAddress()).to.equal(ethers.constants.AddressZero);
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
      expect(balAfter.sub(balBefore)).to.equal(IFR_ALLOCATION);
    });
  });
});
