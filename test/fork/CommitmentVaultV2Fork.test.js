// Deployed CommitmentVault V2 on a Mainnet fork (CWA-03 / CV-01). Requires the real V2 bytecode at its pinned
// address: the fork block must be at or after its deployment (block 26107296), otherwise the test fails.
// Executes the queued CV-01 proposal #17 with the exact generated Safe batch bytes (or checks the exemption if
// it is already executed) and exercises the user path with per-lock deltas. Nothing reaches Mainnet.
// The repository-bytecode rehearsal lives separately in CommitmentVaultV2SyntheticRehearsal.test.js.
// Run: HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=<block >= 26107296> MAINNET_RPC_URL=<rpc> npm run test:commitment-v2-fork
import { expect } from "chai";
import { createRequire } from "node:module";
import { ethers, connection } from "../helpers/hardhat.js";

const require = createRequire(import.meta.url);
const { build, V2, CV01_PROPOSAL_ID } = require("../../scripts/commitment-vault-v2-proposal.cjs");

const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const LIQUIDITY_RESERVE = "0xdc0309804803b3A105154f6073061E3185018f64"; // fee-exempt IFR source for the fork only
const V2_DEPLOY_BLOCK = 26107296;
const TIME_ONLY = 0, PRICE_ONLY = 1, TIME_OR_PRICE = 2, TIME_AND_PRICE = 3;
const parse = (s) => ethers.parseUnits(s, 9);

async function impersonate(address) {
  await connection.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  await connection.provider.request({ method: "hardhat_setBalance", params: [address, "0xde0b6b3a7640000"] });
  return ethers.getSigner(address);
}

describe("Deployed CommitmentVault V2 on a Mainnet fork", function () {
  this.timeout(300_000);
  let token, governance, safe, v2, user;

  before(async function () {
    if (process.env.HARDHAT_FORK !== "true") this.skip();
    const forkBlock = Number(process.env.HARDHAT_FORK_BLOCK_NUMBER || 0);
    expect(forkBlock, "fork block must be at or after the V2 deployment").to.be.at.least(V2_DEPLOY_BLOCK);
    expect(await ethers.provider.getCode(V2), "deployed V2 bytecode must exist at the pinned address").to.not.equal("0x");
    token = await ethers.getContractAt(
      ["function feeExempt(address) view returns (bool)", "function owner() view returns (address)",
       "function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"],
      IFR_TOKEN
    );
    governance = await ethers.getContractAt(
      ["function owner() view returns (address)", "function getProposal(uint256) view returns (address,bytes,uint256,bool,bool)"],
      GOVERNANCE
    );
    expect(await token.owner()).to.equal(GOVERNANCE);
    safe = await impersonate(await governance.owner());
    [user] = await ethers.getSigners();
    v2 = await ethers.getContractAt("CommitmentVault", V2);
    const reserve = await impersonate(LIQUIDITY_RESERVE);
    await token.connect(reserve).transfer(user.address, parse("50000"));
  });

  it("deployed V2 is owned by Governance and has no P0 or oracle", async () => {
    expect(await v2.owner()).to.equal(GOVERNANCE);
    expect(await v2.ifrToken()).to.equal(IFR_TOKEN);
    expect(await v2.p0Set()).to.equal(false);
    expect(await v2.priceOracle()).to.equal(ethers.ZeroAddress);
  });

  it("price-conditioned locks are rejected by the deployed bytecode", async () => {
    const latest = await ethers.provider.getBlock("latest");
    await token.connect(user).approve(V2, parse("4000"));
    for (const cType of [PRICE_ONLY, TIME_OR_PRICE, TIME_AND_PRICE]) {
      await expect(v2.connect(user).lock(parse("1000"), cType, latest.timestamp + 86400, 5000)).to.be.revertedWith("price conditions disabled");
    }
  });

  it("queued proposal #17 executes with the exact generated step-2 bytes (or is already executed)", async () => {
    const [target, data, eta, executed, cancelled] = await governance.getProposal(CV01_PROPOSAL_ID);
    const { inner, files } = build(V2, String(CV01_PROPOSAL_ID));
    expect(target).to.equal(IFR_TOKEN);
    expect(data).to.equal(inner);
    expect(cancelled).to.equal(false);
    if (executed) {
      expect(await token.feeExempt(V2)).to.equal(true);
      return;
    }
    const step2 = files["cv01-v2-step2-execute.json"].transactions[0];
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    if (now < Number(eta)) {
      await expect(safe.sendTransaction({ to: step2.to, data: step2.data, gasLimit: 500_000 })).to.be.revertedWith("too early");
      await connection.provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(eta) + 1] });
      await connection.provider.request({ method: "evm_mine", params: [] });
    }
    await safe.sendTransaction({ to: step2.to, data: step2.data, gasLimit: 500_000 });
    expect(await token.feeExempt(V2)).to.equal(true);
  });

  it("a TIME_ONLY lock credits exactly its amount and returns it after the unlock time", async () => {
    const amount = parse("12000");
    const vaultBefore = await token.balanceOf(V2);
    const lockedBefore = await v2.totalLocked();
    const userLockedBefore = await v2.lockedBalance(user.address);
    const latest = await ethers.provider.getBlock("latest");
    await token.connect(user).approve(V2, amount);
    await v2.connect(user).lock(amount, TIME_ONLY, latest.timestamp + 30 * 86400, 0);
    const trancheId = (await v2.getTrancheCount(user.address)) - 1n;
    expect((await token.balanceOf(V2)) - vaultBefore).to.equal(amount);
    expect((await v2.totalLocked()) - lockedBefore).to.equal(amount);
    expect((await v2.lockedBalance(user.address)) - userLockedBefore).to.equal(amount);
    await expect(v2.connect(user).unlock(user.address, trancheId)).to.be.revertedWith("condition not met");
    await connection.provider.request({ method: "evm_increaseTime", params: [30 * 86400] });
    await connection.provider.request({ method: "evm_mine", params: [] });
    const userBefore = await token.balanceOf(user.address);
    await v2.connect(user).unlock(user.address, trancheId);
    expect((await token.balanceOf(user.address)) - userBefore).to.equal(amount);
    expect(await v2.totalLocked()).to.equal(lockedBefore);
  });
});
