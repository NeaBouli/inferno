const { expect } = require("chai");
const { ethers } = require("hardhat");

const DECIMALS = 9;
const FEE_DENOMINATOR = 10_000n;
const SENDER_BURN_FEE = 200n; // 2.0%
const RECIPIENT_BURN_FEE = 50n; // 0.5%
const POOL_FEE = 100n; // 1.0%

const parseUnits = (value, decimals = DECIMALS) => {
  const parsed = ethers.parseUnits
    ? ethers.parseUnits(value, decimals)
    : ethers.utils.parseUnits(value, decimals);
  return toBigInt(parsed);
};

const toBigInt = (value) =>
  typeof value === "bigint" ? value : BigInt(value.toString());

const toBN = (value) => {
  if (ethers.BigNumber) {
    return ethers.BigNumber.from(value.toString());
  }
  return toBigInt(value);
};

const waitForDeployment = async (contract) => {
  if (typeof contract.waitForDeployment === "function") {
    await contract.waitForDeployment();
  } else if (typeof contract.deployed === "function") {
    await contract.deployed();
  }
};

const calculateFees = (amount) => {
  const senderBurn = (amount * SENDER_BURN_FEE) / FEE_DENOMINATOR;
  const recipientBurn = (amount * RECIPIENT_BURN_FEE) / FEE_DENOMINATOR;
  const poolFee = (amount * POOL_FEE) / FEE_DENOMINATOR;
  const recipientNet = amount - senderBurn - recipientBurn - poolFee;
  return { senderBurn, recipientBurn, poolFee, recipientNet };
};

describe("InfernoToken", function () {
  let owner;
  let treasury;
  let alice;
  let bob;
  let carol;
  let token;
  const TOTAL_SUPPLY = parseUnits("1000000000");

  beforeEach(async function () {
    [owner, treasury, alice, bob, carol] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("InfernoToken");
    token = await Token.connect(owner).deploy(treasury.address);
    await waitForDeployment(token);
  });

  describe("Deployment", function () {
    it("mints the full supply to the owner", async function () {
      const ownerBalance = toBigInt(await token.balanceOf(owner.address));
      expect(ownerBalance).to.equal(TOTAL_SUPPLY);
    });

    it("sets the pool fee address and exemptions", async function () {
      expect(await token.poolFeeAddress()).to.equal(treasury.address);
      expect(await token.isFeeExempt(owner.address)).to.equal(true);
      expect(await token.isFeeExempt(treasury.address)).to.equal(true);
    });
  });

  describe("Fee logic", function () {
    it("applies all fees on a standard transfer", async function () {
      const initialFunding = parseUnits("1000");
      await token.transfer(alice.address, toBN(initialFunding));

      const transferAmount = parseUnits("100");
      const { senderBurn, recipientBurn, poolFee, recipientNet } =
        calculateFees(transferAmount);

      const totalSupplyBefore = toBigInt(await token.totalSupply());

      const tx = token
        .connect(alice)
        .transfer(bob.address, toBN(transferAmount));

      await expect(tx)
        .to.emit(token, "SenderBurn")
        .withArgs(alice.address, toBN(senderBurn));
      await expect(tx)
        .to.emit(token, "PoolFeeTransferred")
        .withArgs(alice.address, treasury.address, toBN(poolFee));
      await expect(tx)
        .to.emit(token, "RecipientBurn")
        .withArgs(bob.address, toBN(recipientBurn));
      await tx;

      const aliceBalance = toBigInt(await token.balanceOf(alice.address));
      expect(aliceBalance).to.equal(initialFunding - transferAmount);

      const bobBalance = toBigInt(await token.balanceOf(bob.address));
      expect(bobBalance).to.equal(recipientNet);

      const treasuryBalance = toBigInt(
        await token.balanceOf(treasury.address)
      );
      expect(treasuryBalance).to.equal(poolFee);

      const totalSupplyAfter = toBigInt(await token.totalSupply());
      expect(totalSupplyAfter).to.equal(
        totalSupplyBefore - senderBurn - recipientBurn
      );
    });

    it("skips fees when the sender is exempt", async function () {
      const amount = parseUnits("12345");
      const tx = token.transfer(alice.address, toBN(amount));

      await expect(tx).to.not.emit(token, "SenderBurn");
      await expect(tx).to.not.emit(token, "PoolFeeTransferred");
      await expect(tx).to.not.emit(token, "RecipientBurn");
      await tx;

      const aliceBalance = toBigInt(await token.balanceOf(alice.address));
      expect(aliceBalance).to.equal(amount);

      const treasuryBalance = toBigInt(
        await token.balanceOf(treasury.address)
      );
      expect(treasuryBalance).to.equal(0n);

      const totalSupplyValue = toBigInt(await token.totalSupply());
      expect(totalSupplyValue).to.equal(TOTAL_SUPPLY);
    });

    it("skips fees when the recipient is exempt", async function () {
      const seedAmount = parseUnits("100");
      await token.transfer(alice.address, toBN(seedAmount));

      await token.setFeeExempt(bob.address, true);

      const tx = token
        .connect(alice)
        .transfer(bob.address, toBN(parseUnits("10")));

      await expect(tx).to.not.emit(token, "SenderBurn");
      await expect(tx).to.not.emit(token, "PoolFeeTransferred");
      await expect(tx).to.not.emit(token, "RecipientBurn");
      await tx;

      const bobBalance = toBigInt(await token.balanceOf(bob.address));
      expect(bobBalance).to.equal(parseUnits("10"));

      const treasuryBalance = toBigInt(
        await token.balanceOf(treasury.address)
      );
      expect(treasuryBalance).to.equal(0n);
    });

    it("routes fees to the updated pool fee address", async function () {
      const funding = parseUnits("500");
      await token.transfer(alice.address, toBN(funding));

      await token.setPoolFeeAddress(carol.address);
      expect(await token.poolFeeAddress()).to.equal(carol.address);
      expect(await token.isFeeExempt(carol.address)).to.equal(true);

      const transferAmount = parseUnits("100");
      const { poolFee } = calculateFees(transferAmount);

      const tx = token
        .connect(alice)
        .transfer(bob.address, toBN(transferAmount));

      await expect(tx)
        .to.emit(token, "PoolFeeTransferred")
        .withArgs(alice.address, carol.address, toBN(poolFee));
      await tx;

      const oldTreasuryBalance = toBigInt(
        await token.balanceOf(treasury.address)
      );
      expect(oldTreasuryBalance).to.equal(0n);

      const newTreasuryBalance = toBigInt(
        await token.balanceOf(carol.address)
      );
      expect(newTreasuryBalance).to.equal(poolFee);
    });

    it("handles minimal transfers without rounding issues", async function () {
      const tinyAmount = 1n;
      await token.transfer(alice.address, toBN(tinyAmount));

      const totalSupplyBefore = toBigInt(await token.totalSupply());

      const tx = token
        .connect(alice)
        .transfer(bob.address, toBN(tinyAmount));

      await expect(tx).to.not.emit(token, "SenderBurn");
      await expect(tx).to.not.emit(token, "PoolFeeTransferred");
      await expect(tx).to.not.emit(token, "RecipientBurn");
      await tx;

      const aliceBalance = toBigInt(await token.balanceOf(alice.address));
      expect(aliceBalance).to.equal(0n);

      const bobBalance = toBigInt(await token.balanceOf(bob.address));
      expect(bobBalance).to.equal(tinyAmount);

      const totalSupplyAfter = toBigInt(await token.totalSupply());
      expect(totalSupplyAfter).to.equal(totalSupplyBefore);
    });
  });

  describe("Admin functions", function () {
    it("allows only the owner to set fee exemptions", async function () {
      await expect(
        token.connect(alice).setFeeExempt(bob.address, true)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await token.setFeeExempt(alice.address, true);
      expect(await token.isFeeExempt(alice.address)).to.equal(true);

      await token.setFeeExempt(alice.address, false);
      expect(await token.isFeeExempt(alice.address)).to.equal(false);
    });

    it("allows only the owner to update the pool fee address", async function () {
      await expect(
        token.connect(alice).setPoolFeeAddress(alice.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await token.setPoolFeeAddress(carol.address);
      expect(await token.poolFeeAddress()).to.equal(carol.address);
      expect(await token.isFeeExempt(carol.address)).to.equal(true);
    });
  });

  describe("Edge cases", function () {
    it("reverts when the sender has insufficient balance", async function () {
      await expect(
        token.connect(alice).transfer(bob.address, toBN(parseUnits("1")))
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });
  });
});
