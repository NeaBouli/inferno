// Lane 3 decision B rehearsal on a Mainnet fork (CWA-02): the Treasury Safe executes the exact Safe batch
// bytes; afterwards the 1% IFR pool fee reaches BuybackController instead of FeeRouterV1, a large IFR
// balance cannot block BuybackController.execute(), and Governance can recover IFR via withdrawIFR.
// Run: HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=<recent block> MAINNET_RPC_URL=<rpc> npx hardhat test test/fork/PoolFeeReceiverFork.test.js
import { expect } from "chai";
import { createRequire } from "node:module";
import { ethers, connection } from "../helpers/hardhat.js";

const require = createRequire(import.meta.url);
const { build, IFR_TOKEN, GOVERNANCE, BUYBACK_CONTROLLER, FEE_ROUTER_V1 } = require("../../scripts/pool-fee-receiver-proposal.cjs");
const LIQUIDITY_RESERVE = "0xdc0309804803b3A105154f6073061E3185018f64"; // fee-exempt IFR source, fork only
const parse = (s) => ethers.parseUnits(s, 9);

async function impersonate(address) {
  await connection.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  await connection.provider.request({ method: "hardhat_setBalance", params: [address, "0x56bc75e2d63100000"] });
  return ethers.getSigner(address);
}

describe("Pool fee receiver -> BuybackController on a Mainnet fork", function () {
  this.timeout(300_000);
  before(function () {
    if (process.env.HARDHAT_FORK !== "true") this.skip();
  });

  it("routes future pool fees to BuybackController; execute() still works; Governance can withdraw", async () => {
    const token = await ethers.getContractAt(
      ["function poolFeeReceiver() view returns (address)", "function balanceOf(address) view returns (uint256)",
       "function transfer(address,uint256) returns (bool)", "function poolFeeBps() view returns (uint256)"], IFR_TOKEN);
    const governance = await ethers.getContractAt(
      ["function owner() view returns (address)", "function proposalCount() view returns (uint256)",
       "function getProposal(uint256) view returns (address,bytes,uint256,bool,bool)"], GOVERNANCE);
    const controller = await ethers.getContractAt(
      ["function execute()", "function cooldown() view returns (uint256)", "function lastExecution() view returns (uint256)",
       "function minTriggerAmount() view returns (uint256)", "function paused() view returns (bool)",
       "function withdrawIFR(address,uint256)"], BUYBACK_CONTROLLER);
    expect(await token.poolFeeReceiver()).to.equal(FEE_ROUTER_V1);

    const safe = await impersonate(await governance.owner());
    const id = await governance.proposalCount();
    const files = build(id.toString());
    const step1 = files["lane3-poolfee-step1-propose.json"].transactions[0];
    const step2 = files["lane3-poolfee-step2-execute.json"].transactions[0];
    await safe.sendTransaction({ to: step1.to, data: step1.data });
    const [, , eta] = await governance.getProposal(id);
    await connection.provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(eta) + 1] });
    await connection.provider.request({ method: "evm_mine", params: [] });
    await safe.sendTransaction({ to: step2.to, data: step2.data, gasLimit: 500_000 });
    expect(await token.poolFeeReceiver()).to.equal(BUYBACK_CONTROLLER);

    // A non-exempt transfer now pays the pool fee to BuybackController; FeeRouterV1 stops growing.
    const [alice, bob] = await ethers.getSigners();
    const reserve = await impersonate(LIQUIDITY_RESERVE);
    await token.connect(reserve).transfer(alice.address, parse("1000000"));
    const routerBefore = await token.balanceOf(FEE_ROUTER_V1);
    const controllerBefore = await token.balanceOf(BUYBACK_CONTROLLER);
    await token.connect(alice).transfer(bob.address, parse("500000"));
    const fee = (parse("500000") * (await token.poolFeeBps())) / 10_000n;
    expect((await token.balanceOf(BUYBACK_CONTROLLER)) - controllerBefore).to.equal(fee);
    expect(await token.balanceOf(FEE_ROUTER_V1)).to.equal(routerBefore);

    // A large IFR balance must not block the permissionless buyback cycle (LP failure falls back to burn).
    if (!(await controller.paused())) {
      const funder = await impersonate("0x000000000000000000000000000000000000dEaD");
      const trigger = await controller.minTriggerAmount();
      await funder.sendTransaction({ to: BUYBACK_CONTROLLER, value: trigger > 0n ? trigger : ethers.parseEther("0.01") });
      const wait = Number((await controller.lastExecution()) + (await controller.cooldown()));
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      if (wait > now) {
        await connection.provider.request({ method: "evm_setNextBlockTimestamp", params: [wait + 1] });
        await connection.provider.request({ method: "evm_mine", params: [] });
      }
      await controller.connect(bob).execute();
    }

    // Governance (owner) can recover accrued IFR.
    const gov = await impersonate(GOVERNANCE);
    const held = await token.balanceOf(BUYBACK_CONTROLLER);
    expect(held).to.be.greaterThan(0n);
    await controller.connect(gov).withdrawIFR(LIQUIDITY_RESERVE, held);
    expect(await token.balanceOf(BUYBACK_CONTROLLER)).to.equal(0n);
  });
});
