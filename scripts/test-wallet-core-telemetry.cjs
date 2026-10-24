#!/usr/bin/env node
// Executes both actual loaders and the shared guard, replacing only ESM loading
// and the SDK with local fixtures. Not real-SDK/network privacy verification.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { loadGuard, guardUrl } = require("./test-wallet-telemetry-guard.cjs");

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

async function checkInit(source, target, mobile, restore, failure = "") {
  const label = target.file + (mobile ? " mobile" : " desktop") + (restore ? " restore" : " connect");
  const captures = [];
  const imports = [];
  let guard;
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
      if (method === "eth_requestAccounts") return this.accounts;
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
    URL, Request, Response,
    document: {
      baseURI: currentUrl,
      addEventListener() {},
      createElement: failure ? () => ({ style: {}, appendChild() {}, addEventListener() {} }) : unexpected,
      body: { appendChild() {} },
      getElementById: () => ({ addEventListener() {} })
    },
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
      if (url === guardUrl) {
        if (failure === "guard-import") throw new Error("synthetic guard import failure");
        return guard || (guard = loadGuard(sandbox));
      }
      assert.equal(url, artifact, label + ": provider import must stay same-origin and pinned");
      assert.notEqual(sandbox.fetch, unexpected, label + ": guard must install before provider evaluation");
      assert.notEqual(sandbox.navigator.sendBeacon, unexpected, label + ": Beacon guard must precede provider evaluation");
      await probe();
      if (failure === "provider-import") throw new Error("synthetic provider import failure");
      return { EthereumProvider: { async init(options) {
        captures.push(JSON.parse(JSON.stringify(options)));
        await probe();
        if (failure === "init") throw new Error("synthetic init failure");
        return provider;
      } } };
    }
  };
  sandbox.window = sandbox;
  async function probe() {
    // Synthetic late/error canaries; the native fixture must never see them.
    assert.deepEqual(await (await sandbox.fetch("https://pulse.walletconnect.org/e?synthetic=1", {
      method: "POST", body: currentUrl
    })).json(), {}, label + ": Pulse response must be usable by SDK .json()");
    assert.equal(sandbox.navigator.sendBeacon("https://pulse.walletconnect.org/batch?synthetic=1", currentUrl), true);
  }
  if (failure === "fetch-install") Object.defineProperty(sandbox, "fetch", { value: unexpected, writable: false });
  if (failure === "beacon-install") Object.defineProperty(sandbox.navigator, "sendBeacon", { value: unexpected, writable: false });
  // Replace only the import boundary; execute the actual initializer and its options.
  let executable = source;
  for (const name of ["WC_TELEMETRY_GUARD_URL", "WC_PROVIDER_URL"]) {
    const importCall = "await import(" + name + ")";
    assert.equal(source.split(importCall).length, 2, label + ": expected one " + name + " import boundary");
    executable = executable.replace(importCall, "await __loadWalletConnectModule(" + name + ")");
  }
  vm.createContext(sandbox);
  vm.runInContext(executable, sandbox,
    { filename: target.file, timeout: 1000 });
  assert.equal(imports.length, 0, label + ": provider must remain lazy");
  assert.equal(sandbox.fetch, unexpected, label + ": guard must remain lazy for injected wallets");
  const api = sandbox.IFRWallet;
  if (failure === "injected") {
    sandbox.ethereum = provider;
    assert.equal(await api.connect(), address, label + ": injected connection must remain available");
    assert.deepEqual(imports, [], label + ": injected-only flow must not import guard or SDK");
    assert.equal(sandbox.fetch, unexpected);
    assert.equal(sandbox.navigator.sendBeacon, unexpected);
    api.disconnect();
    return;
  }
  if (failure) {
    const connect = target.sessionKey === "ifr_wallet_connected" ? () => api.connect() : () => api.connectWalletConnect();
    await assert.rejects(connect, /NO_METAMASK|NO_WALLETCONNECT/, label + ": WalletConnect must fail closed");
    const installed = ["provider-import", "init"].includes(failure);
    assert.deepEqual(imports, installed ? [guardUrl, artifact] : [guardUrl], label + ": failed guard must prevent SDK import");
    assert.equal(captures.length, failure === "init" ? 1 : 0, label + ": failed import must prevent SDK init");
    assert.equal(enables, 0, label + ": failures must not pair");
    if (installed) await probe(); // Remains installed even after SDK evaluation/init throws.
    const fetch = sandbox.fetch;
    const beacon = sandbox.navigator.sendBeacon;
    sandbox.ethereum = provider;
    assert.equal(await api.connect(), address, label + ": guard failure must not break injected wallets");
    assert.equal(sandbox.fetch, fetch);
    assert.equal(sandbox.navigator.sendBeacon, beacon);
    api.disconnect();
    if (installed) await probe();
    return;
  }
  const result = await (restore ? api.autoReconnect() : mobile ? api.connectWalletConnect() : api.connect());
  assert.equal(result, restore ? true : address, label + ": mock wallet flow must complete");
  assert.equal(api.getAddress(), address, label + ": selected account must be retained");
  assert.equal(enables, restore ? 0 : 1, label + ": restore must not request a new pairing");
  assert.deepEqual(imports, [guardUrl, artifact], label + ": guard must load before pinned provider");
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
  const fetch = sandbox.fetch;
  const beacon = sandbox.navigator.sendBeacon;
  api.disconnect();
  await probe(); // Disconnect must not remove the document-persistent boundary.
  guard.installWalletConnectTelemetryGuard();
  assert.equal(sandbox.fetch, fetch);
  assert.equal(sandbox.navigator.sendBeacon, beacon);
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
  for (const target of targets) {
    for (const failure of ["injected", "guard-import", "fetch-install", "beacon-install", "provider-import", "init"]) {
      await checkInit(sources[target.file], target, false, false, failure);
    }
  }
  // In-memory mutations never rewrite the worktree or create temporary files.
  for (const { file } of targets) {
    const optout = /\btelemetryEnabled:\s*false,?/g;
    assert.equal([...sources[file].matchAll(optout)].length, 1, file + ": expected one opt-out to mutate");
    const mutated = { ...sources, [file]: sources[file].replace(optout, "") };
    await assert.rejects(() => checkSources(mutated), (error) =>
      error.code === "ERR_ASSERTION" && error.message.startsWith(file + ": Core optional telemetry must be disabled"),
    file + ": removing its opt-out must fail the runtime check");
  }
  for (const { file } of targets) {
    const install = "guard.installWalletConnectTelemetryGuard();";
    for (const mutation of [
      sources[file].replace(install, ""),
      sources[file].replace(install, "").replace("var mod = await import(WC_PROVIDER_URL);",
        "var mod = await import(WC_PROVIDER_URL); " + install)
    ]) {
      assert.notEqual(mutation, sources[file]);
      await assert.rejects(() => checkSources({ ...sources, [file]: mutation }),
        undefined, file + ": missing/late guard must fail");
    }
  }
  console.log("[wallet-core-telemetry] PASS: 6 actual init captures; 10 failure/injected-recovery + 2 injected-only cases; 6 mutations rejected (local fixtures, not real-SDK verification)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
