// CWA-06 voucher-signer rotation rehearsal on a Mainnet fork: the Treasury Safe executes the exact bytes of the
// production step 2 file against the already queued Governance proposal 18 (no new proposal is created).
// Run: HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=<block >= 26119897, before execution> MAINNET_RPC_URL=<rpc> \
//      npx hardhat test test/fork/VoucherSignerRotationFork.test.js
import { expect } from "chai";
import { createRequire } from "node:module";
import { ethers, connection } from "../helpers/hardhat.js";

const require = createRequire(import.meta.url);
const { build, checkQueued, QUEUED, FEE_ROUTER, GOVERNANCE } = require("../../scripts/voucher-signer-rotation-proposal.cjs");

describe("FeeRouterV1 voucher-signer rotation on a Mainnet fork", function () {
  this.timeout(300_000);

  before(function () {
    if (process.env.HARDHAT_FORK !== "true") this.skip();
  });

  it("executes the queued proposal 18 with the generated step 2 bytes after its ETA", async () => {
    const governance = await ethers.getContractAt(
      ["function owner() view returns (address)", "function proposalCount() view returns (uint256)",
       "function getProposal(uint256) view returns (address,bytes,uint256,bool,bool)"],
      GOVERNANCE
    );
    const router = await ethers.getContractAt(["function voucherSigner() view returns (address)"], FEE_ROUTER);
    checkQueued(await governance.getProposal(QUEUED.id));
    const countBefore = await governance.proposalCount();
    expect(countBefore > QUEUED.id).to.equal(true);
    expect(await router.voucherSigner()).to.not.equal(QUEUED.signer);

    const safeAddress = await governance.owner();
    await connection.provider.request({ method: "hardhat_impersonateAccount", params: [safeAddress] });
    await connection.provider.request({ method: "hardhat_setBalance", params: [safeAddress, "0xde0b6b3a7640000"] });
    const safe = await ethers.getSigner(safeAddress);
    const step2 = build(QUEUED.signer, QUEUED.id).files["cwa06-voucher-step2-execute.json"].transactions[0];

    const latest = await ethers.provider.getBlock("latest");
    if (BigInt(latest.timestamp) < QUEUED.eta) {
      await expect(safe.sendTransaction({ to: step2.to, data: step2.data, gasLimit: 500_000 })).to.be.revertedWith("too early");
      await connection.provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(QUEUED.eta) + 1] });
      await connection.provider.request({ method: "evm_mine", params: [] });
    }
    await safe.sendTransaction({ to: step2.to, data: step2.data, gasLimit: 500_000 });

    expect(await router.voucherSigner()).to.equal(QUEUED.signer);
    const [, , , executed, cancelled] = await governance.getProposal(QUEUED.id);
    expect(executed).to.equal(true);
    expect(cancelled).to.equal(false);
    expect(await governance.proposalCount()).to.equal(countBefore);
    await expect(safe.sendTransaction({ to: step2.to, data: step2.data, gasLimit: 500_000 })).to.be.revertedWith("already executed");
  });
});
