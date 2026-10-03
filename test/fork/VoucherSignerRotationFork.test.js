// CWA-06 voucher-signer rotation rehearsal on a Mainnet fork: the Treasury Safe executes the exact
// bytes of the generated Safe batch files against the deployed Governance and FeeRouterV1.
// Run: HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=<recent block> MAINNET_RPC_URL=<rpc> npx hardhat test test/fork/VoucherSignerRotationFork.test.js
import { expect } from "chai";
import { createRequire } from "node:module";
import { ethers, connection } from "../helpers/hardhat.js";

const require = createRequire(import.meta.url);
const { build, FEE_ROUTER, GOVERNANCE } = require("../../scripts/voucher-signer-rotation-proposal.cjs");

describe("FeeRouterV1 voucher-signer rotation on a Mainnet fork", function () {
  this.timeout(300_000);

  before(function () {
    if (process.env.HARDHAT_FORK !== "true") this.skip();
  });

  it("propose -> refused early execute -> execute after the delay sets the new signer", async () => {
    const governance = await ethers.getContractAt(
      ["function owner() view returns (address)", "function proposalCount() view returns (uint256)",
       "function getProposal(uint256) view returns (address,bytes,uint256,bool,bool)"],
      GOVERNANCE
    );
    const router = await ethers.getContractAt(["function voucherSigner() view returns (address)"], FEE_ROUTER);
    const safeAddress = await governance.owner();
    await connection.provider.request({ method: "hardhat_impersonateAccount", params: [safeAddress] });
    await connection.provider.request({ method: "hardhat_setBalance", params: [safeAddress, "0xde0b6b3a7640000"] });
    const safe = await ethers.getSigner(safeAddress);

    const fresh = ethers.Wallet.createRandom().address;
    const id = await governance.proposalCount();
    const { files } = build(fresh, id.toString());
    const step1 = files["cwa06-voucher-step1-propose.json"].transactions[0];
    const step2 = files["cwa06-voucher-step2-execute.json"].transactions[0];

    await safe.sendTransaction({ to: step1.to, data: step1.data });
    await expect(safe.sendTransaction({ to: step2.to, data: step2.data, gasLimit: 500_000 })).to.be.revertedWith("too early");
    const [, , eta] = await governance.getProposal(id);
    await connection.provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(eta) + 1] });
    await connection.provider.request({ method: "evm_mine", params: [] });
    await safe.sendTransaction({ to: step2.to, data: step2.data, gasLimit: 500_000 });
    expect(await router.voucherSigner()).to.equal(fresh);
  });
});
