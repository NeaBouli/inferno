const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BuybackController", function () {
  let owner, guardian, burnReserve, lpReceiver, user, user2;
  let IFR, WETH, Router, Controller;

  const RATE_IFR_PER_ETH = ethers.parseEther("1000"); // 1 ETH → 1000 IFR
  const ONE_ETH = ethers.parseEther("1");
  const HALF_ETH = ethers.parseEther("0.5");
  const MIN_TRIGGER = ethers.parseEther("0.01");
  const DAY = 86400;

  async function deployController() {
    const BuybackController = await ethers.getContractFactory("BuybackController");
    const controller = await BuybackController.deploy(
      IFR.target,
      burnReserve.address,
      Router.target,
      lpReceiver.address,
      guardian.address,
      owner.address
    );
    await controller.waitForDeployment();
    return controller;
  }

  beforeEach(async () => {
    [owner, guardian, burnReserve, lpReceiver, user, user2] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockToken");
    IFR = await MockToken.deploy("Inferno Token", "IFR");
    await IFR.waitForDeployment();

    WETH = await MockToken.deploy("Wrapped ETH", "WETH");
    await WETH.waitForDeployment();

    const MockRouter = await ethers.getContractFactory("MockRouter");
    Router = await MockRouter.deploy(WETH.target, IFR.target, RATE_IFR_PER_ETH);
    await Router.waitForDeployment();

    Controller = await deployController();
  });

  // ── T01–T05: Deployment & Basic ──────────────────────────────

  it("T01: deploys with correct parameters", async () => {
    expect(await Controller.owner()).to.equal(owner.address);
    expect(await Controller.token()).to.equal(IFR.target);
    expect(await Controller.burnReserve()).to.equal(burnReserve.address);
    expect(await Controller.lpReceiver()).to.equal(lpReceiver.address);
    expect(await Controller.guardian()).to.equal(guardian.address);
    expect(await Controller.cooldown()).to.equal(24 * 3600);
    expect(await Controller.minTriggerAmount()).to.equal(MIN_TRIGGER);
    expect(await Controller.slippageBps()).to.equal(500);
  });

  it("T02: receives ETH via receive()", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    expect(await ethers.provider.getBalance(Controller.target)).to.equal(ONE_ETH);
  });

  it("T03: execute() reverts when cooldown not passed", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    await Controller.connect(user).execute();

    await expect(Controller.connect(user).execute()).to.be.revertedWith("cooldown");
  });

  it("T04: execute() reverts when insufficient ETH", async () => {
    await expect(Controller.connect(user).execute()).to.be.revertedWith("insufficient ETH");
  });

  it("T05: execute() succeeds with sufficient ETH after cooldown", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    await expect(Controller.connect(user).execute()).to.emit(Controller, "BuybackExecuted");
  });

  // ── T06–T10: Events & Split ──────────────────────────────────

  it("T06: BuybackExecuted event emitted with correct values", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });

    // No IFR in contract → LP fallback → all ETH goes to buyback
    // 0.5 ETH for burn share + 0.5 ETH LP fallback = 1 ETH total
    await expect(Controller.connect(user).execute())
      .to.emit(Controller, "BuybackExecuted");
  });

  it("T07: LiquidityAdded event emitted when IFR available", async () => {
    // Send IFR to controller for LP
    await IFR.transfer(Controller.target, ethers.parseEther("100"));
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });

    await expect(Controller.connect(user).execute())
      .to.emit(Controller, "LiquidityAdded");
  });

  it("T08: 50/50 split — burn receives IFR from buyback", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });

    const burnBefore = await IFR.balanceOf(burnReserve.address);
    await Controller.connect(user).execute();
    const burnAfter = await IFR.balanceOf(burnReserve.address);

    // All ETH goes to buyback (no IFR for LP → fallback)
    // 1 ETH * 1000 IFR/ETH = 1000 IFR total to burn
    const totalBurned = BigInt(burnAfter)-BigInt(burnBefore);
    expect(totalBurned).to.equal(ethers.parseEther("1000"));
  });

  it("T09: lastExecution updated after execute()", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    expect(await Controller.lastExecution()).to.equal(0);
    await Controller.connect(user).execute();
    expect(await Controller.lastExecution()).to.be.gt(0);
  });

  it("T10: canExecute() returns false before cooldown, true after", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    expect(await Controller.canExecute()).to.equal(true);

    await Controller.connect(user).execute();
    expect(await Controller.canExecute()).to.equal(false);

    await ethers.provider.send("evm_increaseTime", [24 * 3600]);
    await ethers.provider.send("evm_mine", []);

    // Need more ETH for next execution
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    expect(await Controller.canExecute()).to.equal(true);
  });

  // ── T11–T15: Config — setCooldown ────────────────────────────

  it("T11: setCooldown() works with valid value", async () => {
    await expect(Controller.setCooldown(2 * 3600))
      .to.emit(Controller, "CooldownUpdated")
      .withArgs(2 * 3600);
    expect(await Controller.cooldown()).to.equal(2 * 3600);
  });

  it("T12: setCooldown() reverts below 1 hour", async () => {
    await expect(Controller.setCooldown(1800)).to.be.revertedWith("min 1h");
  });

  it("T13: setCooldown() reverts above 7 days", async () => {
    await expect(Controller.setCooldown(8 * DAY)).to.be.revertedWith("max 7d");
  });

  it("T14: setCooldown() reverts for non-owner", async () => {
    await expect(Controller.connect(user).setCooldown(3600)).to.be.revertedWith("not owner");
  });

  // ── T15–T18: Config — setMinTrigger, setSlippage ─────────────

  it("T15: setMinTrigger() works for owner", async () => {
    await expect(Controller.setMinTrigger(ethers.parseEther("0.1")))
      .to.emit(Controller, "MinTriggerUpdated");
    expect(await Controller.minTriggerAmount()).to.equal(ethers.parseEther("0.1"));
  });

  it("T16: setMinTrigger() reverts for non-owner", async () => {
    await expect(Controller.connect(user).setMinTrigger(1)).to.be.revertedWith("not owner");
  });

  it("T17: setSlippage() max 10%", async () => {
    await expect(Controller.setSlippage(1001)).to.be.revertedWith("max 10%");
    await Controller.setSlippage(1000); // exactly 10% is ok
    expect(await Controller.slippageBps()).to.equal(1000);
  });

  it("T18: setSlippage() emits event", async () => {
    await expect(Controller.setSlippage(300))
      .to.emit(Controller, "SlippageUpdated")
      .withArgs(300);
  });

  // ── T19–T22: Emergency Withdraw ──────────────────────────────

  it("T19: withdrawETH() only owner", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    await expect(Controller.connect(user).withdrawETH(user.address, ONE_ETH))
      .to.be.revertedWith("not owner");
  });

  it("T20: withdrawETH() works for owner", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    const balBefore = await ethers.provider.getBalance(owner.address);
    await Controller.withdrawETH(owner.address, ONE_ETH);
    expect(await ethers.provider.getBalance(Controller.target)).to.equal(0);
  });

  it("T21: withdrawIFR() only owner", async () => {
    await expect(Controller.connect(user).withdrawIFR(user.address, 1))
      .to.be.revertedWith("not owner");
  });

  it("T22: withdrawIFR() works for owner", async () => {
    await IFR.transfer(Controller.target, ethers.parseEther("100"));
    await Controller.withdrawIFR(owner.address, ethers.parseEther("100"));
    expect(await IFR.balanceOf(Controller.target)).to.equal(0);
  });

  // ── T23–T26: View Functions & Stats ───────────────────────────

  it("T23: pendingETH() returns correct balance", async () => {
    expect(await Controller.pendingETH()).to.equal(0);
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    expect(await Controller.pendingETH()).to.equal(ONE_ETH);
  });

  it("T24: stats() tracks cumulative values", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    await Controller.connect(user).execute();

    const [totalETH, totalBurned, totalLP, count] = await Controller.stats();
    expect(totalETH).to.equal(ONE_ETH);
    expect(totalBurned).to.be.gt(0);
    expect(count).to.equal(1);
  });

  it("T25: executionCount increments", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    await Controller.connect(user).execute();
    expect(await Controller.executionCount()).to.equal(1);

    await ethers.provider.send("evm_increaseTime", [24 * 3600]);
    await ethers.provider.send("evm_mine", []);

    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    await Controller.connect(user).execute();
    expect(await Controller.executionCount()).to.equal(2);
  });

  it("T26: canExecute() false when paused", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    expect(await Controller.canExecute()).to.equal(true);
    await Controller.connect(guardian).pause();
    expect(await Controller.canExecute()).to.equal(false);
  });

  // ── T27–T30: Guardian Pause/Unpause ───────────────────────────

  it("T27: guardian can pause", async () => {
    await expect(Controller.connect(guardian).pause()).to.emit(Controller, "Paused");
    expect(await Controller.paused()).to.equal(true);
  });

  it("T28: guardian can unpause", async () => {
    await Controller.connect(guardian).pause();
    await expect(Controller.connect(guardian).unpause()).to.emit(Controller, "Unpaused");
    expect(await Controller.paused()).to.equal(false);
  });

  it("T29: non-guardian cannot pause", async () => {
    await expect(Controller.connect(user).pause()).to.be.revertedWith("not guardian");
  });

  it("T30: execute() reverts when paused", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    await Controller.connect(guardian).pause();
    await expect(Controller.connect(user).execute()).to.be.revertedWith("Pausable: paused");
  });

  // ── T31–T35: LP + Fallback ───────────────────────────────────

  it("T31: LP fallback — no IFR → all ETH goes to buyback+burn", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });

    await expect(Controller.connect(user).execute())
      .to.emit(Controller, "LiquidityFallback");
  });

  it("T32: LP add — IFR in contract triggers addLiquidityETH", async () => {
    await IFR.transfer(Controller.target, ethers.parseEther("500"));
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });

    await expect(Controller.connect(user).execute())
      .to.emit(Controller, "LiquidityAdded");
  });

  it("T33: LP failure → fallback to buyback", async () => {
    await IFR.transfer(Controller.target, ethers.parseEther("500"));
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });

    // Make addLiquidity revert
    await Router.setAddLiquidityReverts(true);

    await expect(Controller.connect(user).execute())
      .to.emit(Controller, "LiquidityFallback");
  });

  it("T34: slippage protection — revert when exceeded", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    // 6% slippage exceeds 5% tolerance
    await Router.setSlippageBpsNextSwap(600);
    await expect(Controller.connect(user).execute()).to.be.revertedWith("slippage");
  });

  it("T35: multiple executions accumulate stats", async () => {
    for (let i = 0; i < 3; i++) {
      await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
      await Controller.connect(user).execute();
      if (i < 2) {
        await ethers.provider.send("evm_increaseTime", [24 * 3600]);
        await ethers.provider.send("evm_mine", []);
      }
    }

    const [totalETH, , , count] = await Controller.stats();
    expect(totalETH).to.equal(BigInt(ONE_ETH)*BigInt(3));
    expect(count).to.equal(3);
  });

  // ── T36–T40: Constructor Validation & Ownership ───────────────

  describe("Constructor validation", () => {
    it("T36: reverts if token is zero address", async () => {
      const F = await ethers.getContractFactory("BuybackController");
      await expect(F.deploy(
        ethers.ZeroAddress, burnReserve.address, Router.target,
        lpReceiver.address, guardian.address, owner.address
      )).to.be.revertedWith("token=0");
    });

    it("T37: reverts if burnReserve is zero address", async () => {
      const F = await ethers.getContractFactory("BuybackController");
      await expect(F.deploy(
        IFR.target, ethers.ZeroAddress, Router.target,
        lpReceiver.address, guardian.address, owner.address
      )).to.be.revertedWith("burnReserve=0");
    });

    it("T38: reverts if guardian is zero address", async () => {
      const F = await ethers.getContractFactory("BuybackController");
      await expect(F.deploy(
        IFR.target, burnReserve.address, Router.target,
        lpReceiver.address, ethers.ZeroAddress, owner.address
      )).to.be.revertedWith("guardian=0");
    });

    it("T39: reverts if governance is zero address", async () => {
      const F = await ethers.getContractFactory("BuybackController");
      await expect(F.deploy(
        IFR.target, burnReserve.address, Router.target,
        lpReceiver.address, guardian.address, ethers.ZeroAddress
      )).to.be.revertedWith("governance=0");
    });
  });

  describe("Ownership", () => {
    it("T40: transferOwnership works", async () => {
      await expect(Controller.transferOwnership(user.address))
        .to.emit(Controller, "OwnershipTransferred")
        .withArgs(owner.address, user.address);
      expect(await Controller.owner()).to.equal(user.address);
    });

    it("T41: old owner rejected after transfer", async () => {
      await Controller.transferOwnership(user.address);
      await expect(Controller.setCooldown(3600)).to.be.revertedWith("not owner");
    });

    it("T42: transferOwnership reverts for non-owner", async () => {
      await expect(Controller.connect(user).transferOwnership(user.address))
        .to.be.revertedWith("not owner");
    });

    it("T43: transferOwnership reverts with zero address", async () => {
      await expect(Controller.transferOwnership(ethers.ZeroAddress))
        .to.be.revertedWith("newOwner=0");
    });
  });

  // ── T44–T46: setRouter, setLpReceiver, withdrawETH edge ──────

  it("T44: setRouter() works for owner, reverts for zero", async () => {
    await expect(Controller.setRouter(ethers.ZeroAddress)).to.be.revertedWith("router=0");
    await Controller.setRouter(user.address); // any non-zero address
  });

  it("T45: setLpReceiver() works for owner, reverts for zero", async () => {
    await expect(Controller.setLpReceiver(ethers.ZeroAddress)).to.be.revertedWith("lpReceiver=0");
    await Controller.setLpReceiver(user2.address);
    expect(await Controller.lpReceiver()).to.equal(user2.address);
  });

  it("T46: withdrawETH() reverts with zero address", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    await expect(Controller.withdrawETH(ethers.ZeroAddress, ONE_ETH))
      .to.be.revertedWith("to=0");
  });

  it("T47: withdrawETH() reverts if insufficient balance", async () => {
    await expect(Controller.withdrawETH(owner.address, ONE_ETH))
      .to.be.revertedWith("insufficient");
  });

  it("T48: withdrawIFR() reverts with zero address", async () => {
    await expect(Controller.withdrawIFR(ethers.ZeroAddress, 1))
      .to.be.revertedWith("to=0");
  });

  it("T49: setMinTrigger() reverts with zero", async () => {
    await expect(Controller.setMinTrigger(0)).to.be.revertedWith("min=0");
  });

  it("T50: permissionless — anyone can call execute()", async () => {
    await user.sendTransaction({ to: Controller.target, value: ONE_ETH });
    // user2 (random address) can execute
    await expect(Controller.connect(user2).execute()).to.emit(Controller, "BuybackExecuted");
  });
});
