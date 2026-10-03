// Live conformance checks against Ethereum Mainnet and Sepolia (spec §2, §5, §8).
// Runs only when MAINNET_RPC_URL / SEPOLIA_RPC_URL are set (CI secrets); skipped otherwise.
const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyIfrBenefit, IfrBenefitVerifyError, SPEC_ID_V2, CONTRACTS } = require("../dist");

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

test("mainnet /2: CommitmentVault V1 and V2 are both identity-checked and read at one pinned block", { skip: !process.env.MAINNET_RPC_URL && "mainnet RPC not configured" }, async () => {
  const url = process.env.MAINNET_RPC_URL;
  const head = await verifyIfrBenefit({ wallet: ZERO_HOLDER, chainId: 1, rpc: url });
  for (const source of ["COMMITMENT_TIME_ONLY", "EITHER"]) {
    const result = await verifyIfrBenefit({
      wallet: ZERO_HOLDER,
      chainId: 1,
      rpc: url,
      source,
      spec: SPEC_ID_V2,
      block: { number: head.block.number, hash: head.block.hash },
    });
    assert.deepEqual(result.block, head.block);
    assert.deepEqual(result.commitmentVaults, [...CONTRACTS[1].commitmentVaults]);
    assert.equal(result.tier, null, `${source}: the burn address holds no lock`);
  }
  // A wallet with real V1 tranches: price-conditioned tranches never count, so /2 is never below /1.
  const holder = "0xf556cCe85128c93AC6A7e088cF334180F2D3905B";
  const v1 = await verifyIfrBenefit({ wallet: holder, chainId: 1, rpc: url, source: "COMMITMENT_TIME_ONLY", block: { number: head.block.number, hash: head.block.hash } });
  const v2 = await verifyIfrBenefit({ wallet: holder, chainId: 1, rpc: url, source: "COMMITMENT_TIME_ONLY", spec: SPEC_ID_V2, block: { number: head.block.number, hash: head.block.hash } });
  const rank = (t) => ["BRONZE", "SILVER", "GOLD", "PLATINUM"].indexOf(t);
  assert.ok(rank(v2.tier) >= rank(v1.tier), `/2 (${v2.tier}) must not be below /1 (${v1.tier})`);
});
