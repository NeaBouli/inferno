#!/usr/bin/env node
// Captures app-owned init options, not SDK telemetry or network behavior.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const artifact = "/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js";
const address = "0x1111111111111111111111111111111111111111";
const signature = "0x" + "ab".repeat(65);
const uri = "wc:" + "cd".repeat(32) + "@2?symKey=" + "ef".repeat(32);
const currentUrl = "https://wallet-fixture.invalid/private-checkout-canary?address=" + address +
  "&signature=" + signature + "&uri=" + encodeURIComponent(uri) + "#private-capability-canary";
const targets = [
  {
    file: "docs/assets/wallet-core.js",
    sessionKey: "ifr_wallet_connected",
    mobileModes: [false],
    metadata: {
      name: "Inferno Protocol ($IFR)",
      description: "Deflationary ERC-20 Token \u2014 Fair Launch",
      url: "https://ifrunit.tech",
      icons: ["https://ifrunit.tech/assets/ifr_icon_256.png"]
    }
  },
  {
    file: "docs/web3-wallet-core.js",
    sessionKey: "ifr_web3_wallet_connected",
    mobileModes: [false, true],
    metadata: {
      name: "Inferno Protocol",
      description: "IFR Protocol Web3 access layer",
      url: "https://web3.ifrunit.tech",
      icons: ["https://ifrunit.tech/assets/ifr_icon_256.png"]
    }
  }
];

async function checkInit(source, target, mobile, restore) {
  const label = target.file + (mobile ? " mobile" : " desktop") + (restore ? " restore" : " connect");
  const captures = [];
  const imports = [];
  const storage = new Map(restore ? [[target.sessionKey, address]] : []);
  let enables = 0;
  const provider = {
    accounts: [address],
    session: restore ? { topic: "fixture-session" } : null,
    uri,
    signature,
    async enable() {
      enables += 1;
      this.session = { topic: "fixture-session" };
      return this.accounts;
    },
    async request({ method }) {
      assert.equal(method, "eth_chainId", label + ": unexpected wallet request");
      return "0x1";
    },
    on() {},
    removeListener() {},
    async disconnect() { this.session = null; }
  };
  const unexpected = () => assert.fail(label + ": unexpected network, DOM or timer operation");
  const sandbox = {
    console: { log() {}, warn() {} },
    navigator: {
      userAgent: mobile ? "Mozilla/5.0 (iPad)" : "Mozilla/5.0 (Macintosh)",
      platform: "MacIntel",
      maxTouchPoints: mobile ? 5 : 0,
      sendBeacon: unexpected
    },
    location: { href: currentUrl },
    innerWidth: mobile ? 768 : 1440,
    document: { addEventListener() {}, createElement: unexpected },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    sessionStorage: { getItem: () => null, removeItem() {} },
    addEventListener() {},
    fetch: unexpected,
    setTimeout: unexpected,
    setInterval: unexpected,
    clearTimeout() {},
    clearInterval() {},
    ethers: {
      BrowserProvider: class {
        async getSigner() { return {}; }
        async getNetwork() { return { chainId: 1n }; }
      }
    },
    async __loadWalletConnectModule(url) {
      imports.push(url);
      assert.equal(url, artifact, label + ": provider import must stay same-origin and pinned");
      return { EthereumProvider: { async init(options) {
        captures.push(JSON.parse(JSON.stringify(options)));
        return provider;
      } } };
    }
  };
  sandbox.window = sandbox;
  // Replace only the import boundary; execute the actual initializer and its options.
  const importCall = "await import(WC_PROVIDER_URL)";
  assert.equal(source.split(importCall).length, 2, label + ": expected one provider import boundary");
  vm.runInNewContext(source.replace(importCall, "await __loadWalletConnectModule(WC_PROVIDER_URL)"), sandbox,
    { filename: target.file, timeout: 1000 });
  assert.equal(imports.length, 0, label + ": provider must remain lazy");
  const api = sandbox.IFRWallet;
  const result = await (restore ? api.autoReconnect() : mobile ? api.connectWalletConnect() : api.connect());
  assert.equal(result, restore ? true : address, label + ": mock wallet flow must complete");
  assert.equal(api.getAddress(), address, label + ": selected account must be retained");
  assert.equal(enables, restore ? 0 : 1, label + ": restore must not request a new pairing");
  assert.deepEqual(imports, [artifact], label + ": expected one provider import");
  assert.equal(captures.length, 1, label + ": expected one actual init call");
  const options = captures[0];
  assert.equal(options.telemetryEnabled, false, target.file + ": Core optional telemetry must be disabled");
  assert.equal(options.showQrModal, !mobile, label + ": QR policy must remain unchanged");
  assert.deepEqual(options.metadata, target.metadata, label + ": metadata must remain fixed");
  assert.deepEqual(options.qrModalOptions, {
    themeMode: "dark",
    themeVariables: { "--wcm-accent-color": "#ff4500" }
  }, label + ": modal configuration must remain unchanged");
  const serialized = JSON.stringify(options);
  for (const canary of [currentUrl, address, signature, uri, encodeURIComponent(uri),
    "private-checkout-canary", "private-capability-canary"]) {
    assert.ok(!serialized.includes(canary), label + ": sensitive canary must not enter init options");
  }
}

async function checkSources(sources) {
  for (const target of targets) {
    for (const mobile of target.mobileModes) {
      for (const restore of [false, true]) await checkInit(sources[target.file], target, mobile, restore);
    }
  }
}

async function main() {
  const sources = Object.fromEntries(targets.map(({ file }) => [file, fs.readFileSync(path.join(root, file), "utf8")]));
  await checkSources(sources);
  // In-memory mutations never rewrite the worktree or create temporary files.
  for (const { file } of targets) {
    const optout = /\btelemetryEnabled:\s*false,?/g;
    assert.equal([...sources[file].matchAll(optout)].length, 1, file + ": expected one opt-out to mutate");
    const mutated = { ...sources, [file]: sources[file].replace(optout, "") };
    await assert.rejects(() => checkSources(mutated), (error) =>
      error.code === "ERR_ASSERTION" && error.message.startsWith(file + ": Core optional telemetry must be disabled"),
    file + ": removing its opt-out must fail the runtime check");
  }
  console.log("[wallet-core-telemetry] PASS: 6 actual init captures; 2 opt-out removals rejected (local mocks only, not SDK/network verification)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
