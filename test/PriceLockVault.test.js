import { expect } from "chai";
import { ethers } from "./helpers/hardhat.js";

describe("PriceLockVault", function () {
  const DAY = 86400;
  const WEEK = 7 * DAY;
  const parse = (s) => ethers.parseUnits(s, 9);
  const eth = (s) => ethers.parseEther(s);
  // 18,000,000 IFR against 60 WETH: 3,333.33 gwei per IFR; shallow pool: 0.3 WETH (16.67 gwei per IFR)
  const IFR_RESERVE = parse("18000000");
  const DEEP_WETH = eth("60");
  const SHALLOW_WETH = eth("0.3");
  const priceOf = (ifr, weth) => (weth * 10n ** 9n) / ifr;

  let governance, alice, bob, ifr, weth, pair, vault;

  async function advance(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }
  const now = async () => (await ethers.provider.getBlock("latest")).timestamp;

  async function deploy({ ifrToken, ifrFirst = true, minWethReserve = eth("50"), minPrice = 0n, window = WEEK } = {}) {
    const Pair = await ethers.getContractFactory("MockTwapPair");
    const p = ifrFirst ? await Pair.deploy(ifrToken.target, weth.target) : await Pair.deploy(weth.target, ifrToken.target);
    const Vault = await ethers.getContractFactory("PriceLockVault");
    const v = await Vault.deploy(ifrToken.target, p.target, governance.address, window, minWethReserve, minPrice);
    return { p, v };
  }

  // Set reserves in IFR/WETH terms whatever the token order.
  async function setPool(p, ifrIsToken0, ifrAmount, wethAmount) {
    if (ifrIsToken0) await p.setReserves(ifrAmount, wethAmount);
    else await p.setReserves(wethAmount, ifrAmount);
  }

  // Deep pool with a full TWAP window of history, then activate.
  async function makeActive(p, v, ifrIsToken0 = true, wethAmount = DEEP_WETH) {
    await setPool(p, ifrIsToken0, IFR_RESERVE, wethAmount);
    await v.poke();
    await advance(WEEK);
    await v.connect(governance).activate();
  }

  beforeEach(async () => {
    [, governance, alice, bob] = await ethers.getSigners();
    const MockIFR = await ethers.getContractFactory("MockInfernoToken");
    ifr = await MockIFR.deploy();
    const MockToken = await ethers.getContractFactory("MockToken");
    weth = await MockToken.deploy("Wrapped Ether", "WETH");
    ({ p: pair, v: vault } = await deploy({ ifrToken: ifr }));
    await ifr.transfer(alice.address, parse("1000000"));
    await ifr.transfer(bob.address, parse("1000000"));
    await ifr.connect(alice).approve(vault.target, ethers.MaxUint256);
    await ifr.connect(bob).approve(vault.target, ethers.MaxUint256);
  });

  describe("deployment", () => {
    it("sets owner, token order and thresholds", async () => {
      expect(await vault.owner()).to.equal(governance.address);
      expect(await vault.ifrIsToken0()).to.equal(true);
      expect(await vault.active()).to.equal(false);
      expect(await vault.minWethReserve()).to.equal(eth("50"));
      expect(await vault.twapWindow()).to.equal(WEEK);
    });

    it("rejects a pair without IFR, out-of-range windows and missing thresholds", async () => {
      const Vault = await ethers.getContractFactory("PriceLockVault");
      const MockToken = await ethers.getContractFactory("MockToken");
      const other = await MockToken.deploy("Other", "OTH");
      const Pair = await ethers.getContractFactory("MockTwapPair");
      const foreign = await Pair.deploy(other.target, weth.target);
      await expect(Vault.deploy(ifr.target, foreign.target, governance.address, WEEK, eth("50"), 0)).to.be.revertedWith("pair lacks IFR");
      await expect(Vault.deploy(ifr.target, pair.target, governance.address, DAY - 1, eth("50"), 0)).to.be.revertedWith("window out of range");
      await expect(Vault.deploy(ifr.target, pair.target, governance.address, 31 * DAY, eth("50"), 0)).to.be.revertedWith("window out of range");
      await expect(Vault.deploy(ifr.target, pair.target, governance.address, WEEK, 0, 0)).to.be.revertedWith("no threshold");
      await expect(Vault.deploy(ifr.target, pair.target, governance.address, WEEK, eth("100001"), 0)).to.be.revertedWith("reserve threshold too high");
    });
  });

  describe("readiness gate", () => {
    it("rejects price locks while inactive", async () => {
      const t = await now();
      await expect(vault.connect(alice).lock(parse("1000"), 1n, 0, t + 30 * DAY)).to.be.revertedWith("price locks not active");
    });

    it("activate is owner-only and fails below the reserve scope", async () => {
      await setPool(pair, true, IFR_RESERVE, SHALLOW_WETH);
      await vault.poke();
      await advance(WEEK);
      await expect(vault.connect(alice).activate()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await expect(vault.connect(governance).activate()).to.be.revertedWith("readiness scope not met");
      const r = await vault.readiness();
      expect(r.wethReserve).to.equal(SHALLOW_WETH);
      expect(r.requiredWethReserve).to.equal(eth("50"));
      expect(r.ready).to.equal(false);
    });

    it("fails without a full TWAP window of history, then succeeds above the scope", async () => {
      await setPool(pair, true, IFR_RESERVE, DEEP_WETH);
      await expect(vault.connect(governance).activate()).to.be.revertedWith("readiness scope not met");
      await vault.poke(); // the reverted activate() did not keep its observation
      await advance(WEEK);
      await expect(vault.connect(governance).activate()).to.emit(vault, "Activated");
      expect(await vault.active()).to.equal(true);
      await expect(vault.connect(governance).activate()).to.be.revertedWith("already active");
    });

    it("a depth spike only at activation time does not pass (observation reserve must also meet the scope)", async () => {
      await setPool(pair, true, IFR_RESERVE, SHALLOW_WETH);
      await vault.poke();
      await advance(WEEK);
      await setPool(pair, true, IFR_RESERVE, DEEP_WETH); // e.g. flash-added liquidity
      await expect(vault.connect(governance).activate()).to.be.revertedWith("readiness scope not met");
    });

    it("price threshold: fails below and succeeds at or above the TWAP", async () => {
      const deepPrice = priceOf(IFR_RESERVE, DEEP_WETH);
      await vault.connect(governance).setThresholds(0, deepPrice * 2n);
      await setPool(pair, true, IFR_RESERVE, DEEP_WETH);
      await vault.poke();
      await advance(WEEK);
      await expect(vault.connect(governance).activate()).to.be.revertedWith("readiness scope not met");
      await vault.connect(governance).setThresholds(0, deepPrice / 2n);
      await vault.connect(governance).activate();
      expect(await vault.active()).to.equal(true);
    });

    it("thresholds and window are owner-only and bounded", async () => {
      await expect(vault.connect(alice).setThresholds(1, 0)).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await expect(vault.connect(governance).setThresholds(0, 0)).to.be.revertedWith("no threshold");
      await expect(vault.connect(governance).setThresholds(eth("100001"), 0)).to.be.revertedWith("reserve threshold too high");
      await expect(vault.connect(governance).setTwapWindow(12 * 3600)).to.be.revertedWith("window out of range");
      await vault.connect(governance).setTwapWindow(2 * DAY);
      expect(await vault.twapWindow()).to.equal(2 * DAY);
    });
  });

  describe("TWAP", () => {
    it("matches the sustained pool price for both token orders", async () => {
      for (const ifrFirst of [true, false]) {
        const { p, v } = await deploy({ ifrToken: ifr, ifrFirst });
        expect(await v.ifrIsToken0()).to.equal(ifrFirst);
        await setPool(p, ifrFirst, IFR_RESERVE, DEEP_WETH);
        await v.poke();
        await advance(WEEK);
        const [valid, price] = await v.twap();
        expect(valid).to.equal(true);
        const expected = priceOf(IFR_RESERVE, DEEP_WETH);
        expect(price).to.be.closeTo(expected, expected / 100000n);
      }
    });

    it("is invalid with zero reserves and when observations are stale", async () => {
      await vault.poke();
      await advance(WEEK);
      expect((await vault.twap()).valid).to.equal(false); // zero reserves
      await setPool(pair, true, IFR_RESERVE, DEEP_WETH);
      await vault.poke();
      await advance(2 * WEEK + DAY); // only observation older than 2 * window
      const view = await vault.twap();
      expect(view.valid).to.equal(false);
      expect(view.priceWei).to.equal(0n);
    });

    it("poke respects the minimum spacing", async () => {
      await setPool(pair, true, IFR_RESERVE, DEEP_WETH);
      await vault.poke();
      const count = await vault.observationCount();
      await vault.poke();
      expect(await vault.observationCount()).to.equal(count);
      await advance(WEEK / 16);
      await vault.poke();
      expect(await vault.observationCount()).to.equal(count + 1n);
    });
  });

  describe("locks", () => {
    beforeEach(async () => {
      await makeActive(pair, vault);
    });

    it("validates lock parameters", async () => {
      const t = await now();
      await expect(vault.connect(alice).lock(0, 1n, 0, t + 30 * DAY)).to.be.revertedWith("amount=0");
      await expect(vault.connect(alice).lock(parse("1"), 0, 0, t + 30 * DAY)).to.be.revertedWith("target=0");
      await expect(vault.connect(alice).lock(parse("1"), 1n, 0, t + 3600)).to.be.revertedWith("maxUnlockTime out of range");
      await expect(vault.connect(alice).lock(parse("1"), 1n, 0, t + 1462 * DAY)).to.be.revertedWith("maxUnlockTime out of range");
      await expect(vault.connect(alice).lock(parse("1"), 1n, t + 40 * DAY, t + 30 * DAY)).to.be.revertedWith("earliestTime after maxUnlockTime");
    });

    it("unlocks when the TWAP reaches the target, respecting earliestTime", async () => {
      const price = priceOf(IFR_RESERVE, DEEP_WETH);
      const t = await now();
      await vault.connect(alice).lock(parse("1000"), price / 2n, t + 10 * DAY, t + 365 * DAY);
      await expect(vault.connect(alice).unlock(0)).to.be.revertedWith("earliest time not reached");
      await advance(10 * DAY);
      const before = await ifr.balanceOf(alice.address);
      await expect(vault.connect(alice).unlock(0)).to.emit(vault, "Unlocked").withArgs(alice.address, 0, parse("1000"), false);
      expect((await ifr.balanceOf(alice.address)) - before).to.equal(parse("1000"));
      expect(await vault.totalLocked()).to.equal(0n);
      await expect(vault.connect(alice).unlock(0)).to.be.revertedWith("already unlocked");
    });

    it("rejects unlock below the target", async () => {
      const price = priceOf(IFR_RESERVE, DEEP_WETH);
      const t = await now();
      await vault.connect(alice).lock(parse("1000"), price * 3n, 0, t + 365 * DAY);
      expect(await vault.canUnlock(alice.address, 0)).to.equal(false);
      await expect(vault.connect(alice).unlock(0)).to.be.revertedWith("price target not met");
    });

    it("a price spike inside one block cannot trigger an unlock", async () => {
      const price = priceOf(IFR_RESERVE, DEEP_WETH);
      const t = await now();
      await vault.connect(alice).lock(parse("1000"), price * 2n, 0, t + 365 * DAY);
      await ethers.provider.send("evm_setAutomine", [false]);
      try {
        const spike = await pair.setReserves(IFR_RESERVE / 1000n, DEEP_WETH * 1000n, { gasLimit: 200_000 });
        const attempt = await vault.connect(alice).unlock(0, { gasLimit: 500_000 });
        const revert = await pair.setReserves(IFR_RESERVE, DEEP_WETH, { gasLimit: 200_000 });
        await ethers.provider.send("evm_mine", []);
        expect((await ethers.provider.getTransactionReceipt(spike.hash)).status).to.equal(1);
        expect((await ethers.provider.getTransactionReceipt(attempt.hash)).status).to.equal(0);
        expect((await ethers.provider.getTransactionReceipt(revert.hash)).status).to.equal(1);
      } finally {
        await ethers.provider.send("evm_setAutomine", [true]);
      }
      expect((await vault.getLock(alice.address, 0)).unlocked).to.equal(false);
    });

    it("a sustained price rise over the window does unlock", async () => {
      const price = priceOf(IFR_RESERVE, DEEP_WETH);
      const t = await now();
      await vault.connect(alice).lock(parse("1000"), price * 2n, 0, t + 365 * DAY);
      await setPool(pair, true, IFR_RESERVE, DEEP_WETH * 4n);
      for (let i = 0; i < 16; i++) {
        await advance(WEEK / 16);
        await vault.poke();
      }
      await advance(WEEK);
      expect(await vault.canUnlock(alice.address, 0)).to.equal(true);
      await vault.connect(alice).unlock(0);
    });

    it("rescue: after maxUnlockTime the locker can always unlock, even inactive and without a TWAP", async () => {
      const price = priceOf(IFR_RESERVE, DEEP_WETH);
      const t = await now();
      await vault.connect(alice).lock(parse("5000"), price * 1000n, 0, t + 30 * DAY);
      await vault.connect(governance).deactivate();
      await pair.setReserves(0, 0); // pool drained: no valid TWAP
      await expect(vault.connect(alice).unlock(0)).to.be.revertedWith("no valid TWAP");
      await advance(30 * DAY);
      await expect(vault.connect(alice).unlock(0)).to.emit(vault, "Unlocked").withArgs(alice.address, 0, parse("5000"), true);
    });

    it("only the locker can unlock its own lock; tokens never go elsewhere", async () => {
      const t = await now();
      await vault.connect(alice).lock(parse("1000"), 1n, 0, t + 30 * DAY);
      await expect(vault.connect(bob).unlock(0)).to.be.revertedWith("invalid lockId");
      await advance(30 * DAY);
      const bobBefore = await ifr.balanceOf(bob.address);
      await vault.connect(alice).unlock(0);
      expect(await ifr.balanceOf(bob.address)).to.equal(bobBefore);
    });

    it("deactivate stops new locks but never affects existing ones", async () => {
      const price = priceOf(IFR_RESERVE, DEEP_WETH);
      const t = await now();
      await vault.connect(alice).lock(parse("1000"), price / 2n, 0, t + 365 * DAY);
      await expect(vault.connect(alice).deactivate()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await vault.connect(governance).deactivate();
      await expect(vault.connect(bob).lock(parse("1"), 1n, 0, t + 365 * DAY)).to.be.revertedWith("price locks not active");
      await vault.connect(alice).unlock(0);
      expect((await vault.getLock(alice.address, 0)).unlocked).to.equal(true);
    });

    it("caps locks per wallet", async () => {
      const t = await now();
      for (let i = 0; i < 50; i++) await vault.connect(alice).lock(parse("1"), 1n, 0, t + 30 * DAY);
      await expect(vault.connect(alice).lock(parse("1"), 1n, 0, t + 30 * DAY)).to.be.revertedWith("too many locks");
      expect(await vault.getLockCount(alice.address)).to.equal(50n);
    });
  });

  it("blocks reentrancy from a hooked token", async () => {
    const Ren = await ethers.getContractFactory("MockReentrantToken");
    const ren = await Ren.deploy();
    const { p, v } = await deploy({ ifrToken: ren });
    await makeActive(p, v);
    await ren.transfer(alice.address, parse("1000"));
    await ren.connect(alice).approve(v.target, ethers.MaxUint256);
    await ren.arm(v.target, v.interface.encodeFunctionData("unlock", [0]));
    const t = await now();
    await expect(v.connect(alice).lock(parse("10"), 1n, 0, t + 30 * DAY)).to.be.revertedWithCustomError(v, "ReentrancyGuardReentrantCall");
  });

  it("credits the received amount for a fee-on-transfer token (vault not yet fee-exempt)", async () => {
    const [owner] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("InfernoToken");
    const tax = await Token.deploy(owner.address);
    await tax.setFeeExempt(owner.address, true);
    const { p, v } = await deploy({ ifrToken: tax });
    await makeActive(p, v);
    await tax.transfer(alice.address, parse("10000"));
    await tax.connect(alice).approve(v.target, ethers.MaxUint256);
    const t = await now();
    await v.connect(alice).lock(parse("1000"), 1n, 0, t + 30 * DAY);
    const credited = (await v.getLock(alice.address, 0)).amount;
    expect(credited).to.equal(parse("965")); // 3.5% transfer tax on the way in
    expect(await v.totalLocked()).to.equal(await tax.balanceOf(v.target));
    await advance(30 * DAY);
    await v.connect(alice).unlock(0);
    expect(await tax.balanceOf(v.target)).to.equal(0n);
    expect(await v.totalLocked()).to.equal(0n);
  });
});
