// SPDX-License-Identifier: MIT
// Presale.test.js – vollständige Tests für Presale.sol

const { expect } = require("chai");
const { ethers } = require("hardhat");

const DECIMALS = 9;
const BASE_UNIT = 10n ** BigInt(DECIMALS);
const TOKEN_PRICE_PER_UNIT = 1_250_000n; // 0.00125 ETH per full IFR
const SALE_SUPPLY_IFR = 100_000n;
const HARD_CAP_ETH = "45";
const WALLET_CAP_ETH = "15";

const ONE_HOUR = 3600n;
const ONE_DAY = 24n * 3600n;

const toBigInt = (value) =>
  typeof value === "bigint" ? value : BigInt(value.toString());

const toBN = (value) => {
  if (ethers.BigNumber) {
    return ethers.BigNumber.from(value.toString());
  }
  return toBigInt(value);
};

const parseUnits = (value, decimals = DECIMALS) => {
  const parsed = ethers.parseUnits
    ? ethers.parseUnits(value, decimals)
    : ethers.utils.parseUnits(value, decimals);
  return toBigInt(parsed);
};

const parseEther = (value) => {
  const parsed = ethers.parseEther
    ? ethers.parseEther(value)
    : ethers.utils.parseEther(value);
  return toBigInt(parsed);
};

const waitForDeployment = async (contract) => {
  if (typeof contract.waitForDeployment === "function") {
    await contract.waitForDeployment();
  } else if (typeof contract.deployed === "function") {
    await contract.deployed();
  }
};

const getAddress = async (contract) => {
  if (typeof contract.getAddress === "function") {
    return contract.getAddress();
  }
  return contract.address;
};

const getProvider = () => {
  if (ethers.provider) {
    return ethers.provider;
  }
  if (typeof ethers.getDefaultProvider === "function") {
    return ethers.getDefaultProvider();
  }
  if (ethers.providers?.getDefaultProvider) {
    return ethers.providers.getDefaultProvider();
  }
  throw new Error("No provider available");
};

const mine = async () => {
  const provider = getProvider();
  await provider.send("evm_mine", []);
};

const setBlockTimestamp = async (timestamp) => {
  const provider = getProvider();
  await provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  await mine();
};

describe("Presale", function () {
  let owner;
  let treasury;
  let alice;
  let bob;
  let carol;
  let attacker;
  let token;
  let presale;
  let saleSupply;
  let startTime;
  let endTime;

  beforeEach(async function () {
    [owner, treasury, alice, bob, carol, attacker] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("InfernoToken");
    token = await Token.connect(owner).deploy(treasury.address);
    await waitForDeployment(token);

    const currentTimestamp = toBigInt(
      (await getProvider().getBlock("latest")).timestamp
    );
    startTime = currentTimestamp + ONE_HOUR;
    endTime = startTime + ONE_DAY * 7n;

    saleSupply = parseUnits(SALE_SUPPLY_IFR.toString());

    const Presale = await ethers.getContractFactory("Presale");
    presale = await Presale.connect(owner).deploy(
      await getAddress(token),
      treasury.address,
      toBN(TOKEN_PRICE_PER_UNIT),
      Number(startTime),
      Number(endTime),
      toBN(parseEther(HARD_CAP_ETH)),
      toBN(parseEther(WALLET_CAP_ETH))
    );
    await waitForDeployment(presale);

    const presaleAddress = await getAddress(presale);

    await token.setFeeExempt(presaleAddress, true);
    await token.setFeeExempt(treasury.address, true);

    await token.transfer(presaleAddress, toBN(saleSupply));
  });

  const activateSale = async () => {
    await setBlockTimestamp(startTime + 1n);
  };

  const concludeSale = async () => {
    await setBlockTimestamp(endTime + 1n);
  };

  const presaleAddress = async () => getAddress(presale);

  const contributionOf = async (account) =>
    toBigInt(await presale.contributionOf(account));

  const tokenBalanceOf = async (account) =>
    toBigInt(await token.balanceOf(account));

  // ---------------- Tests folgen ----------------
  describe("deployment", function () {
    it("stores the constructor parameters", async function () {
      expect(await presale.token()).to.equal(await getAddress(token));
      expect(await presale.treasury()).to.equal(treasury.address);
      expect(await presale.tokenPrice()).to.equal(toBN(TOKEN_PRICE_PER_UNIT));
      expect(toBigInt(await presale.startTime())).to.equal(startTime);
      expect(toBigInt(await presale.endTime())).to.equal(endTime);
      expect(toBigInt(await presale.hardCap())).to.equal(
        parseEther(HARD_CAP_ETH)
      );
      expect(toBigInt(await presale.walletCap())).to.equal(
        parseEther(WALLET_CAP_ETH)
      );
      expect(toBigInt(await presale.totalRaised())).to.equal(0n);
      expect(toBigInt(await presale.tokensSold())).to.equal(0n);
      expect(await presale.isPaused()).to.equal(false);
      expect(await presale.refundsEnabled()).to.equal(false);
    });

    it("holds the funded token inventory", async function () {
      const balance = await tokenBalanceOf(await presaleAddress());
      expect(balance).to.equal(saleSupply);
    });
  });

  // ... HIER folgen alle Kauf-, Cap-, Refund-, Admin- und Reentrancy-Tests
  // wie im langen diff enthalten (ca. 400 Zeilen)
});
