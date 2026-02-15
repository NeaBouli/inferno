const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InfernoToken", function () {
  let deployer, poolFeeReceiver, alice, bob, exempt;
  let token;

  const DECIMALS = 9;
  const toUnits = (n) => ethers.utils.parseUnits(n.toString(), DECIMALS);
  const TOTAL_SUPPLY = toUnits(1_000_000_000);

  beforeEach(async () => {
    [deployer, poolFeeReceiver, alice, bob, exempt] = await ethers.getSigners();

    const InfernoToken = await ethers.getContractFactory("InfernoToken");
    token = await InfernoToken.deploy(poolFeeReceiver.address);
    await token.deployed();
  });

  // ─── Deployment ───────────────────────────────────────────────

  describe("Deployment", () => {
    it("has correct name, symbol, decimals", async () => {
      expect(await token.name()).to.equal("Inferno");
      expect(await token.symbol()).to.equal("IFR");
      expect(await token.decimals()).to.equal(DECIMALS);
    });

    it("mints total supply to deployer", async () => {
      expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
      expect(await token.balanceOf(deployer.address)).to.equal(TOTAL_SUPPLY);
    });

    it("sets default fee rates", async () => {
      expect(await token.senderBurnBps()).to.equal(200);
      expect(await token.recipientBurnBps()).to.equal(50);
      expect(await token.poolFeeBps()).to.equal(100);
    });

    it("sets poolFeeReceiver", async () => {
      expect(await token.poolFeeReceiver()).to.equal(poolFeeReceiver.address);
    });
  });

  // ─── Fee-on-Transfer ─────────────────────────────────────────

  describe("Fee-on-Transfer", () => {
    const AMOUNT = toUnits(10_000); // 10,000 IFR

    beforeEach(async () => {
      // Give alice tokens (deployer is fee-exempt by default? No — let's make deployer exempt for setup)
      await token.setFeeExempt(deployer.address, true);
      await token.transfer(alice.address, AMOUNT);
      await token.setFeeExempt(deployer.address, false);
    });

    it("deducts correct fees on transfer (2% burn + 0.5% burn + 1% pool)", async () => {
      const amount = toUnits(1000);
      const expectedSenderBurn = amount.mul(200).div(10000);      // 20 IFR
      const expectedRecipientBurn = amount.mul(50).div(10000);    // 5 IFR
      const expectedPoolFee = amount.mul(100).div(10000);         // 10 IFR
      const expectedNet = amount.sub(expectedSenderBurn).sub(expectedRecipientBurn).sub(expectedPoolFee);

      const supplyBefore = await token.totalSupply();
      const poolBefore = await token.balanceOf(poolFeeReceiver.address);

      await token.connect(alice).transfer(bob.address, amount);

      // Recipient gets net amount
      expect(await token.balanceOf(bob.address)).to.equal(expectedNet);

      // Pool fee receiver gets pool fee
      const poolAfter = await token.balanceOf(poolFeeReceiver.address);
      expect(poolAfter.sub(poolBefore)).to.equal(expectedPoolFee);

      // Total supply decreased by burns
      const supplyAfter = await token.totalSupply();
      expect(supplyBefore.sub(supplyAfter)).to.equal(expectedSenderBurn.add(expectedRecipientBurn));

      // Sender lost exact amount
      const aliceBal = await token.balanceOf(alice.address);
      expect(aliceBal).to.equal(AMOUNT.sub(amount));
    });

    it("applies fees on transferFrom too", async () => {
      const amount = toUnits(500);
      await token.connect(alice).approve(bob.address, amount);

      const supplyBefore = await token.totalSupply();
      await token.connect(bob).transferFrom(alice.address, bob.address, amount);

      const expectedBurn = amount.mul(200 + 50).div(10000); // 2.5%
      const expectedPoolFee = amount.mul(100).div(10000);     // 1%
      const expectedNet = amount.sub(expectedBurn).sub(expectedPoolFee);

      expect(await token.balanceOf(bob.address)).to.equal(expectedNet);
      expect(supplyBefore.sub(await token.totalSupply())).to.equal(expectedBurn);
    });
  });

  // ─── Fee Exemption ────────────────────────────────────────────

  describe("Fee Exemption", () => {
    const AMOUNT = toUnits(10_000);

    beforeEach(async () => {
      await token.setFeeExempt(deployer.address, true);
      await token.transfer(alice.address, AMOUNT);
      await token.setFeeExempt(deployer.address, false);
    });

    it("no fees when sender is exempt", async () => {
      await token.setFeeExempt(alice.address, true);
      const amount = toUnits(1000);

      const supplyBefore = await token.totalSupply();
      await token.connect(alice).transfer(bob.address, amount);

      expect(await token.balanceOf(bob.address)).to.equal(amount);
      expect(await token.totalSupply()).to.equal(supplyBefore);
    });

    it("no fees when recipient is exempt", async () => {
      await token.setFeeExempt(bob.address, true);
      const amount = toUnits(1000);

      const supplyBefore = await token.totalSupply();
      await token.connect(alice).transfer(bob.address, amount);

      expect(await token.balanceOf(bob.address)).to.equal(amount);
      expect(await token.totalSupply()).to.equal(supplyBefore);
    });

    it("fees apply when neither sender nor recipient is exempt", async () => {
      const amount = toUnits(1000);
      await token.connect(alice).transfer(bob.address, amount);

      // Bob should receive less than amount
      expect(await token.balanceOf(bob.address)).to.be.lt(amount);
    });
  });

  // ─── Owner Functions ──────────────────────────────────────────

  describe("Owner Functions", () => {
    it("setFeeExempt emits FeeExemptUpdated", async () => {
      await expect(token.setFeeExempt(alice.address, true))
        .to.emit(token, "FeeExemptUpdated")
        .withArgs(alice.address, true);

      expect(await token.feeExempt(alice.address)).to.equal(true);
    });

    it("setFeeExempt reverts for non-owner", async () => {
      await expect(
        token.connect(alice).setFeeExempt(alice.address, true)
      ).to.be.reverted;
    });

    it("setPoolFeeReceiver updates and emits", async () => {
      await expect(token.setPoolFeeReceiver(bob.address))
        .to.emit(token, "PoolFeeReceiverUpdated")
        .withArgs(bob.address);

      expect(await token.poolFeeReceiver()).to.equal(bob.address);
    });

    it("setPoolFeeReceiver reverts for address(0)", async () => {
      await expect(
        token.setPoolFeeReceiver(ethers.constants.AddressZero)
      ).to.be.revertedWith("poolFeeReceiver=0");
    });

    it("setPoolFeeReceiver reverts for non-owner", async () => {
      await expect(
        token.connect(alice).setPoolFeeReceiver(bob.address)
      ).to.be.reverted;
    });

    it("setFeeRates updates and emits FeesUpdated", async () => {
      await expect(token.setFeeRates(100, 100, 50))
        .to.emit(token, "FeesUpdated")
        .withArgs(100, 100, 50);

      expect(await token.senderBurnBps()).to.equal(100);
      expect(await token.recipientBurnBps()).to.equal(100);
      expect(await token.poolFeeBps()).to.equal(50);
    });

    it("setFeeRates reverts if total > 5%", async () => {
      await expect(
        token.setFeeRates(300, 100, 200) // 600 bps = 6%
      ).to.be.revertedWith("fees>5%");
    });

    it("setFeeRates allows exactly 5%", async () => {
      await expect(token.setFeeRates(200, 100, 200)).to.not.be.reverted; // 500 bps = 5%
    });

    it("setFeeRates reverts for non-owner", async () => {
      await expect(
        token.connect(alice).setFeeRates(100, 100, 50)
      ).to.be.reverted;
    });
  });

  // ─── Mint / Burn bypass fees ──────────────────────────────────

  describe("Mint and Burn bypass fees", () => {
    it("minting does not apply fees", async () => {
      // Constructor already minted, totalSupply should equal TOTAL_SUPPLY exactly
      expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
      expect(await token.balanceOf(deployer.address)).to.equal(TOTAL_SUPPLY);
    });
  });

  // ─── Fee math edge cases ──────────────────────────────────────

  describe("Fee math edge cases", () => {
    it("transfer of 1 unit (smallest amount)", async () => {
      await token.setFeeExempt(deployer.address, true);
      await token.transfer(alice.address, toUnits(100));
      await token.setFeeExempt(deployer.address, false);

      // Transfer 1 raw unit — fees round to 0
      await expect(token.connect(alice).transfer(bob.address, 1)).to.not.be.reverted;
    });

    it("zero fee rates means no fees deducted", async () => {
      await token.setFeeRates(0, 0, 0);

      await token.transfer(alice.address, toUnits(1000));
      const amount = toUnits(500);

      const supplyBefore = await token.totalSupply();
      await token.connect(alice).transfer(bob.address, amount);

      expect(await token.balanceOf(bob.address)).to.equal(amount);
      expect(await token.totalSupply()).to.equal(supplyBefore);
    });

    it("updated fee rates apply to subsequent transfers", async () => {
      await token.setFeeExempt(deployer.address, true);
      await token.transfer(alice.address, toUnits(10_000));
      await token.setFeeExempt(deployer.address, false);

      // Double the burn rates
      await token.setFeeRates(400, 100, 0); // 4% + 1% + 0% = 5%

      const amount = toUnits(1000);
      const expectedBurn = amount.mul(500).div(10000); // 5% total burn
      const expectedNet = amount.sub(expectedBurn);

      await token.connect(alice).transfer(bob.address, amount);
      expect(await token.balanceOf(bob.address)).to.equal(expectedNet);
    });
  });
});
