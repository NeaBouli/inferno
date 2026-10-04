// CWA-09 guardian migration rehearsal on a Mainnet fork: the Treasury Safe and the deployer execute the
// exact transactions from scripts/guardian-migration-proposal.cjs against the deployed contracts.
// The live migration started in block 26108025, so the rehearsal is pinned to exactly the block before it.
// Run: HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=26108024 MAINNET_RPC_URL=<archive rpc> npx hardhat test test/fork/GuardianMigrationFork.test.js
import { expect } from "chai";
import { createRequire } from "node:module";
import { ethers, connection } from "../helpers/hardhat.js";

const require = createRequire(import.meta.url);
const { build, C, IMMUTABLE, TREASURY_SAFE, DEPLOYER } = require("../../scripts/guardian-migration-proposal.cjs");

async function impersonate(address) {
  await connection.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  await connection.provider.request({ method: "hardhat_setBalance", params: [address, "0xde0b6b3a7640000"] });
  return ethers.getSigner(address);
}
const PRE_MIGRATION_BLOCK = 26108024; // last Mainnet block before the live guardian migration
const guardianOf = async (address) => (await ethers.getContractAt(["function guardian() view returns (address)"], address)).guardian();

describe("Guardian migration to the Treasury Safe on a Mainnet fork", function () {
  this.timeout(300_000);
  before(async function () {
    if (process.env.HARDHAT_FORK !== "true") this.skip();
    const block = await ethers.provider.getBlockNumber();
    expect(block, `fork must start at exactly PRE_MIGRATION_BLOCK ${PRE_MIGRATION_BLOCK}`).to.equal(PRE_MIGRATION_BLOCK);
  });

  it("moves every changeable guardian to the Treasury Safe; buyback guardians stay immutable", async () => {
    const governance = await ethers.getContractAt(
      ["function owner() view returns (address)", "function proposalCount() view returns (uint256)",
       "function getProposal(uint256) view returns (address,bytes,uint256,bool,bool)"], C.Governance);
    expect(await governance.owner()).to.equal(TREASURY_SAFE);
    const safe = await impersonate(TREASURY_SAFE);
    const deployer = await impersonate(DEPLOYER);
    for (const address of Object.values(C)) expect(await guardianOf(address)).to.equal(DEPLOYER);

    const id0 = await governance.proposalCount();
    const files = build(id0.toString());
    for (const t of files["guardian-deployer-txs.json"].transactions) await deployer.sendTransaction({ to: t.to, data: t.data });
    for (const t of files["guardian-step1-safe.json"].transactions) await safe.sendTransaction({ to: t.to, data: t.data });
    expect(await guardianOf(C.Governance)).to.equal(TREASURY_SAFE);
    expect(await guardianOf(C.LiquidityReserve)).to.equal(DEPLOYER);

    const [, , eta] = await governance.getProposal(id0 + 1n);
    await connection.provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(eta) + 1] });
    await connection.provider.request({ method: "evm_mine", params: [] });
    for (const t of files["guardian-step2-execute.json"].transactions) await safe.sendTransaction({ to: t.to, data: t.data, gasLimit: 500_000 });

    for (const address of Object.values(C)) expect(await guardianOf(address)).to.equal(TREASURY_SAFE);
    for (const address of Object.values(IMMUTABLE)) expect(await guardianOf(address)).to.equal(DEPLOYER);

    // The Safe can now pause/unpause; the deployer no longer can.
    const lock = await ethers.getContractAt(["function pause()", "function unpause()", "function paused() view returns (bool)"], C.IFRLock);
    await expect(lock.connect(deployer).pause()).to.be.revertedWith("not guardian");
    await lock.connect(safe).pause();
    expect(await lock.paused()).to.equal(true);
    await lock.connect(safe).unpause();
    expect(await lock.paused()).to.equal(false);
  });
});
