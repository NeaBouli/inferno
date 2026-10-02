// ifr-benefits-verify/1 vectors on a Mainnet fork against the deployed IFRLock and CommitmentVault.
// Run: HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=26100144 MAINNET_RPC_URL=<archive RPC> npm run test:benefits-fork
// (or any recent block with a public RPC).
// Everything happens on the local fork; nothing is sent to Mainnet.
import { expect } from "chai";
import { createRequire } from "node:module";
import { ethers, connection } from "../helpers/hardhat.js";

const require = createRequire(import.meta.url);
const { verifyIfrBenefit, CONTRACTS, tierForAmount } = require("../../apps/benefits-verify/dist/index.js");

// Pinned vector block (needs an archive RPC); CI without an archive secret forks a recent block instead.
const PINNED_BLOCK = 26100144n;
const PINNED_BLOCK_HASH = "0x7afc9cb2e9315eac578a3e419c06131b672c6deb72b40d12821e190763ce2598";
const FORK_BLOCK = BigInt(process.env.HARDHAT_FORK_BLOCK_NUMBER || PINNED_BLOCK);
let FORK_BLOCK_HASH;
// Fee-exempt Mainnet holder used only on the fork to fund the test wallet.
const LIQUIDITY_RESERVE = "0xdc0309804803b3A105154f6073061E3185018f64";
const TIME_ONLY = 0;
const parse = (s) => ethers.parseUnits(s, 9);

describe("ifr-benefits-verify/1 on a Mainnet fork (deployed contracts)", function () {
  this.timeout(180_000);
  const mainnet = CONTRACTS[1];
  let chainId, token, lock, vault, holder;

  const verify = (extra = {}) =>
    verifyIfrBenefit({
      wallet: holder.address,
      chainId,
      rpc: connection.provider,
      contracts: mainnet,
      allowTestChain: chainId !== 1,
      ...extra,
    });

  before(async function () {
    if (process.env.HARDHAT_FORK !== "true") this.skip();
    FORK_BLOCK_HASH = (await ethers.provider.getBlock(Number(FORK_BLOCK))).hash;
    if (FORK_BLOCK === PINNED_BLOCK) expect(FORK_BLOCK_HASH).to.equal(PINNED_BLOCK_HASH);
    chainId = Number((await ethers.provider.getNetwork()).chainId);
    token = await ethers.getContractAt(
      ["function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"],
      mainnet.token
    );
    lock = await ethers.getContractAt(
      ["function lock(uint256)", "function unlock()", "function lockedBalance(address) view returns (uint256)"],
      mainnet.ifrLock
    );
    vault = await ethers.getContractAt(["function lock(uint256,uint8,uint256,uint256)"], mainnet.commitmentVault);

    [holder] = await ethers.getSigners();
    await connection.provider.request({ method: "hardhat_impersonateAccount", params: [LIQUIDITY_RESERVE] });
    await connection.provider.request({ method: "hardhat_setBalance", params: [LIQUIDITY_RESERVE, "0xde0b6b3a7640000"] });
    const reserve = await ethers.getSigner(LIQUIDITY_RESERVE);
    await token.connect(reserve).transfer(holder.address, parse("20000"));
    await connection.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [LIQUIDITY_RESERVE] });
  });

  it("the fork block resolves with its real Mainnet hash; the fresh wallet has no tier there", async () => {
    const atFork = await verify({ block: { number: FORK_BLOCK, hash: FORK_BLOCK_HASH }, source: "EITHER" });
    expect(atFork.block.number).to.equal(FORK_BLOCK);
    expect(atFork.tier).to.equal(null);
  });

  it("lock → tier, more lock → higher tier, unlock → no tier; the earlier block stays reproducible", async () => {
    await token.connect(holder).approve(mainnet.ifrLock, parse("5500"));
    await lock.connect(holder).lock(parse("3000"));
    const silver = await verify();
    expect(silver.tier).to.equal("SILVER");
    expect(tierForAmount(await lock.lockedBalance(holder.address))).to.equal("SILVER");

    await lock.connect(holder).lock(parse("2500"));
    expect((await verify()).tier).to.equal("GOLD");

    await lock.connect(holder).unlock();
    const after = await verify();
    expect(after.tier).to.equal(null);
    expect(after.block.number > silver.block.number).to.equal(true);
    expect((await verify({ block: silver.block })).tier).to.equal("SILVER");
  });

  it("TIME_ONLY tranche in the deployed CommitmentVault counts; EITHER does not add sources", async () => {
    const latest = await ethers.provider.getBlock("latest");
    await token.connect(holder).approve(mainnet.commitmentVault, parse("1500"));
    await vault.connect(holder).lock(parse("1500"), TIME_ONLY, latest.timestamp + 30 * 86400, 0);
    await token.connect(holder).approve(mainnet.ifrLock, parse("1500"));
    await lock.connect(holder).lock(parse("1500"));

    expect((await verify({ source: "COMMITMENT_TIME_ONLY" })).tier).to.equal("BRONZE");
    expect((await verify({ source: "IFRLOCK" })).tier).to.equal("BRONZE");
    const either = await verify({ source: "EITHER" });
    expect(either.tier).to.equal("BRONZE"); // 1,500 + 1,500 must not become SILVER
    expect(either.sources).to.deep.equal({ IFRLOCK: "BRONZE", COMMITMENT_TIME_ONLY: "BRONZE" });
  });

  it("price-conditioned tranches on the deployed vault never count", async () => {
    // The deployed vault accepts TIME_OR_PRICE tranches (the repository source rejects them);
    // ifr-benefits-verify/1 must ignore them either way.
    const latest = await ethers.provider.getBlock("latest");
    const before = (await verify({ source: "COMMITMENT_TIME_ONLY" })).tier;
    await token.connect(holder).approve(mainnet.commitmentVault, parse("9500"));
    await vault.connect(holder).lock(parse("9000"), 2, latest.timestamp + 30 * 86400, 200); // TIME_OR_PRICE
    await vault.connect(holder).lock(parse("500"), 1, 0, 200); // PRICE_ONLY: accepted by V1, can never unlock (oracle = 0)
    expect((await verify({ source: "COMMITMENT_TIME_ONLY" })).tier).to.equal(before);
    expect((await verify({ source: "EITHER" })).tier).to.equal("BRONZE");
  });
});
