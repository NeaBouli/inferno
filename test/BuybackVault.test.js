import { expect } from "chai";
import { ethers } from "./helpers/hardhat.js";

describe("BuybackVault", function () {
  let owner, treasury, burnReserve, guardian, user;
  let IFR, WETH, Router, Vault;

  const RATE_IFR_PER_ETH = ethers.parseEther("1000"); // 1 ETH -> 1000 IFR
  const ACTIVATION_DELAY = 0; // 0 for most tests (immediate)

  async function deployVault(activationDelay) {
    const BuybackVault = await ethers.getContractFactory("BuybackVault");
    const vault = await BuybackVault.deploy(
      IFR.target,
      burnReserve.address,
      treasury.address,
      Router.target,
      guardian.address,
      activationDelay
    );
    await vault.waitForDeployment();
    return vault;
  }

  beforeEach(async () => {
    [owner, treasury, burnReserve, guardian, user] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockToken");
    IFR = await MockToken.deploy("Inferno Token", "IFR");
    await IFR.waitForDeployment();

    // Mock WETH as plain ERC20 (nur als Address-Marker)
    WETH = await MockToken.deploy("Wrapped ETH", "WETH");
    await WETH.waitForDeployment();

    const MockRouter = await ethers.getContractFactory("MockRouter");
    Router = await MockRouter.deploy(WETH.target, IFR.target, RATE_IFR_PER_ETH);
    await Router.waitForDeployment();

    Vault = await deployVault(ACTIVATION_DELAY);
  });

  it("deposits ETH and emits Deposited", async () => {
    await expect(Vault.connect(user).depositETH({ value: ethers.parseEther("2") }))
      .to.emit(Vault, "Deposited")
      .withArgs(user.address, ethers.parseEther("2"));

    const bal = await ethers.provider.getBalance(Vault.target);
    expect(bal).to.equal(ethers.parseEther("2"));
  });

  it("executes buyback with default params; splits 50/50 to burnReserve and treasury", async () => {
    await Vault.connect(user).depositETH({ value: ethers.parseEther("1") });

    const burnBefore = await IFR.balanceOf(burnReserve.address);
    const treasBefore = await IFR.balanceOf(treasury.address);

    await expect(Vault.connect(owner).executeBuyback())
      .to.emit(Vault, "BuybackExecuted");

    const burnAfter = await IFR.balanceOf(burnReserve.address);
    const treasAfter = await IFR.balanceOf(treasury.address);

    const totalOut = ethers.parseEther("1000"); // gemäß RATE_IFR_PER_ETH
    const expectedBurn = BigInt(totalOut)/BigInt(2);
    const expectedTreas = BigInt(totalOut)-BigInt(expectedBurn);

    expect(BigInt(burnAfter)-BigInt(burnBefore)).to.equal(expectedBurn);
    expect(BigInt(treasAfter)-BigInt(treasBefore)).to.equal(expectedTreas);

    const lastBuybackAt = await Vault.lastBuybackAt();
    expect(lastBuybackAt).to.be.gt(0);
  });

  it("enforces cooldown between buybacks", async () => {
    await Vault.depositETH({ value: ethers.parseEther("1") });
    await Vault.connect(owner).executeBuyback();

    await expect(Vault.connect(owner).executeBuyback()).to.be.revertedWith("cooldown");

    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);

    await expect(Vault.connect(owner).executeBuyback()).to.emit(Vault, "BuybackExecuted");
  });

  it("respects slippage protection when swap output deviates from quote", async () => {
    await Vault.depositETH({ value: ethers.parseEther("1") });

    // Künstliche Slippage 6% — übersteigt die 5% Toleranz, daher revert
    await Router.setSlippageBpsNextSwap(600);
    await expect(Vault.connect(owner).executeBuyback()).to.be.revertedWith("slippage");
  });

  it("guardian can pause/unpause to block actions", async () => {
    await Vault.depositETH({ value: ethers.parseEther("1") });

    await expect(Vault.connect(guardian).pause()).to.emit(Vault, "Paused");
    await expect(Vault.connect(owner).executeBuyback()).to.be.revertedWith("Pausable: paused");
    await expect(Vault.connect(guardian).unpause()).to.emit(Vault, "Unpaused");

    await expect(Vault.connect(owner).executeBuyback()).to.emit(Vault, "BuybackExecuted");
  });

  it("owner can update params and router/treasury; emits ParamsUpdated", async () => {
    const newBps = 7000;       // 70% burn
    const newCooldown = 7200;  // 2h
    const newSlip = 400;       // 4%

    await expect(
      Vault.connect(owner).setParams(newBps, newCooldown, newSlip, Router.target, treasury.address)
    ).to.emit(Vault, "ParamsUpdated");

    expect(await Vault.burnShareBps()).to.equal(newBps);
    expect(await Vault.cooldown()).to.equal(newCooldown);
    expect(await Vault.slippageBps()).to.equal(newSlip);
  });

  // ── Branch Coverage Tests ──────────────────────────────────

  describe("Constructor validation", () => {
    it("reverts if burnReserve is zero address", async () => {
      const BuybackVault = await ethers.getContractFactory("BuybackVault");
      await expect(
        BuybackVault.deploy(IFR.target, ethers.ZeroAddress, treasury.address, Router.target, guardian.address, 0)
      ).to.be.revertedWith("burnReserve=0");
    });

    it("reverts if treasury is zero address", async () => {
      const BuybackVault = await ethers.getContractFactory("BuybackVault");
      await expect(
        BuybackVault.deploy(IFR.target, burnReserve.address, ethers.ZeroAddress, Router.target, guardian.address, 0)
      ).to.be.revertedWith("treasury=0");
    });

    it("reverts if guardian is zero address", async () => {
      const BuybackVault = await ethers.getContractFactory("BuybackVault");
      await expect(
        BuybackVault.deploy(IFR.target, burnReserve.address, treasury.address, Router.target, ethers.ZeroAddress, 0)
      ).to.be.revertedWith("guardian=0");
    });
  });

  describe("Access control", () => {
    it("non-owner cannot call executeBuyback", async () => {
      await expect(Vault.connect(user).executeBuyback()).to.be.revertedWith("not owner");
    });

    it("non-owner cannot call setParams", async () => {
      await expect(
        Vault.connect(user).setParams(5000, 3600, 500, Router.target, treasury.address)
      ).to.be.revertedWith("not owner");
    });

    it("non-guardian cannot pause", async () => {
      await expect(Vault.connect(user).pause()).to.be.revertedWith("not guardian");
    });

    it("non-guardian cannot unpause", async () => {
      await expect(Vault.connect(user).unpause()).to.be.revertedWith("not guardian");
    });
  });

  describe("Edge cases", () => {
    it("depositETH reverts with zero ETH", async () => {
      await expect(Vault.connect(user).depositETH({ value: 0 })).to.be.revertedWith("no ETH");
    });

    it("executeBuyback with zero balance emits event with zero amounts", async () => {
      await expect(Vault.connect(owner).executeBuyback())
        .to.emit(Vault, "BuybackExecuted")
        .withArgs(0, 0, 0);
    });

    it("can receive ETH directly via receive()", async () => {
      await owner.sendTransaction({ to: Vault.target, value: ethers.parseEther("1") });
      expect(await ethers.provider.getBalance(Vault.target)).to.equal(ethers.parseEther("1"));
    });

    it("setParams reverts if treasury is zero", async () => {
      await expect(
        Vault.connect(owner).setParams(5000, 3600, 500, Router.target, ethers.ZeroAddress)
      ).to.be.revertedWith("treasury=0");
    });
  });

  describe("Activation delay (60 days)", () => {
    const SIXTY_DAYS = 60 * 86400;

    it("reverts executeBuyback before activation time", async () => {
      const delayedVault = await deployVault(SIXTY_DAYS);
      await delayedVault.connect(user).depositETH({ value: ethers.parseEther("1") });

      await expect(
        delayedVault.connect(owner).executeBuyback()
      ).to.be.revertedWith("not active yet");
    });

    it("allows executeBuyback after activation time", async () => {
      const delayedVault = await deployVault(SIXTY_DAYS);
      await delayedVault.connect(user).depositETH({ value: ethers.parseEther("1") });

      await ethers.provider.send("evm_increaseTime", [SIXTY_DAYS]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        delayedVault.connect(owner).executeBuyback()
      ).to.emit(delayedVault, "BuybackExecuted");
    });

    it("stores activationTime correctly", async () => {
      const delayedVault = await deployVault(SIXTY_DAYS);
      const activationTime = await delayedVault.activationTime();
      expect(activationTime).to.be.gt(0);
    });
  });

  describe("transferOwnership", function () {
    it("owner can transfer ownership", async () => {
      await Vault.transferOwnership(user.address);
      expect(await Vault.owner()).to.equal(user.address);
    });

    it("emits OwnershipTransferred event", async () => {
      await expect(Vault.transferOwnership(user.address))
        .to.emit(Vault, "OwnershipTransferred")
        .withArgs(owner.address, user.address);
    });

    it("new owner can call onlyOwner functions", async () => {
      await Vault.transferOwnership(user.address);
      await expect(
        Vault.connect(user).setParams(5000, 3600, 500, Router.target, treasury.address)
      ).to.emit(Vault, "ParamsUpdated");
    });

    it("old owner is rejected after transfer", async () => {
      await Vault.transferOwnership(user.address);
      await expect(
        Vault.setParams(5000, 3600, 500, Router.target, treasury.address)
      ).to.be.revertedWith("not owner");
    });

    it("reverts for non-owner", async () => {
      await expect(
        Vault.connect(user).transferOwnership(user.address)
      ).to.be.revertedWith("not owner");
    });

    it("reverts with zero address", async () => {
      await expect(
        Vault.transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWith("newOwner=0");
    });
  });
});
