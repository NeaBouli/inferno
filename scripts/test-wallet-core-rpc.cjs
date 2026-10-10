#!/usr/bin/env node
// Verifies the read-only RPC path of docs/assets/wallet-core.js (T-212a):
// CORS-capable endpoint list, ethers v6 FallbackProvider failover, fail-closed
// per-endpoint eth_chainId verification, visible unavailable notice, and no
// third-party script fetch. Runtime checks execute the self-hosted ethers
// 6.17.0 build over a fake fetch, so no network is used.
//
// WALLET_CORE_PATH=<file> runs the same checks against another wallet-core
// build (mutation check: the prior single-RPC version must fail).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
// WALLET_CORE_TARGET=web3 runs the same checks against the Web3 site's core
// (docs/web3-wallet-core.js, loaded by docs/web3/index.html).
const TARGET = process.env.WALLET_CORE_TARGET === "web3" ? "web3" : "landing";
const TARGETS = {
  landing: {
    core: path.join(root, "docs", "assets", "wallet-core.js"),
    page: path.join(root, "docs", "index.html"),
    cacheBust: /assets\/wallet-core\.js\?v=20261010-pr261-notice"/
  },
  web3: {
    core: path.join(root, "docs", "web3-wallet-core.js"),
    page: path.join(root, "docs", "web3", "index.html"),
    cacheBust: /\/web3-wallet-core\.js\?v=20261004-rpc-fallback-v6"/
  }
};
const corePath = process.env.WALLET_CORE_PATH || TARGETS[TARGET].core;
const source = fs.readFileSync(corePath, "utf8");
const landing = fs.readFileSync(TARGETS[TARGET].page, "utf8");
const ethersSource = fs.readFileSync(path.join(root, "docs", "assets", "vendor", "ethers-6.17.0.umd.min.js"), "utf8");

// Endpoints verified to answer a browser CORS preflight for https://ifrunit.tech.
const CORS_CAPABLE = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://1rpc.io/eth"
];
const PRIMARY = CORS_CAPABLE[0];
const IFR = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const HOLDER = "0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b";

// ── Static checks ───────────────────────────────────
const listMatch = source.match(/var RPC_URLS = \[([\s\S]*?)\];/);
assert.ok(listMatch, "RPC_URLS list missing");
const urls = Array.from(listMatch[1].matchAll(/"([^"]+)"/g), (m) => m[1]);
// The runtime fixtures below address exactly these three endpoints (A, B, C).
assert.deepStrictEqual(urls, CORS_CAPABLE, "RPC_URLS must be exactly the three CORS-verified endpoints, publicnode first");
assert.ok(!source.includes("llamarpc"), "wallet-core still references eth.llamarpc.com");
assert.ok(!landing.includes("eth.llamarpc.com"), "landing still prefetches eth.llamarpc.com");
assert.ok(
  landing.includes('<link rel="dns-prefetch" href="' + PRIMARY + '">'),
  "landing dns-prefetch must point at the primary RPC"
);
assert.ok(
  TARGETS[TARGET].cacheBust.test(landing),
  TARGET + " page must cache-bust its wallet core for the RPC fallback"
);
if (TARGET === "landing") {
  const faq = fs.readFileSync(path.join(root, "docs", "wiki", "faq.html"), "utf8");
  const faqCacheBust = /\.\.\/assets\/wallet-core\.js\?v=20261010-pr261-notice"/;
  assert.ok(faqCacheBust.test(faq), "FAQ must cache-bust its wallet core for the RPC notice");
  // Reject obsolete and unversioned page mutations, not just a missing asset reference.
  for (const oldSuffix of ["?v=20261004-read-provider", ""]) {
    assert.ok(!TARGETS.landing.cacheBust.test(landing.replace("wallet-core.js?v=20261010-pr261-notice", "wallet-core.js" + oldSuffix)),
      "landing must reject the obsolete or unversioned wallet core URL");
    assert.ok(!faqCacheBust.test(faq.replace("wallet-core.js?v=20261010-pr261-notice", "wallet-core.js" + oldSuffix)),
      "FAQ must reject the obsolete or unversioned wallet core URL");
  }
}
// T-224: page-level inline readers must use IFRWallet.getReadProvider() (chain-pinned), never their own
// JsonRpcProvider. Only executable <script> blocks are checked; <pre> code samples are documentation.
assert.ok(/getReadProvider: getReadProvider/.test(source), "wallet-core must export getReadProvider");
{
  const pages = [];
  for (const dir of ["docs", path.join("docs", "wiki")]) {
    for (const f of fs.readdirSync(path.join(root, dir))) if (f.endsWith(".html")) pages.push(path.join(dir, f));
  }
  for (const rel of pages) {
    const html = fs.readFileSync(path.join(root, rel), "utf8");
    for (const m of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      assert.ok(!/new\s+(window\.)?ethers\.JsonRpcProvider\s*\(/.test(m[1]),
        rel + ": inline reader builds its own JsonRpcProvider; use IFRWallet.getReadProvider()");
    }
  }
}
// CWA-47: wallet-core must not inject third-party <script> tags.
assert.ok(!/createElement\(\s*["']script["']\s*\)/.test(source), "wallet-core must not inject script tags");

// ── Runtime harness ─────────────────────────────────
function makeElement(tag) {
  return {
    tagName: tag.toUpperCase(),
    id: "",
    style: {},
    attrs: {},
    children: [],
    listeners: {},
    textContent: "",
    type: "",
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    addEventListener(ev, cb) { this.listeners[ev] = cb; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  };
}

// Per-chain fixture values. Anything other than chain 0x1 returns values that
// must never reach a caller.
const VALUES = {
  "0x1": { block: "0x100", balance: "0x1", word: 7n },
  wrong: { block: "0x999999", balance: "0xdead", word: 666n }
};

// endpoint behaviour: chainId hex string, "down" (fetch rejects), or "garbage".
function fakeRpc(behaviour) {
  const calls = [];
  async function fetch(input, init) {
    const url = (typeof input === "string" ? input : input.url).replace(/\/$/, "");
    let body = init && init.body;
    if (body && typeof body !== "string") body = Buffer.from(body).toString();
    const reqs = JSON.parse(body);
    const list = Array.isArray(reqs) ? reqs : [reqs];
    const mode = behaviour[url];
    list.forEach((r) => calls.push({ url, method: r.method }));
    if (mode === undefined) throw new Error("unexpected endpoint " + url);
    if (mode === "down") throw new TypeError("Failed to fetch");
    const v = mode === "0x1" ? VALUES["0x1"] : VALUES.wrong;
    const out = list.map((r) => {
      let result;
      switch (r.method) {
        case "eth_chainId": result = mode === "garbage" ? "not-a-chain" : mode; break;
        case "eth_blockNumber": result = v.block; break;
        case "eth_getBalance": result = v.balance; break;
        case "eth_call": result = "0x" + v.word.toString(16).padStart(64, "0"); break;
        default: return { jsonrpc: "2.0", id: r.id, error: { code: -32601, message: "unsupported " + r.method } };
      }
      return { jsonrpc: "2.0", id: r.id, result };
    });
    return new Response(JSON.stringify(Array.isArray(reqs) ? out : out[0]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  return { fetch, calls };
}

function loadWalletCore(behaviour) {
  const rpc = fakeRpc(behaviour);
  const body = makeElement("body");
  const findById = (node, id) => {
    if (node.id === id) return node;
    for (const c of node.children) { const r = findById(c, id); if (r) return r; }
    return null;
  };
  const warnings = [];
  const sandbox = {
    navigator: { userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0 },
    document: {
      body,
      documentElement: body,
      createElement: makeElement,
      getElementById: (id) => findById(body, id),
      addEventListener() {}
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    console: { log() {}, info() {}, warn(...a) { warnings.push(a.join(" ")); }, error() {} },
    fetch: rpc.fetch,
    setTimeout, clearTimeout, setInterval, clearInterval,
    TextEncoder, TextDecoder, atob, btoa, URL, AbortController, Headers, Request, Response,
    crypto: require("crypto").webcrypto
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.location = { href: "https://ifrunit.tech/", reload() {} };
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(ethersSource, sandbox, { filename: "ethers-6.17.0.umd.min.js" });
  assert.strictEqual(sandbox.ethers.version, "6.17.0", "self-hosted ethers must be 6.17.0");
  vm.runInContext(source, sandbox, { filename: "wallet-core.js" });
  return { api: sandbox.IFRWallet, sandbox, calls: rpc.calls, warnings };
}

const flush = () => new Promise((r) => setTimeout(r, 20));
const DATA_METHODS = new Set(["eth_blockNumber", "eth_getBalance", "eth_call"]);
const dataCallsTo = (calls, url) => calls.filter((c) => c.url === url && DATA_METHODS.has(c.method));

async function readAll(env) {
  const { ethers } = env.sandbox;
  const provider = env.api.getProvider();
  const token = new ethers.Contract(IFR, ["function balanceOf(address) view returns (uint256)"], provider);
  return {
    block: await provider.getBlockNumber(),
    balance: await provider.getBalance(HOLDER),
    tokenBalance: await token.balanceOf(HOLDER)
  };
}

function expectMainnet(values, label) {
  assert.strictEqual(values.block, 0x100, label + ": block must come from chain 0x1");
  assert.strictEqual(values.balance, 1n, label + ": balance must come from chain 0x1");
  assert.strictEqual(values.tokenBalance, 7n, label + ": contract call must come from chain 0x1");
}

async function expectUnavailable(env, label) {
  let emitted = null;
  env.api.on("rpcError", (e) => { emitted = e; });
  await assert.rejects(readAll(env), label + ": reads must reject when no endpoint is usable");
  await flush();
  const notice = env.sandbox.document.getElementById("ifr-rpc-error");
  assert.ok(notice, label + ": visible RPC error notice missing");
  assert.strictEqual(notice.attrs.role, "alert", label + ": notice must be role=alert");
  assert.ok(/unavailable/i.test(notice.children[0].textContent), label + ": notice text missing");
  assert.ok(emitted, label + ": rpcError event not emitted");
  return notice;
}

(async () => {
  const [A, B, C] = urls;

  // 1. Healthy: one cached FallbackProvider, Mainnet values, no notice.
  const ok = loadWalletCore({ [A]: "0x1", [B]: "0x1", [C]: "0x1" });
  const p1 = ok.api.getProvider();
  assert.strictEqual(p1, ok.api.getProvider(), "read provider must be cached");
  assert.ok(p1 instanceof ok.sandbox.ethers.FallbackProvider, "read provider must be an ethers FallbackProvider");
  assert.strictEqual(p1.quorum, 1, "quorum must be 1 for public fallback endpoints");
  expectMainnet(await readAll(ok), "healthy");
  await flush();
  assert.strictEqual(ok.sandbox.document.getElementById("ifr-rpc-error"), null, "no notice when RPC is healthy");
  urls.forEach((u) => {
    const first = ok.calls.find((c) => c.url === u);
    assert.ok(first && first.method === "eth_chainId", "eth_chainId must be the first request to " + u);
  });

  // Web3 core: getReadProvider() is the same chain-pinned provider, also while a wallet could be connected.
  if (TARGET === "web3") {
    assert.ok(/getReadProvider: getReadProvider/.test(source), "web3 wallet core must export getReadProvider");
    assert.strictEqual(ok.api.getReadProvider(), ok.api.getProvider(), "getReadProvider must return the pinned read provider");
    const wrongRead = loadWalletCore({ [A]: "0x5", [B]: "0x5", [C]: "0x5" });
    const rp = wrongRead.api.getReadProvider();
    await assert.rejects(rp.getBlockNumber(), "getReadProvider must not serve data from a wrong-chain endpoint");
    urls.forEach((u) => assert.deepStrictEqual(dataCallsTo(wrongRead.calls, u), [], "getReadProvider: no data request may reach " + u));
  }

  // 2. Wrong-chain primary: backups answer, primary only ever sees eth_chainId.
  const wrongPrimary = loadWalletCore({ [A]: "0x5", [B]: "0x1", [C]: "0x1" });
  expectMainnet(await readAll(wrongPrimary), "wrong-chain primary");
  expectMainnet(await readAll(wrongPrimary), "wrong-chain primary (repeat)");
  assert.deepStrictEqual(dataCallsTo(wrongPrimary.calls, A), [], "wrong-chain endpoint must not receive data requests");

  // 3. Mixed: wrong chain, down, Mainnet.
  const mixed = loadWalletCore({ [A]: "0x89", [B]: "down", [C]: "0x1" });
  expectMainnet(await readAll(mixed), "mixed");
  assert.deepStrictEqual(dataCallsTo(mixed.calls, A), [], "wrong-chain endpoint must not receive data requests (mixed)");
  await flush();
  assert.strictEqual(mixed.sandbox.document.getElementById("ifr-rpc-error"), null, "no notice while one endpoint is usable");

  // 4. Unparsable chainId fails closed.
  const garbage = loadWalletCore({ [A]: "garbage", [B]: "0x1", [C]: "0x1" });
  expectMainnet(await readAll(garbage), "garbage chainId");
  assert.deepStrictEqual(dataCallsTo(garbage.calls, A), [], "unparsable chainId endpoint must not receive data requests");

  // 5. Every endpoint on a wrong chain: no value, visible notice, dismissible.
  const allWrong = loadWalletCore({ [A]: "0x5", [B]: "0xaa36a7", [C]: "0x89" });
  const notice = await expectUnavailable(allWrong, "all wrong chain");
  urls.forEach((u) => assert.deepStrictEqual(dataCallsTo(allWrong.calls, u), [], "no data request may reach " + u));
  const closeBtn = notice.children[1];
  assert.strictEqual(closeBtn.attrs["aria-label"], "Dismiss network notice", "dismiss button needs an aria-label");
  assert.ok(/min-width:44px/.test(closeBtn.style.cssText) && /min-height:44px/.test(closeBtn.style.cssText), "dismiss button must be >= 44x44");
  closeBtn.listeners.click();
  assert.strictEqual(allWrong.sandbox.document.getElementById("ifr-rpc-error"), null, "dismiss must remove notice");
  assert.ok(allWrong.warnings.some((w) => /No usable public RPC endpoint/.test(w)), "failure must be logged");

  // 6. Every endpoint down.
  const allDown = loadWalletCore({ [A]: "down", [B]: "down", [C]: "down" });
  await expectUnavailable(allDown, "all down");

  // 7. All down, then recovered: the failed provider is dropped, the next
  //    getProvider() builds a fresh one, reads succeed and the notice clears.
  const recoverRpc = { [A]: "down", [B]: "down", [C]: "down" };
  const recover = loadWalletCore(recoverRpc);
  const failed = recover.api.getProvider();
  await expectUnavailable(recover, "recover (all down)");
  recoverRpc[A] = "0x1"; recoverRpc[B] = "0x1"; recoverRpc[C] = "0x1";
  const fresh = recover.api.getProvider();
  assert.notStrictEqual(fresh, failed, "a provider whose initial sync failed must not stay cached");
  expectMainnet(await readAll(recover), "recovered");
  await flush();
  assert.strictEqual(recover.api.getProvider(), fresh, "the recovered provider must stay cached");
  assert.strictEqual(recover.sandbox.document.getElementById("ifr-rpc-error"), null, "stale unavailable notice must clear after recovery");

  console.log("[" + TARGET + "] wallet-core RPC fallback (ethers 6.17.0): " + urls.length +
    " CORS-capable endpoints, primary " + urls[0] + "; wrong-chain/mixed/garbage/all-wrong/all-down/recovery — OK");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
