// CommitmentVault V2 repair rehearsal on a Mainnet fork (CWA-03 / CV-01).
// Uses the deployed V2 at its pinned address; on a fork block before its deployment, the repository
// CommitmentVault (price conditions rejected, Governance as owner) is placed at that address instead.
// Runs the real Safe -> Governance -> InfernoToken.setFeeExempt flow with the on-chain delay and
// exercises the user path. Everything happens on the local fork; nothing reaches Mainnet.
// Run: HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=<recent block> MAINNET_RPC_URL=<rpc> npm run test:commitment-v2-fork
import { expect } from "chai";
import { createRequire } from "node:module";
import { ethers, connection } from "../helpers/hardhat.js";

const require = createRequire(import.meta.url);
const { build, V2 } = require("../../scripts/commitment-vault-v2-proposal.cjs");

const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const LIQUIDITY_RESERVE = "0xdc0309804803b3A105154f6073061E3185018f64"; // fee-exempt IFR source for the fork only
const TIME_ONLY = 0, PRICE_ONLY = 1, TIME_OR_PRICE = 2, TIME_AND_PRICE = 3;
const parse = (s) => ethers.parseUnits(s, 9);

async function impersonate(address) {
  await connection.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  await connection.provider.request({ method: "hardhat_setBalance", params: [address, "0xde0b6b3a7640000"] });
  return ethers.getSigner(address);
}

describe("CommitmentVault V2 repair on a Mainnet fork", function () {
  this.timeout(300_000);
  let token, governance, safe, v2, user;

  before(async function () {
    if (process.env.HARDHAT_FORK !== "true") this.skip();
    token = await ethers.getContractAt(
      ["function setFeeExempt(address,bool)", "function feeExempt(address) view returns (bool)", "function owner() view returns (address)",
       "function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"],
      IFR_TOKEN
    );
    governance = await ethers.getContractAt(
      ["function owner() view returns (address)", "function delay() view returns (uint256)", "function proposalCount() view returns (uint256)",
       "function propose(address,bytes) returns (uint256)", "function execute(uint256)"],
      GOVERNANCE
    );
    expect(await token.owner()).to.equal(GOVERNANCE);
    safe = await impersonate(await governance.owner());
    [user] = await ethers.getSigners();

    const Vault = await ethers.getContractFactory("CommitmentVault");
    if ((await ethers.provider.getCode(V2)) === "0x") {
      // The generator accepts only the pinned V2, so the fresh vault's code and storage are moved there.
      const fresh = await Vault.deploy(IFR_TOKEN, GOVERNANCE);
      await fresh.waitForDeployment();
      await connection.provider.request({ method: "hardhat_setCode", params: [V2, await ethers.provider.getCode(fresh.target)] });
      for (let slot = 0; slot < 8; slot++) {
        const value = await ethers.provider.getStorage(fresh.target, slot);
        await connection.provider.request({ method: "hardhat_setStorageAt", params: [V2, ethers.toQuantity(slot), value] });
      }
    }
    v2 = Vault.attach(V2);

    const reserve = await impersonate(LIQUIDITY_RESERVE);
    await token.connect(reserve).transfer(user.address, parse("50000"));
  });

  it("V2 is owned by Governance and has no P0 or oracle", async () => {
    expect(await v2.owner()).to.equal(GOVERNANCE);
    expect(await v2.p0Set()).to.equal(false);
    expect(await v2.priceOracle()).to.equal(ethers.ZeroAddress);
  });

  it("price-conditioned locks are rejected; only TIME_ONLY is accepted", async () => {
    const latest = await ethers.provider.getBlock("latest");
    await token.connect(user).approve(v2.target, parse("4000"));
    for (const cType of [PRICE_ONLY, TIME_OR_PRICE, TIME_AND_PRICE]) {
      await expect(v2.connect(user).lock(parse("1000"), cType, latest.timestamp + 86400, 5000)).to.be.revertedWith("price conditions disabled");
    }
  });

  it("Safe -> Governance -> setFeeExempt(V2) executes only after the on-chain delay", async () => {
    // Execute exactly the bytes of the generated Safe batch files.
    const id = await governance.proposalCount();
    const { files } = build(v2.target, id.toString());
    const step1 = files["cv01-v2-step1-propose.json"].transactions[0];
    const step2 = files["cv01-v2-step2-execute.json"].transactions[0];
    expect(step1.to).to.equal(GOVERNANCE);
    await safe.sendTransaction({ to: step1.to, data: step1.data });
    await expect(safe.sendTransaction({ to: step2.to, data: step2.data })).to.be.revertedWith("too early");
    const delay = Number(await governance.delay());
    await connection.provider.request({ method: "evm_increaseTime", params: [delay] });
    await connection.provider.request({ method: "evm_mine", params: [] });
    await safe.sendTransaction({ to: step2.to, data: step2.data });
    expect(await token.feeExempt(v2.target)).to.equal(true);
  });

  it("with the exemption, a TIME_ONLY lock keeps nominal accounting and unlocks after its time", async () => {
    const amount = parse("12000");
    const lockedBefore = await v2.totalLocked();
    const latest = await ethers.provider.getBlock("latest");
    await token.connect(user).approve(v2.target, amount);
    await v2.connect(user).lock(amount, TIME_ONLY, latest.timestamp + 30 * 86400, 0);
    expect(await token.balanceOf(v2.target)).to.equal(await v2.totalLocked());
    expect(await v2.lockedBalance(user.address)).to.equal(amount);
    await expect(v2.connect(user).unlock(user.address, 0)).to.be.revertedWith("condition not met");
    await connection.provider.request({ method: "evm_increaseTime", params: [30 * 86400] });
    await connection.provider.request({ method: "evm_mine", params: [] });
    const before = await token.balanceOf(user.address);
    await v2.connect(user).unlock(user.address, 0);
    expect((await token.balanceOf(user.address)) - before).to.equal(amount);
    expect(await v2.totalLocked()).to.equal(lockedBefore);
  });
});
