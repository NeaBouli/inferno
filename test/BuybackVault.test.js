const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BuybackVault", function () {
  let owner, treasury, burnReserve, guardian, user;
  let IFR, WETH, Router, Vault;

  const RATE_IFR_PER_ETH = ethers.utils.parseEther("1000"); // 1 ETH -> 1000 IFR

  beforeEach(async () => {
    [owner, treasury, burnReserve, guardian, user] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockToken");
    IFR = await MockToken.deploy("Inferno Token", "IFR");
    await IFR.waitForDeployment();

    // Mock WETH as plain ERC20 (nur als Address-Marker)
    WETH = await MockToken.deploy("Wrapped ETH", "WETH");
    await WETH.waitForDeployment();

    const MockRouter = await ethers.getContractFactory("MockRouter");
    Router = await MockRouter.deploy(await WETH.getAddress(), await IFR.getAddress(), RATE_IFR_PER_ETH);
    await Router.waitForDeployment();

    const BuybackVault = await ethers.getContractFactory("BuybackVault");
    Vault = await BuybackVault.deploy(
      await IFR.getAddress(),
      await burnReserve.getAddress(),
      await treasury.getAddress(),
      await Router.getAddress(),
      await guardian.getAddress()
    );
    await Vault.waitForDeployment();
  });

  it("deposits ETH and emits Deposited", async () => {
    await expect(Vault.connect(user).depositETH({ value: ethers.utils.parseEther("2") }))
      .to.emit(Vault, "Deposited")
      .withArgs(await user.getAddress(), ethers.utils.parseEther("2"));

    const bal = await ethers.provider.getBalance(await Vault.getAddress());
    expect(bal).to.equal(ethers.utils.parseEther("2"));
  });

  it("executes buyback with default params; splits 50/50 to burnReserve and treasury", async () => {
    await Vault.connect(user).depositETH({ value: ethers.utils.parseEther("1") });

    const burnBefore = await IFR.balanceOf(await burnReserve.getAddress());
    const treasBefore = await IFR.balanceOf(await treasury.getAddress());

    await expect(Vault.connect(owner).executeBuyback())
      .to.emit(Vault, "BuybackExecuted");

    const burnAfter = await IFR.balanceOf(await burnReserve.getAddress());
    const treasAfter = await IFR.balanceOf(await treasury.getAddress());

    const totalOut = ethers.utils.parseEther("1000"); // gemäß RATE_IFR_PER_ETH
    const expectedBurn = totalOut.div(2);
    const expectedTreas = totalOut.sub(expectedBurn);

    expect(burnAfter.sub(burnBefore)).to.equal(expectedBurn);
    expect(treasAfter.sub(treasBefore)).to.equal(expectedTreas);

    const lastBuybackAt = await Vault.lastBuybackAt();
    expect(lastBuybackAt).to.be.gt(0);
  });

  it("enforces cooldown between buybacks", async () => {
    await Vault.depositETH({ value: ethers.utils.parseEther("1") });
    await Vault.connect(owner).executeBuyback();

    await expect(Vault.connect(owner).executeBuyback()).to.be.revertedWith("cooldown");

    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);

    await expect(Vault.connect(owner).executeBuyback()).to.emit(Vault, "BuybackExecuted");
  });

  it("respects slippage protection via router rate change", async () => {
    await Vault.depositETH({ value: ethers.utils.parseEther("1") });

    // Rate senken -> erwartetes Out fällt unter minOut (5% Slippage), daher revert
    await Router.setRate(ethers.utils.parseEther("900"));
    await expect(Vault.connect(owner).executeBuyback()).to.be.revertedWith("slippage");
  });

  it("guardian can pause/unpause to block actions", async () => {
    await Vault.depositETH({ value: ethers.utils.parseEther("1") });

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
      Vault.connect(owner).setParams(newBps, newCooldown, newSlip, await Router.getAddress(), await treasury.getAddress())
    ).to.emit(Vault, "ParamsUpdated");

    expect(await Vault.burnShareBps()).to.equal(newBps);
    expect(await Vault.cooldown()).to.equal(newCooldown);
    expect(await Vault.slippageBps()).to.equal(newSlip);
  });
});
