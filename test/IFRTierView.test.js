import { expect } from "chai";
import { createRequire } from "node:module";
import { ethers, connection } from "./helpers/hardhat.js";

const require = createRequire(import.meta.url);
const tiers = require("../docs/specs/ifr-benefits-tiers.v1.json");
const vectors = require("../apps/benefits-verify/vectors/v1.json");
const { verifyIfrBenefit } = require("../apps/benefits-verify/dist/index.js");
const parse = (amount) => ethers.parseUnits(amount, 9);
const tierNumber = (key) => BigInt(tiers.tiers.findIndex((tier) => tier.key === key) + 1);

describe("IFRTierView", function () {
  let owner, wallet, other, token, lock, vault, helper, lockOnly, factory, contracts, chainId;

  beforeEach(async () => {
    [owner, wallet, other] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("InfernoToken")).deploy(owner.address);
    lock = await (await ethers.getContractFactory("IFRLock")).deploy(token.target, owner.address);
    vault = await (await ethers.getContractFactory("CommitmentVault")).deploy(token.target, owner.address);
    for (const address of [owner.address, lock.target, vault.target]) {
      await token.setFeeExempt(address, true);
    }
    factory = await ethers.getContractFactory("IFRTierView");
    helper = await factory.deploy(lock.target, vault.target);
    lockOnly = await factory.deploy(lock.target, ethers.ZeroAddress);
    contracts = { token: token.target, ifrLock: lock.target, commitmentVault: vault.target };
    chainId = Number((await ethers.provider.getNetwork()).chainId);
  });

  async function fundLocks(lockIFR = "0", timeOnly = [], account = wallet) {
    const locked = parse(lockIFR);
    const vaultAmounts = timeOnly.map(parse);
    const total = locked + vaultAmounts.reduce((sum, amount) => sum + amount, 0n);
    if (total > 0n) await token.transfer(account.address, total);
    if (locked > 0n) {
      await token.connect(account).approve(lock.target, locked);
      await lock.connect(account).lock(locked);
    }
    const { timestamp } = await ethers.provider.getBlock("latest");
    for (const amount of vaultAmounts) {
      await token.connect(account).approve(vault.target, amount);
      await vault.connect(account).lock(amount, 0, timestamp + 86400, 0);
    }
  }

  async function expectTier(expected, view = helper, source = "EITHER", account = wallet) {
    const result = await view.tierOf(account.address);
    expect(result).to.deep.equal([tierNumber(expected), BigInt(tiers.version)]);
    const reference = await verifyIfrBenefit({
      wallet: account.address,
      chainId,
      rpc: connection.provider,
      contracts,
      allowTestChain: true,
      source,
    });
    expect(reference.tier).to.equal(expected);
    expect(result[0]).to.equal(tierNumber(reference.tier));
  }

  // The repository vault rejects new price conditions. Reproduce legacy tranche states on
  // the actual deployed test vault, without changing its code or using a mock implementation.
  // Solidity layout: Ownable._owner, p0, p0Set, totalLocked, then _tranches at slot 4.
  // Each Tranche occupies six slots; cType is at offset 1 and unlocked at offset 4.
  async function setTrancheField(index, offset, value) {
    const mappingSlot = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [wallet.address, 4n]),
    );
    expect(BigInt(await ethers.provider.getStorage(vault.target, mappingSlot)))
      .to.equal(await vault.getTrancheCount(wallet.address));
    const start = BigInt(ethers.keccak256(mappingSlot));
    const slot = start + BigInt(index) * 6n + BigInt(offset);
    await connection.provider.request({
      method: "hardhat_setStorageAt",
      params: [vault.target, ethers.toQuantity(slot), ethers.toBeHex(value, 32)],
    });
    await connection.provider.request({ method: "evm_mine", params: [] });
  }

  async function setPriceCondition(index, cType) {
    await setTrancheField(index, 1, cType);
    await setTrancheField(index, 3, 200n);
    const tranche = await vault.getTranche(wallet.address, index);
    expect(tranche.cType).to.equal(cType);
    expect(tranche.p0Multiplier).to.equal(200n);
  }

  it("fixes source addresses, all four base-unit thresholds and the tier file version", async () => {
    expect(await helper.ifrLock()).to.equal(lock.target);
    expect(await helper.commitmentVault()).to.equal(vault.target);
    expect(await lockOnly.commitmentVault()).to.equal(ethers.ZeroAddress);
    expect((await helper.tierOf(wallet.address)).configVersion).to.equal(BigInt(tiers.version));
    expect(vectors.tiersVersion).to.equal(tiers.version);
    for (const tier of tiers.tiers) {
      expect(await helper[`${tier.label.toLowerCase()}Threshold`]()).to.equal(BigInt(tier.minBaseUnits));
    }
  });

  it("exposes only view functions, with no owner, setters or upgrade entry points", () => {
    const functions = helper.interface.fragments.filter((fragment) => fragment.type === "function");
    expect(functions.map((fragment) => fragment.name).sort()).to.deep.equal([
      "bronzeThreshold", "commitmentVault", "goldThreshold", "ifrLock",
      "platinumThreshold", "silverThreshold", "tierOf",
    ]);
    expect(functions.every((fragment) => fragment.stateMutability === "view")).to.equal(true);
  });

  it("rejects a zero lock and source addresses without code", async () => {
    await expect(factory.deploy(ethers.ZeroAddress, vault.target)).to.be.revertedWith("lock=0");
    await expect(factory.deploy(wallet.address, vault.target)).to.be.revertedWith("lock has no code");
    await expect(factory.deploy(lock.target, wallet.address)).to.be.revertedWith("vault has no code");
  });

  it("returns no tier for an empty wallet, including the zero address", async () => {
    await expectTier(null);
    await expectTier(null, lockOnly, "IFRLOCK");
    expect(await helper.tierOf(ethers.ZeroAddress)).to.deep.equal([0n, BigInt(tiers.version)]);
  });

  for (const source of ["IFRLOCK", "COMMITMENT_TIME_ONLY"]) {
    describe(`${source} boundaries`, () => {
      for (const [index, tier] of tiers.tiers.entries()) {
        const minimum = BigInt(tier.minBaseUnits);
        const previous = index === 0 ? null : tiers.tiers[index - 1].key;
        for (const [label, amount, expected] of [
          ["min - 1 base unit", minimum - 1n, previous],
          ["min", minimum, tier.key],
          ["min + 1 base unit", minimum + 1n, tier.key],
        ]) {
          it(`${tier.key}: ${label}`, async () => {
            const ifr = ethers.formatUnits(amount, 9);
            await fundLocks(source === "IFRLOCK" ? ifr : "0", source === "IFRLOCK" ? [] : [ifr]);
            await expectTier(expected);
            if (source === "IFRLOCK") await expectTier(expected, lockOnly, "IFRLOCK");
          });
        }
      }
    });
  }

  describe("version 1 conformance vectors", () => {
    for (const vector of vectors.tierCases) {
      it(vector.name, async () => {
        await fundLocks(vector.lockIFR);
        await expectTier(vector.expected, lockOnly, vector.source);
        await expectTier(vector.expected);
      });
    }

    for (const vector of vectors.sourceCases) {
      it(vector.name, async () => {
        await fundLocks(vector.lockIFR, [...vector.timeOnly, ...vector.priceConditioned]);
        for (let index = 0; index < vector.priceConditioned.length; index++) {
          await setPriceCondition(vector.timeOnly.length + index, 1n);
        }
        await expectTier(vector.expected, vector.source === "IFRLOCK" ? lockOnly : helper, vector.source);
      });
    }
  });

  it("keeps two individually sub-Bronze sources below Bronze", async () => {
    await fundLocks("600", ["600"]);
    await expectTier(null);
  });

  it("ignores every vault tranche when the vault address is zero", async () => {
    await fundLocks("1000", ["10000"]);
    await expectTier("BRONZE", lockOnly, "IFRLOCK");
    await expectTier("PLATINUM");
  });

  for (const [name, cType] of [["PRICE_ONLY", 1n], ["TIME_OR_PRICE", 2n], ["TIME_AND_PRICE", 3n]]) {
    it(`excludes ${name} from a mixed vault even after its time condition is due`, async () => {
      await fundLocks("0", ["900", "50000"]);
      const tranche = await vault.getTranche(wallet.address, 1);
      await expect(vault.connect(wallet).lock(1n, cType, tranche.unlockTime, 200n))
        .to.be.revertedWith("price conditions disabled");
      await setPriceCondition(1, cType);
      await connection.provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(tranche.unlockTime)] });
      await connection.provider.request({ method: "evm_mine", params: [] });
      expect(await vault.lockedBalance(wallet.address)).to.equal(parse("50900"));
      await expectTier(null);
      await fundLocks("0", ["100"]);
      await expectTier("BRONZE");
    });
  }

  it("ignores unlocked and zero-amount TIME_ONLY tranches", async () => {
    await fundLocks("0", ["900", "10000", "10000"]);
    await setTrancheField(1, 4, 1n);
    await setTrancheField(2, 0, 0n);
    expect((await vault.getTranche(wallet.address, 1)).unlocked).to.equal(true);
    expect((await vault.getTranche(wallet.address, 2)).amount).to.equal(0n);
    await expectTier(null);
  });

  it("counts due and marked TIME_ONLY tranches until actual unlock, then drops the tier", async () => {
    await fundLocks("0", ["2000", "600"]);
    const before = await ethers.provider.getBlockNumber();
    await expectTier("SILVER");
    const tranche = await vault.getTranche(wallet.address, 0);
    await connection.provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(tranche.unlockTime)] });
    await connection.provider.request({ method: "evm_mine", params: [] });
    await vault.markConditionMet(wallet.address, 0);
    await expectTier("SILVER");
    await vault.connect(wallet).unlock(wallet.address, 0);
    await expectTier(null);
    expect(await helper.tierOf(wallet.address, { blockTag: before })).to.deep.equal([2n, BigInt(tiers.version)]);
  });

  it("matches unlock-between-checks vectors and reproduces the earlier block", async () => {
    const vector = vectors.unlockBetweenChecks;
    await fundLocks(vector.lockIFR);
    const firstBlock = await ethers.provider.getBlockNumber();
    await expectTier(vector.expectedAtFirstBlock);
    await lock.connect(wallet).unlock();
    await expectTier(vector.expectedAfterUnlock);
    expect(await helper.tierOf(wallet.address, { blockTag: firstBlock }))
      .to.deep.equal([tierNumber(vector.expectedAtFirstBlockAgain), BigInt(tiers.version)]);
  });

  it("falls back to the other source after each source is unlocked", async () => {
    await fundLocks("5000", ["2500"]);
    await expectTier("GOLD");
    await lock.connect(wallet).unlock();
    await expectTier("SILVER");
    const tranche = await vault.getTranche(wallet.address, 0);
    await connection.provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(tranche.unlockTime)] });
    await vault.connect(wallet).unlock(wallet.address, 0);
    await expectTier(null);
  });

  it("keeps wallets independent", async () => {
    await fundLocks("10000");
    await fundLocks("0", ["2500"], other);
    await expectTier("PLATINUM");
    await expectTier("SILVER", helper, "EITHER", other);
  });

  it("reverts a failed vault read even when IFRLock alone qualifies for Platinum", async () => {
    await fundLocks("10000");
    const invalidVault = await factory.deploy(lock.target, token.target);
    await expect(invalidVault.tierOf(wallet.address)).to.be.revert(ethers);
  });

  it("reverts a failed IFRLock read even when the vault qualifies", async () => {
    await fundLocks("0", ["10000"]);
    const invalidLock = await factory.deploy(token.target, vault.target);
    await expect(invalidLock.tierOf(wallet.address)).to.be.revert(ethers);
  });
});
