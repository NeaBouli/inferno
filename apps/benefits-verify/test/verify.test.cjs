const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Interface, Wallet, AbiCoder, id } = require("ethers");
const lib = require("../dist");

const {
  CONTRACTS,
  TIER_FILE_V1,
  TIER_FILE_SHA256,
  TIERS_V1,
  parseTiers,
  tierForAmount,
  sumActiveTimeOnly,
  verifyIfrBenefit,
  buildBenefitMessage,
  parseBenefitMessage,
  verifyBenefitMessage,
  IfrBenefitVerifyError,
} = lib;

const IFR = 10n ** 9n;
const WALLET = "0xa11ce0000000000000000000000000000000beef";
const OTHER = "0x00000000000000000000000000000000000000B0";
const MAINNET = CONTRACTS[1];

const lockIface = new Interface([
  "function token() view returns (address)",
  "function isLocked(address user, uint256 minAmount) view returns (bool)",
]);
const tokenIface = new Interface(["function decimals() view returns (uint8)"]);
const vaultIface = new Interface([
  "function ifrToken() view returns (address)",
  "function getTranches(address wallet) view returns (tuple(uint256 amount,uint8 cType,uint256 unlockTime,uint256 p0Multiplier,bool unlocked,uint256 conditionMetAt)[])",
]);

/**
 * Fake EIP-1193 node. `blocks[n]` = { lock: {addr: amount}, tranches: {addr: [...]} }.
 * Records every isLocked minAmount so tests can assert `isLocked(x, 0)` never happens.
 */
function fakeNode({ chainId = 1, blocks, contracts = MAINNET, decimals = 9, lockToken, vaultToken, codeless = [], onCall }) {
  const calls = [];
  const head = Math.max(...Object.keys(blocks).map(Number));
  // `salt[n]` changes when block n is replaced by a reorg; the hash changes with it.
  const salt = {};
  const hashOf = (n) => "0x" + ((salt[n] ?? 0) * 1_000_000 + n).toString(16).padStart(64, "0");
  const tagToNumber = (tag) => {
    if (tag && typeof tag === "object") {
      // EIP-1898: resolve by hash; a hash that is no longer canonical is unknown.
      const n = Object.keys(blocks).map(Number).find((k) => hashOf(k) === String(tag.blockHash).toLowerCase());
      if (n === undefined) throw new Error("header not found");
      return n;
    }
    return tag === "latest" ? head : Number(BigInt(tag));
  };
  const reorg = (n, state) => {
    salt[n] = (salt[n] ?? 0) + 1;
    blocks[n] = state;
  };
  const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
  return {
    calls,
    hashOf,
    reorg,
    async request({ method, params }) {
      calls.push({ method, params });
      if (onCall) onCall({ method, params, calls, reorg });
      if (method === "eth_chainId") return "0x" + chainId.toString(16);
      if (method === "eth_getBlockByNumber") {
        const n = tagToNumber(params[0]);
        if (!(n in blocks)) return null;
        return { number: "0x" + n.toString(16), hash: hashOf(n) };
      }
      if (method === "eth_getCode") {
        tagToNumber(params[1]);
        return codeless.some((a) => same(a, params[0])) ? "0x" : "0x6080";
      }
      if (method === "eth_call") {
        const [{ to, data }, tag] = params;
        const state = blocks[tagToNumber(tag)];
        if (!state) throw new Error("unknown block");
        if (same(to, contracts.token)) return tokenIface.encodeFunctionResult("decimals", [decimals]);
        if (same(to, contracts.ifrLock)) {
          const tx = lockIface.parseTransaction({ data });
          if (tx.name === "token") return lockIface.encodeFunctionResult("token", [lockToken ?? contracts.token]);
          const [user, min] = tx.args;
          calls.push({ isLockedMin: min });
          const amount = BigInt(Object.entries(state.lock || {}).find(([a]) => same(a, user))?.[1] ?? 0n);
          return lockIface.encodeFunctionResult("isLocked", [amount >= min]);
        }
        if (contracts.commitmentVault && same(to, contracts.commitmentVault)) {
          const tx = vaultIface.parseTransaction({ data });
          if (tx.name === "ifrToken") return vaultIface.encodeFunctionResult("ifrToken", [vaultToken ?? contracts.token]);
          const user = tx.args[0];
          const list = Object.entries(state.tranches || {}).find(([a]) => same(a, user))?.[1] ?? [];
          return vaultIface.encodeFunctionResult("getTranches", [
            list.map((t) => [t.amount, t.cType, 0n, 0n, t.unlocked ?? false, 0n]),
          ]);
        }
        return "0x";
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

async function rejects(promise, code) {
  await assert.rejects(promise, (error) => error instanceof IfrBenefitVerifyError && error.code === code);
}

// ─── Tier data ──────────────────────────────────────────────────────────

test("published tier file matches the library copy and its pinned SHA-256", () => {
  for (const file of [
    path.join(__dirname, "../../../docs/specs/ifr-benefits-tiers.v1.json"),
    path.join(__dirname, "../tiers.v1.json"),
  ]) {
    const raw = fs.readFileSync(file);
    assert.equal(crypto.createHash("sha256").update(raw).digest("hex"), TIER_FILE_SHA256[1], file);
    assert.deepEqual(JSON.parse(raw), TIER_FILE_V1);
  }
  const spec = fs.readFileSync(path.join(__dirname, "../../../docs/specs/ifr-benefits-verify-1.md"), "utf8");
  assert.ok(spec.includes(TIER_FILE_SHA256[1]), "spec must list the tier file hash");
});

test("tier boundaries use >= and the highest tier wins", () => {
  assert.equal(tierForAmount(0n), null);
  assert.equal(tierForAmount(1000n * IFR - 1n), null);
  assert.equal(tierForAmount(1000n * IFR), "BRONZE");
  assert.equal(tierForAmount(2500n * IFR - 1n), "BRONZE");
  assert.equal(tierForAmount(2500n * IFR), "SILVER");
  assert.equal(tierForAmount(5000n * IFR), "GOLD");
  assert.equal(tierForAmount(10_000n * IFR), "PLATINUM");
  assert.equal(tierForAmount(10n ** 30n), "PLATINUM");
});

test("invalid tier data is rejected (min = 0, order, decimals, duplicates)", () => {
  const variant = (mutate) => {
    const copy = structuredClone(TIER_FILE_V1);
    mutate(copy);
    return () => parseTiers(copy);
  };
  const invalid = (fn) => assert.throws(fn, (e) => e.code === "INVALID_TIERS");
  invalid(variant((f) => { f.tiers[0].minIFR = "0"; f.tiers[0].minBaseUnits = "0"; }));
  invalid(variant((f) => { f.tiers[1].minBaseUnits = "2500"; }));
  invalid(variant((f) => { f.tiers.reverse(); }));
  invalid(variant((f) => { f.tiers[1].key = "BRONZE"; }));
  invalid(variant((f) => { f.decimals = 18; }));
  invalid(variant((f) => { f.tiers[0].minBaseUnits = "-1"; }));
  invalid(variant((f) => { f.spec = "other/1"; }));
  invalid(variant((f) => { f.valid_from = "2026-10-01"; }));
});

test("TIME_ONLY sum ignores price-conditioned, unlocked and empty tranches", () => {
  assert.equal(
    sumActiveTimeOnly([
      { amount: 1500n * IFR, cType: 0, unlocked: false },
      { amount: 1000n * IFR, cType: 0, unlocked: false },
      { amount: 9000n * IFR, cType: 1, unlocked: false },
      { amount: 9000n * IFR, cType: 2, unlocked: false },
      { amount: 9000n * IFR, cType: 3, unlocked: false },
      { amount: 9000n * IFR, cType: 0, unlocked: true },
      { amount: 0n, cType: 0, unlocked: false },
    ]),
    2500n * IFR
  );
});

// ─── Chain reads ────────────────────────────────────────────────────────

test("IFRLOCK: tier at a pinned block, never isLocked(x, 0), only the tier is learnt", async () => {
  const node = fakeNode({ blocks: { 100: { lock: { [WALLET]: 3000n * IFR } } } });
  const result = await verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node });
  assert.equal(result.tier, "SILVER");
  assert.equal(result.block.number, 100n);
  assert.equal(result.block.hash, node.hashOf(100));
  assert.equal(result.tiersVersion, 1);
  const mins = node.calls.filter((c) => c.isLockedMin !== undefined).map((c) => c.isLockedMin);
  assert.ok(mins.length > 0 && mins.every((m) => m > 0n));
  assert.deepEqual(mins, [10_000n * IFR, 5000n * IFR, 2500n * IFR]); // stops at the first hit, highest first
  const lockedBalanceSelector = id("lockedBalance(address)").slice(0, 10);
  assert.ok(node.calls.some((c) => c.method === "eth_call"));
  assert.ok(!node.calls.some((c) => c.params?.[0]?.data?.startsWith(lockedBalanceSelector)), "lockedBalance must not be called");
});

test("no lock → tier null (not an error)", async () => {
  const node = fakeNode({ blocks: { 7: { lock: { [OTHER]: 5000n * IFR } } } });
  const result = await verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node });
  assert.equal(result.tier, null);
});

test("unlock between two checks: the second, newer block decides", async () => {
  const node = fakeNode({
    blocks: { 200: { lock: { [WALLET]: 5000n * IFR } }, 205: { lock: {} } },
  });
  const first = await verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node, block: 200n });
  const second = await verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node, block: "latest" });
  assert.equal(first.tier, "GOLD");
  assert.equal(second.tier, null);
  assert.ok(second.block.number > first.block.number);
});

test("block pinned by number + hash; a different hash fails closed", async () => {
  const node = fakeNode({ blocks: { 300: { lock: { [WALLET]: 1000n * IFR } } } });
  const ok = await verifyIfrBenefit({
    wallet: WALLET, chainId: 1, rpc: node, block: { number: 300n, hash: node.hashOf(300) },
  });
  assert.equal(ok.tier, "BRONZE");
  await rejects(
    verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node, block: { number: 300n, hash: "0x" + "ab".repeat(32) } }),
    "BLOCK_MISMATCH"
  );
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node, block: 999n }), "BLOCK_MISMATCH");
});

test("COMMITMENT_TIME_ONLY counts TIME_ONLY only; price-conditioned tranches never count", async () => {
  const node = fakeNode({
    blocks: {
      10: {
        tranches: {
          [WALLET]: [
            { amount: 2000n * IFR, cType: 0 },
            { amount: 600n * IFR, cType: 0 },
            { amount: 50_000n * IFR, cType: 2 },
          ],
        },
      },
    },
  });
  const result = await verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node, source: "COMMITMENT_TIME_ONLY" });
  assert.equal(result.tier, "SILVER");
  assert.equal(result.sources.COMMITMENT_TIME_ONLY, "SILVER");
  assert.equal(result.sources.IFRLOCK, undefined);
});

test("EITHER takes the higher source and never adds them", async () => {
  const node = fakeNode({
    blocks: {
      1: {
        lock: { [WALLET]: 1500n * IFR },
        tranches: { [WALLET]: [{ amount: 1500n * IFR, cType: 0 }] },
      },
    },
  });
  const result = await verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node, source: "EITHER" });
  assert.equal(result.tier, "BRONZE"); // 1500 + 1500 would be SILVER — must not happen
  assert.deepEqual(result.sources, { IFRLOCK: "BRONZE", COMMITMENT_TIME_ONLY: "BRONZE" });

  const node2 = fakeNode({
    blocks: { 1: { lock: { [WALLET]: 1000n * IFR }, tranches: { [WALLET]: [{ amount: 6000n * IFR, cType: 0 }] } } },
  });
  assert.equal((await verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node2, source: "EITHER" })).tier, "GOLD");
});

test("wrong chain: unsupported id, or the node reports another chain", async () => {
  const node = fakeNode({ blocks: { 1: {} } });
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 56, rpc: node }), "WRONG_CHAIN");
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 11155111, rpc: node }), "WRONG_CHAIN");
  const test31337 = fakeNode({ chainId: 31337, blocks: { 1: {} } });
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 31337, rpc: test31337, contracts: MAINNET }), "WRONG_CHAIN");
  const r = await verifyIfrBenefit({ wallet: WALLET, chainId: 31337, rpc: test31337, contracts: MAINNET, allowTestChain: true });
  assert.equal(r.tier, null);
});

test("contract identity failures fail closed", async () => {
  const blocks = { 1: { lock: { [WALLET]: 9000n * IFR } } };
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: fakeNode({ blocks, decimals: 18 }) }), "CONTRACT_MISMATCH");
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: fakeNode({ blocks, lockToken: OTHER }) }), "CONTRACT_MISMATCH");
  await rejects(
    verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: fakeNode({ blocks, codeless: [MAINNET.ifrLock] }) }),
    "CONTRACT_MISMATCH"
  );
  await rejects(
    verifyIfrBenefit({ wallet: WALLET, chainId: 1, source: "EITHER", rpc: fakeNode({ blocks, vaultToken: OTHER }) }),
    "CONTRACT_MISMATCH"
  );
  await rejects(
    verifyIfrBenefit({ wallet: WALLET, chainId: 11155111, source: "COMMITMENT_TIME_ONLY", rpc: fakeNode({ chainId: 11155111, blocks }) }),
    "CONTRACT_MISMATCH"
  );
});

test("RPC failure fails closed", async () => {
  const broken = { async request() { throw new Error("timeout"); } };
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: broken }), "RPC_UNAVAILABLE");
});

test("invalid inputs and tier objects with zero thresholds are rejected", async () => {
  const node = fakeNode({ blocks: { 1: {} } });
  await rejects(verifyIfrBenefit({ wallet: "0x123", chainId: 1, rpc: node }), "INVALID_INPUT");
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node, source: "SUM" }), "INVALID_INPUT");
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: "http://rpc.example" }), "INVALID_INPUT");
  const zero = { version: 9, validFrom: "2026-10-01T00:00:00Z", tiers: [{ key: "X", label: "X", minBaseUnits: 0n }] };
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node, tiers: zero }), "INVALID_TIERS");
});

test("HTTPS rpc URL uses fetch with JSON-RPC", async () => {
  const node = fakeNode({ blocks: { 5: { lock: { [WALLET]: 10_000n * IFR } } } });
  const fakeFetch = async (url, init) => {
    assert.equal(url, "https://rpc.example/");
    const body = JSON.parse(init.body);
    const result = await node.request({ method: body.method, params: body.params });
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: body.id, result }) };
  };
  const r = await verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: "https://rpc.example/", fetch: fakeFetch });
  assert.equal(r.tier, "PLATINUM");
});

// ─── Wallet ownership message ───────────────────────────────────────────

const signer = new Wallet("0x" + "11".repeat(32));
const NOW = new Date("2026-11-03T08:15:00Z");
const NONCE = "9f3c6a1e5b7d4c20a8e1f0b2";

function messageFields(overrides = {}) {
  return {
    domain: "shop.example",
    address: signer.address,
    uri: "https://shop.example/benefit",
    chainId: 1,
    nonce: NONCE,
    issuedAt: "2026-11-03T08:14:05Z",
    expirationTime: "2026-11-03T08:19:05Z",
    purpose: "BENEFIT",
    ...overrides,
  };
}

const expected = { domain: "shop.example", chainId: 1, purpose: "BENEFIT", nonce: NONCE, now: NOW };

test("message round trip: build → sign → verify returns the signer", async () => {
  const message = buildBenefitMessage(messageFields());
  assert.match(message, /^shop\.example wants you to sign in with your Ethereum account:\n/);
  assert.ok(message.includes("- urn:ifr-benefits:spec:ifr-benefits-verify/1\n- urn:ifr-benefits:purpose:BENEFIT"));
  const parsed = parseBenefitMessage(message);
  assert.equal(parsed.chainId, 1);
  const signature = await signer.signMessage(message);
  assert.equal(verifyBenefitMessage({ message, signature, expected }), signer.address);
});

test("message checks reject every deviation", async () => {
  const sign = async (fields) => {
    const message = buildBenefitMessage(messageFields(fields));
    return { message, signature: await signer.signMessage(message) };
  };
  const bad = async (fields, exp = {}) => {
    const { message, signature } = await sign(fields);
    assert.throws(() => verifyBenefitMessage({ message, signature, expected: { ...expected, ...exp } }), (e) => e.code === "INVALID_MESSAGE");
  };
  await bad({ domain: "shop.examp1e", uri: "https://shop.examp1e/benefit" }); // phishing domain
  await bad({ uri: "https://evil.example/benefit" }); // URI host ≠ domain
  await bad({ chainId: 11155111 }); // wrong chain
  await bad({}, { nonce: "000000000000000000000000" }); // other nonce
  await bad({ purpose: "LOGIN" }); // other purpose
  await bad({ expirationTime: "2026-11-03T08:20:06Z" }); // > 5 min lifetime
  await bad({ issuedAt: "2026-11-03T08:00:00Z", expirationTime: "2026-11-03T08:04:00Z" }); // expired
  await bad({ notBefore: "2026-11-03T08:16:00Z" }); // not yet valid

  const { message } = await sign({});
  const otherSigner = new Wallet("0x" + "22".repeat(32));
  assert.throws(
    () => verifyBenefitMessage({ message, signature: otherSigner.signMessageSync(message), expected }),
    (e) => e.code === "INVALID_MESSAGE"
  );
  assert.throws(
    () => verifyBenefitMessage({ message: message.replace("does not move funds", "moves funds"), signature: signer.signMessageSync(message), expected }),
    (e) => e.code === "INVALID_MESSAGE"
  );
});

test("message builder refuses unsafe fields", () => {
  const refuse = (overrides) => assert.throws(() => buildBenefitMessage(messageFields(overrides)), (e) => e.code === "INVALID_MESSAGE");
  refuse({ nonce: "short" });
  refuse({ purpose: "benefit" });
  refuse({ domain: "shop.example\nURI: https://evil" });
  refuse({ statement: "Sign to claim" });
  refuse({ resources: ["ok", "bad\nline"] });
});

test("AbiCoder sanity: getTranches tuple layout matches the contract", () => {
  const encoded = vaultIface.encodeFunctionResult("getTranches", [[[1n, 0, 2n, 3n, false, 4n]]]);
  const [decoded] = AbiCoder.defaultAbiCoder().decode(["tuple(uint256,uint8,uint256,uint256,bool,uint256)[]"], encoded);
  assert.equal(decoded[0][1], 0n);
});

test("TIERS_V1 is frozen evaluation data", () => {
  assert.ok(Object.isFrozen(TIERS_V1) && Object.isFrozen(TIERS_V1.tiers));
  assert.deepEqual(TIERS_V1.tiers.map((t) => t.key), ["BRONZE", "SILVER", "GOLD", "PLATINUM"]);
});

// ─── Conformance vectors (vectors/v1.json) against the fake node ────────

const vectors = require("../vectors/v1.json");
const { parseUnits } = require("ethers");

test("vectors: tier and source cases", async () => {
  for (const c of [...vectors.tierCases, ...vectors.sourceCases]) {
    const tranches = [
      ...(c.timeOnly ?? []).map((a) => ({ amount: parseUnits(a, 9), cType: 0 })),
      ...(c.priceConditioned ?? []).map((a, i) => ({ amount: parseUnits(a, 9), cType: 1 + (i % 3) })),
    ];
    const node = fakeNode({ blocks: { 1: { lock: { [WALLET]: parseUnits(c.lockIFR, 9) }, tranches: { [WALLET]: tranches } } } });
    const result = await verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node, source: c.source });
    assert.equal(result.tier, c.expected, c.name);
  }
  assert.equal(vectors.spec, lib.SPEC_ID);
});

test("a revert is a contract mismatch, a transport error is an outage", async () => {
  const node = fakeNode({ blocks: { 1: { lock: { [WALLET]: 3000n * IFR } } } });
  const reverting = {
    async request(args) {
      if (args.method === "eth_call" && args.params[0].to.toLowerCase() === MAINNET.ifrLock.toLowerCase()) {
        const error = new Error("execution reverted");
        error.code = 3;
        throw error;
      }
      return node.request(args);
    },
  };
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: reverting }), "CONTRACT_MISMATCH");
  const flaky = {
    async request(args) {
      if (args.method === "eth_call") throw new Error("socket hang up");
      return node.request(args);
    },
  };
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: flaky }), "RPC_UNAVAILABLE");
});


// ─── Block-hash binding (review follow-up to #154) ──────────────────────

test("every contract read is bound to the block hash (EIP-1898), never only to the number", async () => {
  const node = fakeNode({ blocks: { 40: { lock: { [WALLET]: 2500n * IFR } } } });
  const result = await verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node, source: "EITHER" });
  const reads = node.calls.filter((c) => c.method === "eth_call" || c.method === "eth_getCode");
  assert.ok(reads.length > 0);
  for (const read of reads) {
    const blockId = read.method === "eth_call" ? read.params[1] : read.params[1];
    assert.deepEqual(blockId, { blockHash: result.block.hash, requireCanonical: true });
  }
});

test("a same-height reorg during the check never yields a tier", async () => {
  // Reorg replaces block 50 after the header was read: the old hash disappears.
  let done = false;
  const node = fakeNode({
    blocks: { 50: { lock: { [WALLET]: 10_000n * IFR } } },
    onCall: ({ method, reorg }) => {
      if (!done && method === "eth_call") {
        done = true;
        reorg(50, { lock: {} });
      }
    },
  });
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node }), "BLOCK_MISMATCH");
});

test("a reorg after the last read is caught by the final hash re-check", async () => {
  let reads = 0;
  const node = fakeNode({
    blocks: { 60: { lock: { [WALLET]: 5000n * IFR } } },
    onCall: ({ method, params, reorg }) => {
      if (method === "eth_call") reads += 1;
      // The re-check is the second eth_getBlockByNumber; swap the block just before it.
      if (method === "eth_getBlockByNumber" && reads > 0) reorg(60, { lock: { [WALLET]: 5000n * IFR } });
    },
  });
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: node }), "BLOCK_MISMATCH");
});

test("a provider without EIP-1898 support fails closed", async () => {
  const node = fakeNode({ blocks: { 70: { lock: { [WALLET]: 5000n * IFR } } } });
  const legacy = {
    async request(args) {
      if ((args.method === "eth_call" || args.method === "eth_getCode") && typeof args.params[1] === "object") {
        const error = new Error("invalid argument 1: hex string without 0x prefix");
        error.code = -32602;
        throw error;
      }
      return node.request(args);
    },
  };
  await rejects(verifyIfrBenefit({ wallet: WALLET, chainId: 1, rpc: legacy }), "RPC_UNAVAILABLE");
});
