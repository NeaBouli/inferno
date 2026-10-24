#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../docs/assets/wallet-telemetry-guard.js"), "utf8");
const guardUrl = "/assets/wallet-telemetry-guard.js?v=20261024-pulse-guard";

function loadGuard(sandbox, text = source) {
  // Only remove ESM's export keyword; execute the real guard in the loader's realm.
  const declaration = "export function installWalletConnectTelemetryGuard()";
  assert.equal(text.split(declaration).length, 2);
  if (!vm.isContext(sandbox)) vm.createContext(sandbox);
  return vm.runInContext('"use strict";\n' + text.replace(declaration, "function installWalletConnectTelemetryGuard()") +
    "\n;({ installWalletConnectTelemetryGuard });", sandbox, { timeout: 1000 });
}

function fixture(text = source) {
  const calls = [];
  const result = Promise.resolve(new Response("fixture", { status: 201 }));
  const sandbox = {
    URL, Request, Response,
    document: { baseURI: "https://app.invalid/private/page?synthetic-canary=1" },
    fetch: function () { calls.push({ kind: "fetch", receiver: this, args: [...arguments] }); return result; },
    navigator: {
      sendBeacon: function () { calls.push({ kind: "beacon", receiver: this, args: [...arguments] }); return false; }
    }
  };
  return { sandbox, calls, result, install: loadGuard(sandbox, text).installWalletConnectTelemetryGuard };
}

async function checkBoundary(text = source) {
  const { sandbox, calls, result, install } = fixture(text);
  install();
  const wrappedFetch = sandbox.fetch;
  const wrappedBeacon = sandbox.navigator.sendBeacon;
  install();
  assert.equal(sandbox.fetch, wrappedFetch, "double install must not wrap fetch twice");
  assert.equal(sandbox.navigator.sendBeacon, wrappedBeacon, "double install must not wrap Beacon twice");
  const opaqueBody = new Proxy({}, { get() { assert.fail("guard must not inspect the body or init options"); } });
  const blocked = [
    "https://pulse.walletconnect.org/",
    "https://pulse.walletconnect.org/e?projectId=synthetic-canary",
    "https://pulse.walletconnect.org/any/future/path?x=1#fragment",
    "https://PULSE.WALLETCONNECT.ORG:443/batch",
    "https://synthetic:canary@pulse.walletconnect.org/e",
    "//pulse.walletconnect.org/e",
    new URL("https://pulse.walletconnect.org/e"),
    new Request("https://pulse.walletconnect.org/e", { method: "POST", body: "synthetic-canary" })
  ];
  for (const url of blocked) {
    const response = await sandbox.fetch(url, opaqueBody);
    assert.equal(response.status, 200, "Pulse fetch must be synthetic 200");
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.deepEqual(await response.json(), {}, "SDK .json() must succeed");
    assert.equal(sandbox.navigator.sendBeacon(url, opaqueBody), true);
  }
  assert.equal(blocked.at(-1).bodyUsed, false, "Request body must not be consumed");
  sandbox.document.baseURI = "https://pulse.walletconnect.org/nested/page";
  assert.deepEqual(await (await sandbox.fetch("../e?synthetic=1")).json(), {});
  assert.equal(sandbox.navigator.sendBeacon("/relative", opaqueBody), true);
  assert.deepEqual(calls, [], "Pulse must never reach either native transport");
  sandbox.document.baseURI = "https://app.invalid/private/page";

  const delegated = [
    "/local", "../relative", "not a valid URL", "https://[",
    "http://pulse.walletconnect.org/e", "https://pulse.walletconnect.org:444/e",
    "https://pulse.walletconnect.org./e", "https://sub.pulse.walletconnect.org/e",
    "https://pulse.walletconnect.org.evil.invalid/e", "https://pulse-walletconnect.org/e",
    "https://pulse.walletconnect.org@evil.invalid/e", "https://evil.invalid/pulse.walletconnect.org",
    "https://api.web3modal.org/getAnalyticsConfig?projectId=synthetic-canary",
    "https://api.web3modal.org/getWallets", "https://rpc.walletconnect.org/v1/",
    new URL("https://app.invalid/e"), new Request("https://app.invalid/e"),
    { toString() { assert.fail("unknown input objects must not be coerced by the guard"); } },
    undefined, null
  ];
  const receiver = { synthetic: true };
  const abort = new AbortController();
  abort.abort();
  const init = { body: opaqueBody, signal: abort.signal, method: "POST", keepalive: true };
  for (const input of delegated) {
    assert.equal(sandbox.fetch.call(receiver, input, init, opaqueBody), result, "preserve native promise identity");
    const call = calls.at(-1);
    assert.equal(call.kind, "fetch");
    assert.equal(call.receiver, receiver);
    assert.equal(call.args.length, 3);
    assert.equal(call.args[0], input);
    assert.equal(call.args[1], init);
    assert.equal(call.args[2], opaqueBody);
    assert.equal(sandbox.navigator.sendBeacon.call(receiver, input, opaqueBody), false);
    assert.equal(calls.at(-1).receiver, receiver);
    assert.deepEqual(calls.at(-1).args, [input, opaqueBody]);
  }
  assert.equal(calls.length, delegated.length * 2, "non-Pulse calls must not be swallowed");
  sandbox.fetch();
  assert.equal(calls.at(-1).args.length, 0, "preserve missing-argument semantics");

  // Verify error/promise semantics against original transports, not a reimplementation.
  for (const asynchronous of [false, true]) {
    const error = new TypeError("synthetic transport failure");
    const f = fixture(text);
    const rejection = asynchronous ? Promise.reject(error) : null;
    f.sandbox.fetch = function () { if (asynchronous) return rejection; throw error; };
    f.sandbox.navigator.sendBeacon = function () { throw error; };
    f.install();
    if (asynchronous) {
      const promise = f.sandbox.fetch("/local");
      assert.equal(promise, rejection);
      await assert.rejects(promise, candidate => candidate === error);
    } else assert.throws(() => f.sandbox.fetch("/local"), candidate => candidate === error);
    assert.throws(() => f.sandbox.navigator.sendBeacon("/local"), candidate => candidate === error);
  }
}

function checkFailures() {
  for (const feature of ["fetch", "Response", "URL", "Request", "sendBeacon", "navigator"]) {
    const f = fixture();
    if (feature === "sendBeacon") delete f.sandbox.navigator.sendBeacon;
    else delete f.sandbox[feature];
    assert.throws(f.install, /guard unavailable/);
    assert.throws(f.install, /guard unavailable/, "failed installation stays closed");
    assert.deepEqual(f.calls, []);
  }
  for (const transport of ["fetch", "sendBeacon"]) {
    for (const mode of ["readonly", "ignored-setter", "throwing-setter"]) {
      const f = fixture();
      const owner = transport === "fetch" ? f.sandbox : f.sandbox.navigator;
      const value = owner[transport];
      Object.defineProperty(owner, transport, mode === "readonly" ? { value, writable: false } : {
        get: () => value,
        set() { if (mode === "throwing-setter") throw new Error("synthetic setter failure"); }
      });
      assert.throws(f.install, error => mode === "readonly" ? error.name === "TypeError" :
        error.message === (mode === "ignored-setter" ? "WalletConnect telemetry guard installation failed" : "synthetic setter failure"));
      assert.throws(f.install, /guard unavailable/);
      assert.deepEqual(f.calls, []);
    }
    const f = fixture();
    f.install();
    const owner = transport === "fetch" ? f.sandbox : f.sandbox.navigator;
    owner[transport] = () => {};
    assert.throws(f.install, /guard replaced/, "do not accept an overwritten guard");
  }
}

async function main() {
  await checkBoundary();
  checkFailures();
  const mutations = [
    ["exact origin", source.replace('.origin === "https://pulse.walletconnect.org"', '.hostname.endsWith("walletconnect.org")')],
    ["fetch suppression", source.replace("if (isPulse(input)) {", "if (false) {")],
    ["Beacon suppression", source.replace("if (isPulse(url)) return true;", "if (false) return true;")],
    ["JSON response", source.replace('ResponseConstructor("{}"', 'ResponseConstructor(""')],
    ["fetch receiver", source.replace("Reflect.apply(nativeFetch, this, arguments)", "Reflect.apply(nativeFetch, scope, arguments)")],
    ["Beacon result", source.replace("return Reflect.apply(nativeBeacon, this, arguments)", "Reflect.apply(nativeBeacon, this, arguments); return true")]
  ];
  for (const [name, mutated] of mutations) {
    assert.notEqual(mutated, source, name + ": mutation must apply");
    await assert.rejects(() => checkBoundary(mutated), undefined, name + ": mutation must fail");
  }
  console.log("[wallet-telemetry-guard] PASS exact-origin fetch/Beacon boundary, delegation, persistence, failures; 6 mutations rejected (no network)");
}

module.exports = { loadGuard, guardUrl };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
