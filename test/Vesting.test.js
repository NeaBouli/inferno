const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Vesting", function () {
  let deployer, beneficiary, guardian, other;
  let token, vesting;

  const DECIMALS = 9;
  const toUnits = (n) => ethers.utils.parseUnits(n.toString(), DECIMALS);

  const CLIFF = 90 * 24 * 3600;       // 90 days
  const DURATION = 365 * 24 * 3600;   // 365 days total (90d cliff + 275d linear)
  const ALLOCATION = toUnits(1_000_000); // 1M IFR

  beforeEach(async () => {
    [deployer, beneficiary, guardian, other] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockInfernoToken");
    token = await Token.deploy();
    await token.deployed();

    const Vesting = await ethers.getContractFactory("Vesting");
    vesting = await Vesting.deploy(
      token.address,
      beneficiary.address,
      CLIFF,
      DURATION,
      ALLOCATION,
      guardian.address
    );
    await vesting.deployed();

    await (await token.transfer(vesting.address, ALLOCATION)).wait();
  });

  async function increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  it("verhindert Release vor Cliff", async () => {
    await expect(vesting.connect(beneficiary).release()).to.be.reverted;
  });

  it("~0% vested at cliff end (post-cliff formula)", async () => {
    // Advance to cliff. Block timestamp may be 1s past cliff due to mining.
    await increaseTime(CLIFF);
    const vested = await vesting.vestedAmount();
    // Post-cliff: vestingElapsed is ~0-1s, so vested should be negligible
    // Max 1 second of vesting: ALLOCATION / vestingDuration ≈ 42 units
    const oneSecondVesting = ALLOCATION.div(DURATION - CLIFF);
    expect(vested).to.be.lte(oneSecondVesting.mul(2)); // allow 2s tolerance
  });

  it("releast linear nach dem Cliff", async () => {
    // Advance to cliff + 30 days
    const extraDays = 30 * 24 * 3600;
    await increaseTime(CLIFF + extraDays);

    const releasable = await vesting.releasableAmount();
    expect(releasable).to.be.gt(0);

    // Post-cliff formula: vested = (ALLOCATION * 30d) / (DURATION - CLIFF)
    const vestingDuration = DURATION - CLIFF;
    const expected = ALLOCATION.mul(extraDays).div(vestingDuration);

    // Allow 0.5% tolerance for block timestamp rounding
    const tolerance = expected.div(200);
    expect(releasable.sub(expected).abs()).to.be.lte(tolerance);

    const balBefore = await token.balanceOf(beneficiary.address);
    await expect(vesting.connect(beneficiary).release()).to.emit(vesting, "Released");
    const balAfter = await token.balanceOf(beneficiary.address);
    // Released amount may be slightly more than queried releasable (1 block later)
    expect(balAfter.sub(balBefore)).to.be.gte(releasable);
  });

  it("50% vested at midpoint of linear phase", async () => {
    const vestingDuration = DURATION - CLIFF;
    const halfVesting = vestingDuration / 2;
    await increaseTime(CLIFF + halfVesting);

    const vested = await vesting.vestedAmount();
    const expected = ALLOCATION.div(2);

    // 0.5% tolerance
    const tolerance = expected.div(200);
    expect(vested.sub(expected).abs()).to.be.lte(tolerance);
  });

  it("gibt alles am Ende frei", async () => {
    await increaseTime(DURATION + 1);
    const releasable = await vesting.releasableAmount();
    expect(releasable).to.equal(ALLOCATION);
    await expect(vesting.connect(beneficiary).release()).to.emit(vesting, "Released");
    const contractBal = await token.balanceOf(vesting.address);
    expect(contractBal).to.equal(0);
  });

  it("nur Beneficiary darf release() aufrufen", async () => {
    await increaseTime(DURATION + 1);
    await expect(vesting.connect(other).release()).to.be.reverted;
  });

  it("Guardian kann pausieren und fortsetzen", async () => {
    await increaseTime(DURATION / 2);
    await expect(vesting.connect(guardian).pause()).to.emit(vesting, "Paused");
    await expect(vesting.connect(beneficiary).release()).to.be.reverted;
    await expect(vesting.connect(guardian).unpause()).to.emit(vesting, "Unpaused");
    await expect(vesting.connect(beneficiary).release()).to.emit(vesting, "Released");
  });

  // ── Constructor Validation ──────────────────────────────────

  describe("Constructor validation", () => {
    it("reverts if token is zero address", async () => {
      const Vesting = await ethers.getContractFactory("Vesting");
      await expect(
        Vesting.deploy(ethers.constants.AddressZero, beneficiary.address, CLIFF, DURATION, ALLOCATION, guardian.address)
      ).to.be.revertedWith("token=0");
    });

    it("reverts if beneficiary is zero address", async () => {
      const Vesting = await ethers.getContractFactory("Vesting");
      await expect(
        Vesting.deploy(token.address, ethers.constants.AddressZero, CLIFF, DURATION, ALLOCATION, guardian.address)
      ).to.be.revertedWith("beneficiary=0");
    });

    it("reverts if guardian is zero address", async () => {
      const Vesting = await ethers.getContractFactory("Vesting");
      await expect(
        Vesting.deploy(token.address, beneficiary.address, CLIFF, DURATION, ALLOCATION, ethers.constants.AddressZero)
      ).to.be.revertedWith("guardian=0");
    });

    it("reverts if duration < cliff", async () => {
      const Vesting = await ethers.getContractFactory("Vesting");
      await expect(
        Vesting.deploy(token.address, beneficiary.address, DURATION, CLIFF, ALLOCATION, guardian.address)
      ).to.be.revertedWith("duration<cliff");
    });

    it("reverts if allocation is zero", async () => {
      const Vesting = await ethers.getContractFactory("Vesting");
      await expect(
        Vesting.deploy(token.address, beneficiary.address, CLIFF, DURATION, 0, guardian.address)
      ).to.be.revertedWith("allocation=0");
    });
  });

  // ── Guardian Access ─────────────────────────────────────────

  describe("Guardian access", () => {
    it("non-guardian cannot pause", async () => {
      await expect(vesting.connect(other).pause()).to.be.reverted;
    });

    it("non-guardian cannot unpause", async () => {
      await expect(vesting.connect(other).unpause()).to.be.reverted;
    });

    it("pause when already paused is no-op (no event)", async () => {
      await vesting.connect(guardian).pause();
      const tx = await vesting.connect(guardian).pause();
      const receipt = await tx.wait();
      // No Paused event emitted on second call
      expect(receipt.events?.filter(e => e.event === "Paused") || []).to.have.length(0);
    });

    it("unpause when already unpaused is no-op (no event)", async () => {
      const tx = await vesting.connect(guardian).unpause();
      const receipt = await tx.wait();
      expect(receipt.events?.filter(e => e.event === "Unpaused") || []).to.have.length(0);
    });
  });

  // ── Release Edge Cases ──────────────────────────────────────

  describe("Release edge cases", () => {
    it("release when paused reverts with IsPaused", async () => {
      await increaseTime(DURATION / 2);
      await vesting.connect(guardian).pause();
      await expect(vesting.connect(beneficiary).release()).to.be.reverted;
    });

    it("releasableAmount returns 0 when nothing vested yet", async () => {
      expect(await vesting.releasableAmount()).to.equal(0);
    });

    it("releasableAmount returns 0 after full release", async () => {
      await increaseTime(DURATION + 1);
      await vesting.connect(beneficiary).release();
      expect(await vesting.releasableAmount()).to.equal(0);
    });

    it("vestingSchedule returns correct values", async () => {
      const [s, c, d] = await vesting.vestingSchedule();
      expect(c).to.equal(CLIFF);
      expect(d).to.equal(DURATION);
      expect(s).to.be.gt(0);
    });

    it("multiple partial releases work correctly", async () => {
      // First release at cliff + 30d
      await increaseTime(CLIFF + 30 * 86400);
      await vesting.connect(beneficiary).release();
      const released1 = await vesting.released();
      expect(released1).to.be.gt(0);

      // Second release 30d later
      await increaseTime(30 * 86400);
      await vesting.connect(beneficiary).release();
      const released2 = await vesting.released();
      expect(released2).to.be.gt(released1);
    });
  });
});
