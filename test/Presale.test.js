const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Presale", function () {
  let deployer, buyer1, buyer2, treasury;
  let token, presale;

  const DECIMALS = 9;
  const toUnits = (n) => ethers.utils.parseUnits(n.toString(), DECIMALS);

  // TOKEN_PRICE = 0.0001 ETH per 1 IFR  →  1 ETH = 10,000 IFR
  const TOKEN_PRICE = ethers.utils.parseUnits("0.0001", "ether"); // 1e14 wei

  const HARD_CAP = ethers.utils.parseEther("100");       // 100 ETH
  const PER_WALLET_CAP = ethers.utils.parseEther("10");  // 10 ETH per wallet

  // Presale allocation: 100M IFR (enough for 100 ETH * 10,000 IFR/ETH = 1M IFR, but give more)
  const PRESALE_ALLOCATION = toUnits(100_000_000);

  let startTime, endTime;

  beforeEach(async () => {
    [deployer, buyer1, buyer2, treasury] = await ethers.getSigners();

    // Deploy InfernoToken
    const InfernoToken = await ethers.getContractFactory("InfernoToken");
    token = await InfernoToken.deploy(treasury.address);
    await token.deployed();

    // Get current block timestamp for presale window
    const block = await ethers.provider.getBlock("latest");
    startTime = block.timestamp + 10;    // starts in 10 seconds
    endTime = block.timestamp + 86400;   // ends in 24 hours

    // Deploy Presale
    const Presale = await ethers.getContractFactory("Presale");
    presale = await Presale.deploy(
      token.address,
      TOKEN_PRICE,
      HARD_CAP,
      PER_WALLET_CAP,
      startTime,
      endTime
    );
    await presale.deployed();

    // Make presale fee-exempt so token transfers don't lose fees
    await token.setFeeExempt(presale.address, true);

    // Also make deployer exempt for the setup transfer
    await token.setFeeExempt(deployer.address, true);
    await token.transfer(presale.address, PRESALE_ALLOCATION);
    await token.setFeeExempt(deployer.address, false);

    // Advance time to presale start
    await ethers.provider.send("evm_increaseTime", [11]);
    await ethers.provider.send("evm_mine", []);
  });

  // ─── Deployment ───────────────────────────────────────────────

  describe("Deployment", () => {
    it("sets all constructor params correctly", async () => {
      expect(await presale.token()).to.equal(token.address);
      expect(await presale.TOKEN_PRICE()).to.equal(TOKEN_PRICE);
      expect(await presale.TOKEN_DECIMALS()).to.equal(DECIMALS);
      expect(await presale.hardCap()).to.equal(HARD_CAP);
      expect(await presale.perWalletCap()).to.equal(PER_WALLET_CAP);
      expect(await presale.startTime()).to.equal(startTime);
      expect(await presale.endTime()).to.equal(endTime);
    });

    it("presale is active", async () => {
      expect(await presale.isActive()).to.equal(true);
    });

    it("presale holds allocated tokens", async () => {
      expect(await token.balanceOf(presale.address)).to.equal(PRESALE_ALLOCATION);
    });
  });

  // ─── TOKEN_PRICE Calculation ──────────────────────────────────

  describe("TOKEN_PRICE with 9 decimals", () => {
    it("1 ETH buys exactly 10,000 IFR", async () => {
      const ethAmount = ethers.utils.parseEther("1");
      const expectedTokens = toUnits(10_000);

      const tokensOut = await presale.getTokenAmount(ethAmount);
      expect(tokensOut).to.equal(expectedTokens);
    });

    it("0.5 ETH buys 5,000 IFR", async () => {
      const ethAmount = ethers.utils.parseEther("0.5");
      expect(await presale.getTokenAmount(ethAmount)).to.equal(toUnits(5_000));
    });

    it("0.0001 ETH buys exactly 1 IFR", async () => {
      const ethAmount = ethers.utils.parseEther("0.0001");
      expect(await presale.getTokenAmount(ethAmount)).to.equal(toUnits(1));
    });

    it("10 ETH buys 100,000 IFR", async () => {
      const ethAmount = ethers.utils.parseEther("10");
      expect(await presale.getTokenAmount(ethAmount)).to.equal(toUnits(100_000));
    });
  });

  // ─── Buying Tokens ────────────────────────────────────────────

  describe("buyTokens()", () => {
    it("buys tokens and emits TokensPurchased", async () => {
      const ethAmount = ethers.utils.parseEther("1");
      const expectedTokens = toUnits(10_000);

      await expect(presale.connect(buyer1).buyTokens({ value: ethAmount }))
        .to.emit(presale, "TokensPurchased")
        .withArgs(buyer1.address, ethAmount, expectedTokens);

      expect(await token.balanceOf(buyer1.address)).to.equal(expectedTokens);
      expect(await presale.totalRaised()).to.equal(ethAmount);
      expect(await presale.contributions(buyer1.address)).to.equal(ethAmount);
    });

    it("multiple purchases accumulate correctly", async () => {
      await presale.connect(buyer1).buyTokens({ value: ethers.utils.parseEther("2") });
      await presale.connect(buyer1).buyTokens({ value: ethers.utils.parseEther("3") });

      expect(await presale.contributions(buyer1.address)).to.equal(ethers.utils.parseEther("5"));
      expect(await token.balanceOf(buyer1.address)).to.equal(toUnits(50_000));
      expect(await presale.totalRaised()).to.equal(ethers.utils.parseEther("5"));
    });

    it("tokens received are fee-free (presale is exempt)", async () => {
      const ethAmount = ethers.utils.parseEther("1");
      const expectedTokens = toUnits(10_000);

      await presale.connect(buyer1).buyTokens({ value: ethAmount });
      // Buyer should receive exact amount, no fee deduction
      expect(await token.balanceOf(buyer1.address)).to.equal(expectedTokens);
    });
  });

  // ─── Guards & Limits ──────────────────────────────────────────

  describe("Guards", () => {
    it("reverts if presale not started", async () => {
      // Deploy a new presale that starts in the future
      const block = await ethers.provider.getBlock("latest");
      const Presale = await ethers.getContractFactory("Presale");
      const futurePresale = await Presale.deploy(
        token.address, TOKEN_PRICE, HARD_CAP, PER_WALLET_CAP,
        block.timestamp + 9999, block.timestamp + 99999
      );
      await futurePresale.deployed();

      await expect(
        futurePresale.connect(buyer1).buyTokens({ value: ethers.utils.parseEther("1") })
      ).to.be.reverted;
    });

    it("reverts if presale ended", async () => {
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        presale.connect(buyer1).buyTokens({ value: ethers.utils.parseEther("1") })
      ).to.be.reverted;
    });

    it("reverts on zero ETH", async () => {
      await expect(
        presale.connect(buyer1).buyTokens({ value: 0 })
      ).to.be.reverted;
    });

    it("reverts if per-wallet cap exceeded", async () => {
      await presale.connect(buyer1).buyTokens({ value: ethers.utils.parseEther("9") });

      await expect(
        presale.connect(buyer1).buyTokens({ value: ethers.utils.parseEther("2") })
      ).to.be.reverted;
    });

    it("allows purchase up to exact wallet cap", async () => {
      await expect(
        presale.connect(buyer1).buyTokens({ value: PER_WALLET_CAP })
      ).to.not.be.reverted;
    });

    it("reverts if hard cap exceeded", async () => {
      // Deploy presale with small hard cap
      const block = await ethers.provider.getBlock("latest");
      const Presale = await ethers.getContractFactory("Presale");
      const smallPresale = await Presale.deploy(
        token.address, TOKEN_PRICE,
        ethers.utils.parseEther("2"),   // 2 ETH hard cap
        ethers.utils.parseEther("10"),  // 10 ETH wallet cap
        block.timestamp, block.timestamp + 86400
      );
      await smallPresale.deployed();

      await token.setFeeExempt(smallPresale.address, true);
      await token.setFeeExempt(deployer.address, true);
      await token.transfer(smallPresale.address, PRESALE_ALLOCATION);
      await token.setFeeExempt(deployer.address, false);

      await smallPresale.connect(buyer1).buyTokens({ value: ethers.utils.parseEther("2") });

      await expect(
        smallPresale.connect(buyer2).buyTokens({ value: ethers.utils.parseEther("1") })
      ).to.be.reverted;
    });

    it("reverts if finalized", async () => {
      await presale.finalize();

      await expect(
        presale.connect(buyer1).buyTokens({ value: ethers.utils.parseEther("1") })
      ).to.be.reverted;
    });
  });

  // ─── Finalize & Withdraw ──────────────────────────────────────

  describe("Finalize & Withdraw", () => {
    it("owner can finalize, emits Finalized", async () => {
      await presale.connect(buyer1).buyTokens({ value: ethers.utils.parseEther("5") });

      await expect(presale.finalize())
        .to.emit(presale, "Finalized")
        .withArgs(ethers.utils.parseEther("5"));

      expect(await presale.finalized()).to.equal(true);
      expect(await presale.isActive()).to.equal(false);
    });

    it("cannot finalize twice", async () => {
      await presale.finalize();
      await expect(presale.finalize())
        .to.be.reverted;
    });

    it("non-owner cannot finalize", async () => {
      await expect(presale.connect(buyer1).finalize()).to.be.reverted;
    });

    it("withdrawETH sends raised ETH after finalize", async () => {
      await presale.connect(buyer1).buyTokens({ value: ethers.utils.parseEther("5") });
      await presale.finalize();

      const balBefore = await ethers.provider.getBalance(treasury.address);

      await expect(presale.withdrawETH(treasury.address))
        .to.emit(presale, "ETHWithdrawn")
        .withArgs(treasury.address, ethers.utils.parseEther("5"));

      const balAfter = await ethers.provider.getBalance(treasury.address);
      expect(balAfter.sub(balBefore)).to.equal(ethers.utils.parseEther("5"));
    });

    it("withdrawETH reverts before finalize", async () => {
      await presale.connect(buyer1).buyTokens({ value: ethers.utils.parseEther("1") });

      await expect(presale.withdrawETH(treasury.address))
        .to.be.reverted;
    });

    it("withdrawUnsoldTokens returns remaining tokens", async () => {
      await presale.connect(buyer1).buyTokens({ value: ethers.utils.parseEther("1") });
      // Sold: 10,000 IFR. Remaining: 100M - 10,000 = 99,990,000 IFR
      await presale.finalize();

      const expectedRemaining = PRESALE_ALLOCATION.sub(toUnits(10_000));

      await expect(presale.withdrawUnsoldTokens(treasury.address))
        .to.emit(presale, "UnsoldTokensWithdrawn");

      // Treasury should receive tokens (may have fee deduction since treasury might not be exempt)
      // But presale IS exempt as sender, so no fees apply
      const treasBal = await token.balanceOf(treasury.address);
      expect(treasBal).to.be.gte(expectedRemaining);
    });

    it("withdrawUnsoldTokens reverts before finalize", async () => {
      await expect(presale.withdrawUnsoldTokens(treasury.address))
        .to.be.reverted;
    });
  });
});
