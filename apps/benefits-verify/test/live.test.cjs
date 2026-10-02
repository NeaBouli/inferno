// Live conformance checks against Ethereum Mainnet and Sepolia (spec §2, §5, §8).
// Runs only when MAINNET_RPC_URL / SEPOLIA_RPC_URL are set (CI secrets); skipped otherwise.
const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyIfrBenefit, IfrBenefitVerifyError } = require("../dist");

const ZERO_HOLDER = "0x000000000000000000000000000000000000dEaD";
const networks = [
  { name: "mainnet", chainId: 1, url: process.env.MAINNET_RPC_URL, sources: ["IFRLOCK", "COMMITMENT_TIME_ONLY", "EITHER"] },
  { name: "sepolia", chainId: 11155111, url: process.env.SEPOLIA_RPC_URL, sources: ["IFRLOCK"] },
];

for (const net of networks) {
  test(`${net.name}: contract identity holds at a pinned block for every source`, { skip: !net.url && `${net.name} RPC not configured` }, async () => {
    const first = await verifyIfrBenefit({ wallet: ZERO_HOLDER, chainId: net.chainId, rpc: net.url });
    assert.ok(first.block.number > 0n);
    assert.match(first.block.hash, /^0x[0-9a-f]{64}$/);
    for (const source of net.sources) {
      const pinned = await verifyIfrBenefit({
        wallet: ZERO_HOLDER,
        chainId: net.chainId,
        rpc: net.url,
        source,
        block: { number: first.block.number, hash: first.block.hash },
      });
      assert.deepEqual(pinned.block, first.block, `${source} must read the pinned block`);
      assert.equal(pinned.tier, null, `${source}: the burn address holds no lock`);
    }
  });

  test(`${net.name}: a wrong block hash and a wrong chain id fail closed`, { skip: !net.url && `${net.name} RPC not configured` }, async () => {
    const head = await verifyIfrBenefit({ wallet: ZERO_HOLDER, chainId: net.chainId, rpc: net.url });
    await assert.rejects(
      verifyIfrBenefit({ wallet: ZERO_HOLDER, chainId: net.chainId, rpc: net.url, block: { number: head.block.number, hash: "0x" + "00".repeat(32) } }),
      (e) => e instanceof IfrBenefitVerifyError && e.code === "BLOCK_MISMATCH"
    );
    const otherChain = net.chainId === 1 ? 11155111 : 1;
    await assert.rejects(
      verifyIfrBenefit({ wallet: ZERO_HOLDER, chainId: otherChain, rpc: net.url }),
      (e) => e instanceof IfrBenefitVerifyError && e.code === "WRONG_CHAIN"
    );
  });
}
