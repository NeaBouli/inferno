const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LendingVault", function () {
  let owner, governance, lenderA, lenderB, borrowerA, borrowerB, liquidator;
  let token, vault;

  const parse = (s) => ethers.utils.parseUnits(s, 9);
  const ONE_DAY = 86400;
  const THIRTY_DAYS = 30 * ONE_DAY;

  // 1 IFR = 0.000001 ETH → price = 1e12 wei per 1e9 IFR
  const IFR_PRICE = ethers.utils.parseUnits("1000000000000", "wei"); // 1e12

  async function advanceTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine");
  }

  beforeEach(async () => {
    [owner, governance, lenderA, lenderB, borrowerA, borrowerB, liquidator] = await ethers.getSigners();

    const InfernoToken = await ethers.getContractFactory("InfernoToken");
    token = await InfernoToken.deploy(owner.address);
    await token.deployed();

    await token.setFeeExempt(owner.address, true);

    const LendingVault = await ethers.getContractFactory("LendingVault");
    vault = await LendingVault.deploy(token.address, governance.address);
    await vault.deployed();

    await token.setFeeExempt(vault.address, true);

    // Fund lenders and borrowers
    await token.transfer(lenderA.address, parse("500000"));
    await token.transfer(lenderB.address, parse("300000"));
    await token.transfer(borrowerA.address, parse("100000"));
    await token.transfer(borrowerB.address, parse("100000"));

    // Make all test accounts fee-exempt for clean math
    await token.setFeeExempt(lenderA.address, true);
    await token.setFeeExempt(lenderB.address, true);
    await token.setFeeExempt(borrowerA.address, true);
    await token.setFeeExempt(borrowerB.address, true);

    // Set IFR price via governance
    await vault.connect(governance).setIFRPrice(IFR_PRICE);
  });

  // ── T01–T05: Deployment ─────────────────────────────────────

  describe("Deployment", () => {
    it("T01: sets ifrToken correctly", async () => {
      expect(await vault.ifrToken()).to.equal(token.address);
    });

    it("T02: sets owner to governance", async () => {
      expect(await vault.owner()).to.equal(governance.address);
    });

    it("T03: constants are correct", async () => {
      expect(await vault.INITIAL_COLLATERAL_PCT()).to.equal(200);
      expect(await vault.WARNING_COLLATERAL_PCT()).to.equal(150);
      expect(await vault.LIQUIDATION_COLLATERAL_PCT()).to.equal(120);
      expect(await vault.LIQUIDATOR_BONUS_PCT()).to.equal(5);
      expect(await vault.LENDER_INTEREST_PCT()).to.equal(50);
    });

    it("T04: totals start at 0", async () => {
      expect(await vault.totalAvailable()).to.equal(0);
      expect(await vault.totalLent()).to.equal(0);
    });

    it("T05: reverts on zero token address", async () => {
      const LV = await ethers.getContractFactory("LendingVault");
      await expect(
        LV.deploy(ethers.constants.AddressZero, governance.address)
      ).to.be.revertedWith("token=0");
    });
  });

  // ── T06–T12: Lending Offers ─────────────────────────────────

  describe("Lending Offers", () => {
    it("T06: createOffer deposits IFR", async () => {
      await token.connect(lenderA).approve(vault.address, parse("100000"));
      await expect(vault.connect(lenderA).createOffer(parse("100000")))
        .to.emit(vault, "OfferCreated");

      expect(await vault.totalAvailable()).to.equal(parse("100000"));
      expect(await vault.getOfferCount()).to.equal(1);
      const offer = await vault.getOffer(0);
      expect(offer.lender).to.equal(lenderA.address);
      expect(offer.availableIFR).to.equal(parse("100000"));
      expect(offer.active).to.be.true;
    });

    it("T07: createOffer reverts on duplicate", async () => {
      await token.connect(lenderA).approve(vault.address, parse("100000"));
      await vault.connect(lenderA).createOffer(parse("100000"));
      await token.connect(lenderA).approve(vault.address, parse("50000"));
      await expect(
        vault.connect(lenderA).createOffer(parse("50000"))
      ).to.be.revertedWith("offer exists");
    });

    it("T08: increaseOffer adds to existing", async () => {
      await token.connect(lenderA).approve(vault.address, parse("200000"));
      await vault.connect(lenderA).createOffer(parse("100000"));
      await vault.connect(lenderA).increaseOffer(parse("50000"));

      const offer = await vault.getOffer(0);
      expect(offer.availableIFR).to.equal(parse("150000"));
      expect(await vault.totalAvailable()).to.equal(parse("150000"));
    });

    it("T09: withdrawOffer returns IFR to lender", async () => {
      await token.connect(lenderA).approve(vault.address, parse("100000"));
      await vault.connect(lenderA).createOffer(parse("100000"));

      const before = await token.balanceOf(lenderA.address);
      await vault.connect(lenderA).withdrawOffer(parse("40000"));
      const after = await token.balanceOf(lenderA.address);

      expect(after.sub(before)).to.equal(parse("40000"));
      expect(await vault.totalAvailable()).to.equal(parse("60000"));
    });

    it("T10: withdrawOffer deactivates when fully withdrawn and no loans", async () => {
      await token.connect(lenderA).approve(vault.address, parse("100000"));
      await vault.connect(lenderA).createOffer(parse("100000"));
      await vault.connect(lenderA).withdrawOffer(parse("100000"));

      const offer = await vault.getOffer(0);
      expect(offer.active).to.be.false;
    });

    it("T11: withdrawOffer reverts on insufficient", async () => {
      await token.connect(lenderA).approve(vault.address, parse("100000"));
      await vault.connect(lenderA).createOffer(parse("100000"));
      await expect(
        vault.connect(lenderA).withdrawOffer(parse("200000"))
      ).to.be.revertedWith("insufficient available");
    });

    it("T12: createOffer reverts on amount=0", async () => {
      await expect(
        vault.connect(lenderA).createOffer(0)
      ).to.be.revertedWith("amount=0");
    });
  });

  // ── T13–T22: Borrowing ──────────────────────────────────────

  describe("Borrowing", () => {
    beforeEach(async () => {
      await token.connect(lenderA).approve(vault.address, parse("200000"));
      await vault.connect(lenderA).createOffer(parse("200000"));
    });

    it("T13: borrow transfers IFR to borrower", async () => {
      const borrowAmount = parse("10000");
      const collateral = await vault.getRequiredCollateral(borrowAmount);

      const before = await token.balanceOf(borrowerA.address);
      await expect(vault.connect(borrowerA).borrow(0, borrowAmount, 30, { value: collateral }))
        .to.emit(vault, "LoanCreated");
      const after = await token.balanceOf(borrowerA.address);

      expect(after.sub(before)).to.equal(borrowAmount);
    });

    it("T14: borrow updates offer and totals", async () => {
      const borrowAmount = parse("10000");
      const collateral = await vault.getRequiredCollateral(borrowAmount);
      await vault.connect(borrowerA).borrow(0, borrowAmount, 30, { value: collateral });

      const offer = await vault.getOffer(0);
      expect(offer.availableIFR).to.equal(parse("190000"));
      expect(offer.lentIFR).to.equal(borrowAmount);
      expect(await vault.totalLent()).to.equal(borrowAmount);
      expect(await vault.totalAvailable()).to.equal(parse("190000"));
    });

    it("T15: borrow creates loan record", async () => {
      const borrowAmount = parse("10000");
      const collateral = await vault.getRequiredCollateral(borrowAmount);
      await vault.connect(borrowerA).borrow(0, borrowAmount, 60, { value: collateral });

      expect(await vault.getLoanCount()).to.equal(1);
      const loan = await vault.getLoan(0);
      expect(loan.borrower).to.equal(borrowerA.address);
      expect(loan.ifrAmount).to.equal(borrowAmount);
      expect(loan.ethCollateral).to.equal(collateral);
      expect(loan.active).to.be.true;
    });

    it("T16: borrow reverts on insufficient collateral", async () => {
      const borrowAmount = parse("10000");
      await expect(
        vault.connect(borrowerA).borrow(0, borrowAmount, 30, { value: 1 })
      ).to.be.revertedWith("insufficient collateral");
    });

    it("T17: borrow reverts on insufficient IFR in offer", async () => {
      const tooMuch = parse("999999");
      const collateral = await vault.getRequiredCollateral(tooMuch);
      await expect(
        vault.connect(borrowerA).borrow(0, tooMuch, 30, { value: collateral })
      ).to.be.revertedWith("insufficient IFR");
    });

    it("T18: borrow reverts on invalid duration (< 30 days)", async () => {
      const borrowAmount = parse("10000");
      const collateral = await vault.getRequiredCollateral(borrowAmount);
      await expect(
        vault.connect(borrowerA).borrow(0, borrowAmount, 10, { value: collateral })
      ).to.be.revertedWith("duration: 30-365 days");
    });

    it("T19: borrow reverts on invalid duration (> 365 days)", async () => {
      const borrowAmount = parse("10000");
      const collateral = await vault.getRequiredCollateral(borrowAmount);
      await expect(
        vault.connect(borrowerA).borrow(0, borrowAmount, 500, { value: collateral })
      ).to.be.revertedWith("duration: 30-365 days");
    });

    it("T20: borrow reverts on self-borrow", async () => {
      const borrowAmount = parse("10000");
      const collateral = await vault.getRequiredCollateral(borrowAmount);
      await expect(
        vault.connect(lenderA).borrow(0, borrowAmount, 30, { value: collateral })
      ).to.be.revertedWith("cannot self-borrow");
    });

    it("T21: collateral ratio is correct after borrow", async () => {
      const borrowAmount = parse("10000");
      const collateral = await vault.getRequiredCollateral(borrowAmount);
      await vault.connect(borrowerA).borrow(0, borrowAmount, 30, { value: collateral });

      const ratio = await vault.getCollateralRatio(0);
      expect(ratio).to.equal(200); // 200%
    });

    it("T22: multiple borrows from same offer", async () => {
      const amount = parse("10000");
      const collateral = await vault.getRequiredCollateral(amount);

      await vault.connect(borrowerA).borrow(0, amount, 30, { value: collateral });
      await vault.connect(borrowerB).borrow(0, amount, 60, { value: collateral });

      expect(await vault.getLoanCount()).to.equal(2);
      expect(await vault.totalLent()).to.equal(amount.mul(2));
    });
  });

  // ── T23–T30: Repayment ──────────────────────────────────────

  describe("Repayment", () => {
    let borrowAmount, collateral;

    beforeEach(async () => {
      await token.connect(lenderA).approve(vault.address, parse("200000"));
      await vault.connect(lenderA).createOffer(parse("200000"));

      borrowAmount = parse("10000");
      collateral = await vault.getRequiredCollateral(borrowAmount);
      await vault.connect(borrowerA).borrow(0, borrowAmount, 30, { value: collateral });
    });

    it("T23: repay returns ETH collateral to borrower", async () => {
      await advanceTime(THIRTY_DAYS);

      const interest = await vault.calculateInterest(0);
      const totalRepay = borrowAmount.add(interest);
      await token.connect(borrowerA).approve(vault.address, totalRepay);

      const beforeETH = await ethers.provider.getBalance(borrowerA.address);
      const tx = await vault.connect(borrowerA).repay(0);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const afterETH = await ethers.provider.getBalance(borrowerA.address);

      expect(afterETH.add(gasCost).sub(beforeETH)).to.equal(collateral);
    });

    it("T24: repay deactivates loan", async () => {
      await advanceTime(THIRTY_DAYS);
      const interest = await vault.calculateInterest(0);
      await token.connect(borrowerA).approve(vault.address, borrowAmount.add(interest));
      await vault.connect(borrowerA).repay(0);

      const loan = await vault.getLoan(0);
      expect(loan.active).to.be.false;
    });

    it("T25: repay restores offer availability", async () => {
      await advanceTime(THIRTY_DAYS);
      const interest = await vault.calculateInterest(0);
      await token.connect(borrowerA).approve(vault.address, borrowAmount.add(interest));
      await vault.connect(borrowerA).repay(0);

      const offer = await vault.getOffer(0);
      expect(offer.availableIFR).to.equal(parse("200000"));
      expect(offer.lentIFR).to.equal(0);
    });

    it("T26: interest calculation — 1 month at 2%", async () => {
      await advanceTime(THIRTY_DAYS);
      const interest = await vault.calculateInterest(0);
      // 10000 IFR * 200 bps / 10000 * 1 month = 200 IFR
      expect(interest).to.equal(parse("200"));
    });

    it("T27: interest calculation — 3 months at 2%", async () => {
      await advanceTime(THIRTY_DAYS * 3);
      const interest = await vault.calculateInterest(0);
      // 10000 * 200 / 10000 * 3 = 600 IFR
      expect(interest).to.equal(parse("600"));
    });

    it("T28: minimum 1 month interest even if repaid early", async () => {
      await advanceTime(ONE_DAY); // Only 1 day
      const interest = await vault.calculateInterest(0);
      expect(interest).to.equal(parse("200")); // Still 1 month minimum
    });

    it("T29: lender receives interest share on repay", async () => {
      await advanceTime(THIRTY_DAYS);
      const interest = await vault.calculateInterest(0);
      await token.connect(borrowerA).approve(vault.address, borrowAmount.add(interest));

      const beforeLender = await token.balanceOf(lenderA.address);
      await vault.connect(borrowerA).repay(0);
      const afterLender = await token.balanceOf(lenderA.address);

      // Lender gets 50% of interest = 100 IFR
      const lenderInterest = interest.div(2);
      expect(afterLender.sub(beforeLender)).to.equal(lenderInterest);
    });

    it("T30: repay reverts if not borrower", async () => {
      await advanceTime(THIRTY_DAYS);
      const interest = await vault.calculateInterest(0);
      await token.connect(lenderA).approve(vault.address, borrowAmount.add(interest));
      await expect(
        vault.connect(lenderA).repay(0)
      ).to.be.revertedWith("not borrower");
    });
  });

  // ── T31–T37: Liquidation ────────────────────────────────────

  describe("Liquidation", () => {
    let borrowAmount, collateral;

    beforeEach(async () => {
      await token.connect(lenderA).approve(vault.address, parse("200000"));
      await vault.connect(lenderA).createOffer(parse("200000"));

      borrowAmount = parse("10000");
      collateral = await vault.getRequiredCollateral(borrowAmount);
      await vault.connect(borrowerA).borrow(0, borrowAmount, 30, { value: collateral });
    });

    it("T31: cannot liquidate healthy loan (200%)", async () => {
      await expect(
        vault.connect(liquidator).liquidate(0)
      ).to.be.revertedWith("not liquidatable");
    });

    it("T32: liquidatable after price increase makes ratio < 120%", async () => {
      // Increase IFR price by 2x → collateral ratio drops to 100%
      await vault.connect(governance).setIFRPrice(IFR_PRICE.mul(2));

      const ratio = await vault.getCollateralRatio(0);
      expect(ratio).to.equal(100); // Now undercollateralized

      await expect(vault.connect(liquidator).liquidate(0))
        .to.emit(vault, "LoanLiquidated");
    });

    it("T33: liquidator receives 5% bonus", async () => {
      await vault.connect(governance).setIFRPrice(IFR_PRICE.mul(2));

      const beforeETH = await ethers.provider.getBalance(liquidator.address);
      const tx = await vault.connect(liquidator).liquidate(0);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const afterETH = await ethers.provider.getBalance(liquidator.address);

      const expectedBonus = collateral.mul(5).div(100);
      expect(afterETH.add(gasCost).sub(beforeETH)).to.equal(expectedBonus);
    });

    it("T34: lender receives remaining collateral after liquidation", async () => {
      await vault.connect(governance).setIFRPrice(IFR_PRICE.mul(2));

      const beforeLender = await ethers.provider.getBalance(lenderA.address);
      await vault.connect(liquidator).liquidate(0);
      const afterLender = await ethers.provider.getBalance(lenderA.address);

      const expectedLender = collateral.mul(95).div(100);
      expect(afterLender.sub(beforeLender)).to.equal(expectedLender);
    });

    it("T35: loan deactivated after liquidation", async () => {
      await vault.connect(governance).setIFRPrice(IFR_PRICE.mul(2));
      await vault.connect(liquidator).liquidate(0);

      const loan = await vault.getLoan(0);
      expect(loan.active).to.be.false;
      expect(loan.ethCollateral).to.equal(0);
    });

    it("T36: totalLent decreases after liquidation", async () => {
      await vault.connect(governance).setIFRPrice(IFR_PRICE.mul(2));
      const before = await vault.totalLent();
      await vault.connect(liquidator).liquidate(0);
      const after = await vault.totalLent();
      expect(before.sub(after)).to.equal(borrowAmount);
    });

    it("T37: cannot liquidate same loan twice", async () => {
      await vault.connect(governance).setIFRPrice(IFR_PRICE.mul(2));
      await vault.connect(liquidator).liquidate(0);
      await expect(
        vault.connect(liquidator).liquidate(0)
      ).to.be.revertedWith("loan not active");
    });
  });

  // ── T38–T42: Collateral Top-Up & Health ─────────────────────

  describe("Collateral Top-Up & Health", () => {
    let borrowAmount, collateral;

    beforeEach(async () => {
      await token.connect(lenderA).approve(vault.address, parse("200000"));
      await vault.connect(lenderA).createOffer(parse("200000"));

      borrowAmount = parse("10000");
      collateral = await vault.getRequiredCollateral(borrowAmount);
      await vault.connect(borrowerA).borrow(0, borrowAmount, 30, { value: collateral });
    });

    it("T38: topUpCollateral increases collateral", async () => {
      const extra = ethers.utils.parseEther("0.001");
      await vault.connect(borrowerA).topUpCollateral(0, { value: extra });

      const loan = await vault.getLoan(0);
      expect(loan.ethCollateral).to.equal(collateral.add(extra));
    });

    it("T39: topUpCollateral only by borrower", async () => {
      await expect(
        vault.connect(lenderA).topUpCollateral(0, { value: 1000 })
      ).to.be.revertedWith("not borrower");
    });

    it("T40: checkHealth emits MarginCallWarning when ratio < 150%", async () => {
      // Increase price by ~40% → ratio drops to ~143%
      const newPrice = IFR_PRICE.mul(140).div(100);
      await vault.connect(governance).setIFRPrice(newPrice);

      await expect(vault.checkHealth(0))
        .to.emit(vault, "MarginCallWarning");
    });

    it("T41: checkHealth does not emit when healthy", async () => {
      await expect(vault.checkHealth(0))
        .to.not.emit(vault, "MarginCallWarning");
    });

    it("T42: topUpCollateral makes loan healthy again", async () => {
      // Make undercollateralized
      await vault.connect(governance).setIFRPrice(IFR_PRICE.mul(2));
      expect(await vault.getCollateralRatio(0)).to.equal(100);

      // Top up to bring back to 200%
      await vault.connect(borrowerA).topUpCollateral(0, { value: collateral });
      expect(await vault.getCollateralRatio(0)).to.equal(200);
    });
  });

  // ── T43–T47: Interest Rate Model ────────────────────────────

  describe("Interest Rate Model", () => {
    it("T43: 0% utilization = 200 bps (2%)", async () => {
      expect(await vault.getInterestRate()).to.equal(200);
    });

    it("T44: ~25% utilization = 200 bps", async () => {
      // Create 200k offer, borrow 50k → 25% util
      await token.connect(lenderA).approve(vault.address, parse("200000"));
      await vault.connect(lenderA).createOffer(parse("200000"));
      const amount = parse("50000");
      const col = await vault.getRequiredCollateral(amount);
      await vault.connect(borrowerA).borrow(0, amount, 30, { value: col });

      expect(await vault.getInterestRate()).to.equal(200);
    });

    it("T45: ~50% utilization = 300 bps", async () => {
      await token.connect(lenderA).approve(vault.address, parse("200000"));
      await vault.connect(lenderA).createOffer(parse("200000"));
      const amount = parse("100000");
      const col = await vault.getRequiredCollateral(amount);
      await vault.connect(borrowerA).borrow(0, amount, 30, { value: col });

      expect(await vault.getInterestRate()).to.equal(300);
    });

    it("T46: ~75% utilization = 500 bps", async () => {
      await token.connect(lenderA).approve(vault.address, parse("200000"));
      await vault.connect(lenderA).createOffer(parse("200000"));
      const amount = parse("150000");
      const col = await vault.getRequiredCollateral(amount);
      await vault.connect(borrowerA).borrow(0, amount, 30, { value: col });

      expect(await vault.getInterestRate()).to.equal(500);
    });

    it("T47: high utilization = higher rate", async () => {
      await token.connect(lenderA).approve(vault.address, parse("200000"));
      await vault.connect(lenderA).createOffer(parse("200000"));
      const amount = parse("180000"); // 90%
      const col = await vault.getRequiredCollateral(amount);
      await vault.connect(borrowerA).borrow(0, amount, 30, { value: col });

      expect(await vault.getInterestRate()).to.equal(800);
    });
  });

  // ── T48–T55: Governance & Edge Cases ────────────────────────

  describe("Governance & Edge Cases", () => {
    it("T48: setIFRPrice only by governance", async () => {
      await expect(
        vault.connect(borrowerA).setIFRPrice(1000)
      ).to.be.reverted;
    });

    it("T49: setIFRPrice reverts on 0", async () => {
      await expect(
        vault.connect(governance).setIFRPrice(0)
      ).to.be.revertedWith("price=0");
    });

    it("T50: setProtocolFeeReceiver only by governance", async () => {
      await expect(
        vault.connect(borrowerA).setProtocolFeeReceiver(borrowerA.address)
      ).to.be.reverted;

      await vault.connect(governance).setProtocolFeeReceiver(lenderB.address);
      expect(await vault.protocolFeeReceiver()).to.equal(lenderB.address);
    });

    it("T51: protocol fee receiver gets interest share on repay", async () => {
      await vault.connect(governance).setProtocolFeeReceiver(lenderB.address);

      await token.connect(lenderA).approve(vault.address, parse("200000"));
      await vault.connect(lenderA).createOffer(parse("200000"));
      const amount = parse("10000");
      const col = await vault.getRequiredCollateral(amount);
      await vault.connect(borrowerA).borrow(0, amount, 30, { value: col });

      await advanceTime(THIRTY_DAYS);
      const interest = await vault.calculateInterest(0);
      await token.connect(borrowerA).approve(vault.address, amount.add(interest));

      const beforeFee = await token.balanceOf(lenderB.address);
      await vault.connect(borrowerA).repay(0);
      const afterFee = await token.balanceOf(lenderB.address);

      const protocolShare = interest.sub(interest.div(2)); // 50%
      expect(afterFee.sub(beforeFee)).to.equal(protocolShare);
    });

    it("T52: getRequiredCollateral calculates correctly", async () => {
      // 10000 IFR at IFR_PRICE=1e12, 200% collateral
      // = 10000e9 * 1e12 * 200 / (1e9 * 100) = 20000e12 = 0.00002 ETH
      const amount = parse("10000");
      const required = await vault.getRequiredCollateral(amount);
      const expected = amount.mul(IFR_PRICE).mul(200).div(ethers.BigNumber.from("1000000000").mul(100));
      expect(required).to.equal(expected);
    });

    it("T53: getRequiredCollateral reverts when price not set", async () => {
      const LV = await ethers.getContractFactory("LendingVault");
      const v2 = await LV.deploy(token.address, governance.address);
      await v2.deployed();
      // Price not set
      await expect(
        v2.getRequiredCollateral(parse("10000"))
      ).to.be.revertedWith("price not set");
    });

    it("T54: MAX_LOANS_PER_BORROWER enforced", async () => {
      await token.connect(lenderA).approve(vault.address, parse("500000"));
      await vault.connect(lenderA).createOffer(parse("500000"));

      const amount = parse("1000");
      const col = await vault.getRequiredCollateral(amount);

      for (let i = 0; i < 10; i++) {
        await vault.connect(borrowerA).borrow(0, amount, 30, { value: col });
      }
      await expect(
        vault.connect(borrowerA).borrow(0, amount, 30, { value: col })
      ).to.be.revertedWith("max loans reached");
    });

    it("T55: activeLoanCount decreases after repay", async () => {
      await token.connect(lenderA).approve(vault.address, parse("200000"));
      await vault.connect(lenderA).createOffer(parse("200000"));
      const amount = parse("10000");
      const col = await vault.getRequiredCollateral(amount);
      await vault.connect(borrowerA).borrow(0, amount, 30, { value: col });

      expect(await vault.activeLoanCount(borrowerA.address)).to.equal(1);

      await advanceTime(THIRTY_DAYS);
      const interest = await vault.calculateInterest(0);
      await token.connect(borrowerA).approve(vault.address, amount.add(interest));
      await vault.connect(borrowerA).repay(0);

      expect(await vault.activeLoanCount(borrowerA.address)).to.equal(0);
    });
  });
});
