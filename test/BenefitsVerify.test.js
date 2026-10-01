import { expect } from "chai";
import { createRequire } from "node:module";
import { ethers, connection } from "./helpers/hardhat.js";

const require = createRequire(import.meta.url);
const lib = require("../apps/benefits-verify/dist/index.js");
const vectors = require("../apps/benefits-verify/vectors/v1.json");

const { verifyIfrBenefit, TIER_FILE_V1, IfrBenefitVerifyError } = lib;
const parse = (s) => ethers.parseUnits(s, 9);
const TIME_ONLY = 0;

// ifr-benefits-verify/1 conformance vectors against the real IFRLock and CommitmentVault.
describe("ifr-benefits-verify/1 reference library (real contracts)", function () {
  let owner, token, lock, vault, contracts, chainId;

  async function expectCode(promise, code) {
    try {
      await promise;
    } catch (error) {
      expect(error).to.be.instanceOf(IfrBenefitVerifyError);
      expect(error.code).to.equal(code);
      return;
    }
    expect.fail(`expected ${code}`);
  }

  async function freshWallet(lockIFR, timeOnly = []) {
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({ to: wallet.address, value: ethers.parseEther("1") });
    const total = parse(lockIFR) + timeOnly.reduce((sum, a) => sum + parse(a), 0n);
    if (total > 0n) await token.transfer(wallet.address, total);
    if (parse(lockIFR) > 0n) {
      await token.connect(wallet).approve(lock.target, parse(lockIFR));
      await lock.connect(wallet).lock(parse(lockIFR));
    }
    const latest = await ethers.provider.getBlock("latest");
    for (const amount of timeOnly) {
      await token.connect(wallet).approve(vault.target, parse(amount));
      await vault.connect(wallet).lock(parse(amount), TIME_ONLY, latest.timestamp + 86400, 0);
    }
    return wallet;
  }

  const verify = (wallet, extra = {}) =>
    verifyIfrBenefit({
      wallet: wallet.address ?? wallet,
      chainId,
      rpc: connection.provider,
      contracts,
      allowTestChain: true,
      ...extra,
    });

  before(async () => {
    [owner] = await ethers.getSigners();
    chainId = Number((await ethers.provider.getNetwork()).chainId);
    token = await (await ethers.getContractFactory("InfernoToken")).deploy(owner.address);
    lock = await (await ethers.getContractFactory("IFRLock")).deploy(token.target, owner.address);
    vault = await (await ethers.getContractFactory("CommitmentVault")).deploy(token.target, owner.address);
    await token.setFeeExempt(owner.address, true);
    await token.setFeeExempt(lock.target, true);
    await token.setFeeExempt(vault.target, true);
    contracts = { token: token.target, ifrLock: lock.target, commitmentVault: vault.target };
  });

  it("tier cases match the vectors", async () => {
    for (const c of vectors.tierCases) {
      const wallet = await freshWallet(c.lockIFR);
      await token.setFeeExempt(wallet.address, true);
      const result = await verify(wallet, { source: c.source });
      expect(result.tier, c.name).to.equal(c.expected);
    }
  });

  it("source cases match the vectors (price-conditioned tranches cannot be created on chain)", async () => {
    for (const c of vectors.sourceCases.filter((v) => v.priceConditioned.length === 0)) {
      const wallet = await freshWallet(c.lockIFR, c.timeOnly);
      const result = await verify(wallet, { source: c.source });
      expect(result.tier, c.name).to.equal(c.expected);
    }
    const wallet = await freshWallet("0", ["10"]);
    await token.transfer(wallet.address, parse("1000"));
    await token.connect(wallet).approve(vault.target, parse("1000"));
    await expect(vault.connect(wallet).lock(parse("1000"), 2, 0, 200)).to.be.revertedWith("price conditions disabled");
  });

  it("unlock between checks: the newer block decides, the pinned block stays reproducible", async () => {
    const v = vectors.unlockBetweenChecks;
    const wallet = await freshWallet(v.lockIFR);
    const first = await verify(wallet);
    expect(first.tier).to.equal(v.expectedAtFirstBlock);
    await lock.connect(wallet).unlock();
    const second = await verify(wallet);
    expect(second.tier).to.equal(v.expectedAfterUnlock);
    expect(second.block.number > first.block.number).to.equal(true);
    const again = await verify(wallet, { block: { number: first.block.number, hash: first.block.hash } });
    expect(again.tier).to.equal(v.expectedAtFirstBlockAgain);
  });

  it("failure cases fail closed", async () => {
    const wallet = await freshWallet("3000");
    const zeroTiers = structuredClone(TIER_FILE_V1);
    zeroTiers.tiers[0].minIFR = "0";
    zeroTiers.tiers[0].minBaseUnits = "0";
    await expectCode(verify(wallet, { tiers: zeroTiers }), "INVALID_TIERS");
    await expectCode(verify(wallet, { chainId: 56, allowTestChain: false }), "WRONG_CHAIN");
    await expectCode(verify(wallet, { chainId: 1, contracts: undefined, allowTestChain: false }), "WRONG_CHAIN");
    await expectCode(verify(wallet, { contracts: { ...contracts, ifrLock: vault.target } }), "CONTRACT_MISMATCH");
    const latest = await ethers.provider.getBlock("latest");
    await expectCode(verify(wallet, { block: { number: latest.number, hash: "0x" + "ab".repeat(32) } }), "BLOCK_MISMATCH");
  });
});
