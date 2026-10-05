// PriceLockVault against the real IFR/WETH pair on a Mainnet fork (read-only for the pair).
// Run: HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=<recent block> MAINNET_RPC_URL=<rpc> npx hardhat test test/fork/PriceLockVaultFork.test.js
import { expect } from "chai";
import { ethers, connection } from "../helpers/hardhat.js";

const IFR = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const PAIR = "0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0";
const GOVERNANCE = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const WEEK = 7 * 86400;

describe("PriceLockVault on a Mainnet fork", function () {
  this.timeout(300_000);
  before(function () {
    if (process.env.HARDHAT_FORK !== "true") this.skip();
  });

  it("reads the real pair, computes a TWAP equal to the idle spot price and keeps price locks disabled below the scope", async () => {
    const pair = await ethers.getContractAt(
      ["function getReserves() view returns (uint112,uint112,uint32)", "function token0() view returns (address)"], PAIR);
    const Vault = await ethers.getContractFactory("PriceLockVault");
    const vault = await Vault.deploy(IFR, WETH, FACTORY, GOVERNANCE, WEEK, ethers.parseEther("50"), 0);
    expect(await vault.pair()).to.equal(PAIR); // taken from the canonical Uniswap V2 factory
    expect(await vault.ifrIsToken0()).to.equal((await pair.token0()) === IFR);

    const [r0, r1] = await pair.getReserves();
    const [ifrRes, wethRes] = (await vault.ifrIsToken0()) ? [r0, r1] : [r1, r0];
    const spot = (wethRes * 10n ** 9n) / ifrRes;

    await vault.poke();
    await connection.provider.request({ method: "evm_increaseTime", params: [WEEK] });
    await connection.provider.request({ method: "evm_mine", params: [] });
    const [valid, price] = await vault.twap();
    expect(valid).to.equal(true);
    expect(price).to.be.closeTo(spot, spot / 1000n); // no trades on the fork: TWAP equals spot

    const r = await vault.readiness();
    expect(r.wethReserve).to.equal(wethRes);
    expect(r.ready).to.equal(wethRes >= ethers.parseEther("50"));

    await connection.provider.request({ method: "hardhat_impersonateAccount", params: [GOVERNANCE] });
    await connection.provider.request({ method: "hardhat_setBalance", params: [GOVERNANCE, "0xde0b6b3a7640000"] });
    const gov = await ethers.getSigner(GOVERNANCE);
    if (!r.ready) await expect(vault.connect(gov).activate()).to.be.revertedWith("readiness scope not met");
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await expect(vault.lock(1n, 1n, 0, now + 30 * 86400)).to.be.revertedWith("price locks not active");
  });
});
