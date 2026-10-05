// ifr-benefits-verify/2 on a Mainnet fork against the deployed CommitmentVault V1 and V2.
// V2 receives a real TIME_ONLY lock on the fork; /2 counts it, /1 (V1 only) does not.
// The fee exemption of V2 (Governance proposal #17) is simulated on the fork by impersonating
// the token owner. Everything happens on the local fork; nothing is sent to Mainnet.
// Run: HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=<recent block> MAINNET_RPC_URL=<rpc> npx hardhat test test/fork/BenefitsVerifyV2Fork.test.js
import { expect } from "chai";
import { createRequire } from "node:module";
import { ethers, connection } from "../helpers/hardhat.js";

const require = createRequire(import.meta.url);
const { verifyIfrBenefit, CONTRACTS, SPEC_ID, SPEC_ID_V2 } = require("../../apps/benefits-verify/dist/index.js");

const LIQUIDITY_RESERVE = "0xdc0309804803b3A105154f6073061E3185018f64"; // fee-exempt IFR source, fork only
const parse = (s) => ethers.parseUnits(s, 9);

async function impersonate(address) {
  await connection.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  await connection.provider.request({ method: "hardhat_setBalance", params: [address, "0xde0b6b3a7640000"] });
  return ethers.getSigner(address);
}

describe("ifr-benefits-verify/2 on a Mainnet fork (CommitmentVault V1 + V2)", function () {
  this.timeout(180_000);
  const mainnet = CONTRACTS[1];
  const [V1, V2] = mainnet.commitmentVaults;
  let chainId, holder;

  const verify = (extra) =>
    verifyIfrBenefit({ wallet: holder.address, chainId, rpc: connection.provider, contracts: mainnet, allowTestChain: chainId !== 1, ...extra });

  before(async function () {
    if (process.env.HARDHAT_FORK !== "true") this.skip();
    chainId = Number((await ethers.provider.getNetwork()).chainId);
    const token = await ethers.getContractAt(
      ["function owner() view returns (address)", "function setFeeExempt(address,bool)", "function feeExempt(address) view returns (bool)",
       "function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)"],
      mainnet.token
    );
    for (const vault of [V1, V2]) {
      const v = await ethers.getContractAt(["function ifrToken() view returns (address)"], vault);
      expect(await v.ifrToken()).to.equal(mainnet.token);
    }
    if (!(await token.feeExempt(V2))) {
      const owner = await impersonate(await token.owner()); // Governance; mirrors executed proposal #17
      await token.connect(owner).setFeeExempt(V2, true);
    }
    [holder] = await ethers.getSigners();
    const reserve = await impersonate(LIQUIDITY_RESERVE);
    await token.connect(reserve).transfer(holder.address, parse("10000"));
    const v2 = await ethers.getContractAt(["function lock(uint256,uint8,uint256,uint256)"], V2);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await token.connect(holder).approve(V2, parse("6000"));
    await v2.connect(holder).lock(parse("6000"), 0, now + 30 * 86400, 0);
  });

  it("a real V2 TIME_ONLY lock counts under /2 and not under /1", async () => {
    const r2 = await verify({ source: "COMMITMENT_TIME_ONLY", spec: SPEC_ID_V2 });
    expect(r2.tier).to.equal("GOLD");
    expect(r2.commitmentVaults).to.deep.equal([V1, V2]);
    const r1 = await verify({ source: "COMMITMENT_TIME_ONLY", spec: SPEC_ID });
    expect(r1.tier).to.equal(null);
  });

  it("EITHER under /2 is the higher source and never adds IFRLock", async () => {
    const r = await verify({ source: "EITHER", spec: SPEC_ID_V2 });
    expect(r.sources.COMMITMENT_TIME_ONLY).to.equal("GOLD");
    expect(r.tier).to.equal("GOLD");
  });

  it("V2 rejects price-conditioned locks, so nothing price-based can enter the /2 sum", async () => {
    const v2 = await ethers.getContractAt(["function lock(uint256,uint8,uint256,uint256)"], V2);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    for (const cType of [1, 2, 3]) {
      await expect(v2.connect(holder).lock(parse("100"), cType, now + 86400, 5000)).to.be.revertedWith("price conditions disabled");
    }
  });
});
