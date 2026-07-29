import { expect } from "chai";
import { ethers } from "./helpers/hardhat.js";

describe("BurnReserve", function () {
  let owner, guardian, user;
  let token, burnReserve;

  const INITIAL_SUPPLY = ethers.parseUnits("1000000000", 9); // 1B IFR

  beforeEach(async () => {
    [owner, guardian, user] = await ethers.getSigners();

    // Deploy InfernoToken (owner is poolFeeReceiver + gets full supply)
    const InfernoToken = await ethers.getContractFactory("InfernoToken");
    token = await InfernoToken.deploy(owner.address);
    await token.waitForDeployment();

    // Make owner fee-exempt so transfers in tests aren't taxed
    await token.setFeeExempt(owner.address, true);

    // Deploy BurnReserve
    const BurnReserve = await ethers.getContractFactory("BurnReserve");
    burnReserve = await BurnReserve.deploy(token.target, guardian.address);
    await burnReserve.waitForDeployment();

    // Make BurnReserve fee-exempt
    await token.setFeeExempt(burnReserve.target, true);
  });

  describe("Deployment", () => {
    it("sets owner, guardian, and token correctly", async () => {
      expect(await burnReserve.owner()).to.equal(owner.address);
      expect(await burnReserve.guardian()).to.equal(guardian.address);
      expect(await burnReserve.token()).to.equal(token.target);
      expect(await burnReserve.totalBurned()).to.equal(0);
    });

    it("reverts if token is zero address", async () => {
      const BurnReserve = await ethers.getContractFactory("BurnReserve");
      await expect(
        BurnReserve.deploy(ethers.ZeroAddress, guardian.address)
      ).to.be.revertedWith("token=0");
    });

    it("reverts if guardian is zero address", async () => {
      const BurnReserve = await ethers.getContractFactory("BurnReserve");
      await expect(
        BurnReserve.deploy(token.target, ethers.ZeroAddress)
      ).to.be.revertedWith("guardian=0");
    });
  });

  describe("deposit()", () => {
    it("accepts deposits via transferFrom and emits Deposited", async () => {
      const amount = ethers.parseUnits("1000", 9);
      await token.approve(burnReserve.target, amount);

      await expect(burnReserve.deposit(amount))
        .to.emit(burnReserve, "Deposited")
        .withArgs(owner.address, amount);

      expect(await token.balanceOf(burnReserve.target)).to.equal(amount);
    });

    it("reverts on zero amount", async () => {
      await expect(burnReserve.deposit(0)).to.be.revertedWith("amount=0");
    });

    it("reverts without approval", async () => {
      const amount = ethers.parseUnits("1000", 9);
      await expect(burnReserve.deposit(amount)).to.be.revert(ethers);
    });
  });

  describe("burn()", () => {
    const depositAmount = ethers.parseUnits("10000", 9);

    beforeEach(async () => {
      // Send tokens directly to BurnReserve (simulating BuybackVault sending tokens)
      await token.transfer(burnReserve.target, depositAmount);
    });

    it("owner can burn a specific amount and totalSupply decreases", async () => {
      const burnAmount = ethers.parseUnits("3000", 9);
      const supplyBefore = await token.totalSupply();

      await expect(burnReserve.burn(burnAmount))
        .to.emit(burnReserve, "Burned")
        .withArgs(burnAmount, burnAmount);

      expect(await token.totalSupply()).to.equal(BigInt(supplyBefore)-BigInt(burnAmount));
      expect(await burnReserve.totalBurned()).to.equal(burnAmount);
      expect(await token.balanceOf(burnReserve.target)).to.equal(
        BigInt(depositAmount)-BigInt(burnAmount)
      );
    });

    it("guardian can burn", async () => {
      const burnAmount = ethers.parseUnits("5000", 9);
      await expect(burnReserve.connect(guardian).burn(burnAmount))
        .to.emit(burnReserve, "Burned");

      expect(await burnReserve.totalBurned()).to.equal(burnAmount);
    });

    it("reverts if caller is not owner or guardian", async () => {
      await expect(
        burnReserve.connect(user).burn(ethers.parseUnits("100", 9))
      ).to.be.revertedWith("not authorized");
    });

    it("reverts on zero amount", async () => {
      await expect(burnReserve.burn(0)).to.be.revertedWith("amount=0");
    });

    it("reverts if amount exceeds balance", async () => {
      const tooMuch = BigInt(depositAmount)+BigInt(1);
      await expect(burnReserve.burn(tooMuch)).to.be.revertedWith("exceeds balance");
    });

    it("accumulates totalBurned across multiple burns", async () => {
      const burn1 = ethers.parseUnits("2000", 9);
      const burn2 = ethers.parseUnits("3000", 9);

      await burnReserve.burn(burn1);
      await burnReserve.burn(burn2);

      expect(await burnReserve.totalBurned()).to.equal(BigInt(burn1)+BigInt(burn2));
    });
  });

  describe("burnAll()", () => {
    it("burns the entire balance and emits Burned", async () => {
      const amount = ethers.parseUnits("50000", 9);
      await token.transfer(burnReserve.target, amount);

      const supplyBefore = await token.totalSupply();

      await expect(burnReserve.burnAll())
        .to.emit(burnReserve, "Burned")
        .withArgs(amount, amount);

      expect(await token.balanceOf(burnReserve.target)).to.equal(0);
      expect(await token.totalSupply()).to.equal(BigInt(supplyBefore)-BigInt(amount));
      expect(await burnReserve.totalBurned()).to.equal(amount);
    });

    it("guardian can call burnAll", async () => {
      const amount = ethers.parseUnits("10000", 9);
      await token.transfer(burnReserve.target, amount);

      await expect(burnReserve.connect(guardian).burnAll())
        .to.emit(burnReserve, "Burned");
    });

    it("reverts if balance is zero", async () => {
      await expect(burnReserve.burnAll()).to.be.revertedWith("nothing to burn");
    });

    it("reverts if caller is not authorized", async () => {
      const amount = ethers.parseUnits("1000", 9);
      await token.transfer(burnReserve.target, amount);

      await expect(
        burnReserve.connect(user).burnAll()
      ).to.be.revertedWith("not authorized");
    });
  });

  describe("pendingBurn()", () => {
    it("returns the current token balance", async () => {
      expect(await burnReserve.pendingBurn()).to.equal(0);

      const amount = ethers.parseUnits("25000", 9);
      await token.transfer(burnReserve.target, amount);

      expect(await burnReserve.pendingBurn()).to.equal(amount);
    });

    it("decreases after a burn", async () => {
      const amount = ethers.parseUnits("10000", 9);
      await token.transfer(burnReserve.target, amount);

      const burnAmount = ethers.parseUnits("4000", 9);
      await burnReserve.burn(burnAmount);

      expect(await burnReserve.pendingBurn()).to.equal(BigInt(amount)-BigInt(burnAmount));
    });
  });

  describe("setGuardian()", () => {
    it("owner can update guardian", async () => {
      await expect(burnReserve.setGuardian(user.address))
        .to.emit(burnReserve, "GuardianUpdated")
        .withArgs(user.address);

      expect(await burnReserve.guardian()).to.equal(user.address);
    });

    it("reverts if not owner", async () => {
      await expect(
        burnReserve.connect(guardian).setGuardian(user.address)
      ).to.be.revertedWith("not owner");
    });

    it("reverts if new guardian is zero address", async () => {
      await expect(
        burnReserve.setGuardian(ethers.ZeroAddress)
      ).to.be.revertedWith("guardian=0");
    });
  });

  describe("transferOwnership", function () {
    it("owner can transfer ownership", async () => {
      await burnReserve.transferOwnership(user.address);
      expect(await burnReserve.owner()).to.equal(user.address);
    });

    it("emits OwnershipTransferred event", async () => {
      await expect(burnReserve.transferOwnership(user.address))
        .to.emit(burnReserve, "OwnershipTransferred")
        .withArgs(owner.address, user.address);
    });

    it("new owner can call onlyOwner functions", async () => {
      await burnReserve.transferOwnership(user.address);
      await expect(
        burnReserve.connect(user).setGuardian(guardian.address)
      ).to.emit(burnReserve, "GuardianUpdated").withArgs(guardian.address);
    });

    it("old owner is rejected after transfer", async () => {
      await burnReserve.transferOwnership(user.address);
      await expect(
        burnReserve.setGuardian(user.address)
      ).to.be.revertedWith("not owner");
    });

    it("reverts for non-owner", async () => {
      await expect(
        burnReserve.connect(user).transferOwnership(user.address)
      ).to.be.revertedWith("not owner");
    });

    it("reverts with zero address", async () => {
      await expect(
        burnReserve.transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWith("newOwner=0");
    });
  });
});
