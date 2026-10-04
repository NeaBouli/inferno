// SYNTHETIC rehearsal (repository bytecode, NOT the deployed V2): deploys the repository CommitmentVault at a
// fresh fork address with Governance as owner and runs Safe -> Governance -> setFeeExempt with the on-chain delay.
// It proves the source and the governance flow on any recent fork block; it does not test the deployed V2
// (that is CommitmentVaultV2Fork.test.js). The CV-01 Safe batch generator is pinned to the deployed V2 and
// proposal #17, so this rehearsal encodes its own calldata.
// Run: HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=<recent block> MAINNET_RPC_URL=<rpc> npm run test:commitment-v2-synthetic-fork
import { expect } from "chai";
import { ethers, connection } from "../helpers/hardhat.js";

const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const LIQUIDITY_RESERVE = "0xdc0309804803b3A105154f6073061E3185018f64";
const TIME_ONLY = 0, PRICE_ONLY = 1, TIME_OR_PRICE = 2, TIME_AND_PRICE = 3;
const parse = (s) => ethers.parseUnits(s, 9);
const tokenIface = new ethers.Interface(["function setFeeExempt(address,bool)"]);
const govIface = new ethers.Interface(["function propose(address,bytes)", "function execute(uint256)"]);

async function impersonate(address) {
  await connection.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  await connection.provider.request({ method: "hardhat_setBalance", params: [address, "0xde0b6b3a7640000"] });
  return ethers.getSigner(address);
}

describe("Synthetic CommitmentVault V2 rehearsal (repository bytecode, not the deployed V2)", function () {
  this.timeout(300_000);
  let token, governance, safe, vault, user;

  before(async function () {
    if (process.env.HARDHAT_FORK !== "true") this.skip();
    token = await ethers.getContractAt(
      ["function feeExempt(address) view returns (bool)", "function transfer(address,uint256) returns (bool)",
       "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"],
      IFR_TOKEN
    );
    governance = await ethers.getContractAt(
      ["function owner() view returns (address)", "function delay() view returns (uint256)", "function proposalCount() view returns (uint256)",
       "function getProposal(uint256) view returns (address,bytes,uint256,bool,bool)"],
      GOVERNANCE
    );
    safe = await impersonate(await governance.owner());
    [user] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("CommitmentVault");
    vault = await Vault.deploy(IFR_TOKEN, GOVERNANCE);
    await vault.waitForDeployment();
    const reserve = await impersonate(LIQUIDITY_RESERVE);
    await token.connect(reserve).transfer(user.address, parse("50000"));
  });

  it("repository vault rejects price-conditioned locks", async () => {
    const latest = await ethers.provider.getBlock("latest");
    await token.connect(user).approve(vault.target, parse("4000"));
    for (const cType of [PRICE_ONLY, TIME_OR_PRICE, TIME_AND_PRICE]) {
      await expect(vault.connect(user).lock(parse("1000"), cType, latest.timestamp + 86400, 5000)).to.be.revertedWith("price conditions disabled");
    }
  });

  it("Safe -> Governance -> setFeeExempt executes only after the on-chain delay", async () => {
    const id = await governance.proposalCount();
    const inner = tokenIface.encodeFunctionData("setFeeExempt", [vault.target, true]);
    await safe.sendTransaction({ to: GOVERNANCE, data: govIface.encodeFunctionData("propose", [IFR_TOKEN, inner]) });
    const execData = govIface.encodeFunctionData("execute", [id]);
    await expect(safe.sendTransaction({ to: GOVERNANCE, data: execData, gasLimit: 500_000 })).to.be.revertedWith("too early");
    const [, , eta] = await governance.getProposal(id);
    await connection.provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(eta) + 1] });
    await connection.provider.request({ method: "evm_mine", params: [] });
    await safe.sendTransaction({ to: GOVERNANCE, data: execData, gasLimit: 500_000 });
    expect(await token.feeExempt(vault.target)).to.equal(true);
  });

  it("a TIME_ONLY lock credits exactly its amount and returns it after the unlock time", async () => {
    const amount = parse("12000");
    const vaultBefore = await token.balanceOf(vault.target);
    const lockedBefore = await vault.totalLocked();
    const latest = await ethers.provider.getBlock("latest");
    await token.connect(user).approve(vault.target, amount);
    await vault.connect(user).lock(amount, TIME_ONLY, latest.timestamp + 30 * 86400, 0);
    const trancheId = (await vault.getTrancheCount(user.address)) - 1n;
    expect((await token.balanceOf(vault.target)) - vaultBefore).to.equal(amount);
    expect((await vault.totalLocked()) - lockedBefore).to.equal(amount);
    await connection.provider.request({ method: "evm_increaseTime", params: [30 * 86400] });
    await connection.provider.request({ method: "evm_mine", params: [] });
    const userBefore = await token.balanceOf(user.address);
    await vault.connect(user).unlock(user.address, trancheId);
    expect((await token.balanceOf(user.address)) - userBefore).to.equal(amount);
    expect(await vault.totalLocked()).to.equal(lockedBefore);
  });
});
