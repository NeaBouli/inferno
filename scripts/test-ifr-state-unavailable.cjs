#!/usr/bin/env node

// CWA-48 behavioral gate for docs/assets/ifr-state.js.
// Loads the real module in a vm sandbox with a stubbed IFRWallet/ethers and
// proves: on aggregate AND individual bootstrap RPC failure the state carries
// an explicit unavailable marker with null values — never a fabricated
// `finalized:false` / `0 raised` chain value — and that both success paths
// set `available: true`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "docs", "assets", "ifr-state.js"), "utf8");

function makeSandbox({ bootstrapBehavior }) {
  const walletListeners = [];
  const providerStub = {
    getBalance: async () => 0n,
  };
  const contractStub = {
    getBootstrapStatus: bootstrapBehavior.getBootstrapStatus,
    totalETHRaised: bootstrapBehavior.totalETHRaised,
    ifrAllocation: bootstrapBehavior.ifrAllocation,
    startTime: bootstrapBehavior.startTime,
    endTime: bootstrapBehavior.endTime,
    finalised: bootstrapBehavior.finalised,
    contributions: async () => 0n,
    claimed: async () => false,
  };
  const sandbox = {
    console: { warn() {}, log() {} },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    ethers: {
      Contract: function () { return contractStub; },
      formatEther: (v) => (Number(v) / 1e18).toString(),
      formatUnits: (v) => (Number(v) / 1e9).toString(),
      parseUnits: (v, d) => BigInt(Math.round(Number(v) * 10 ** d)),
    },
    document: { addEventListener() {} },
    navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  sandbox.window = sandbox;
  sandbox.IFRWallet = {
    getProvider: () => providerStub,
    isConnected: () => false,
    getAddress: () => null,
    on: (event, cb) => walletListeners.push({ event, cb }),
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "ifr-state.js" });
  return sandbox.IFRState;
}

const fail = async () => { throw new Error("RPC unreachable"); };

async function main() {
// ── Total RPC failure → explicit unavailable, no fabricated values ────
{
  const IFRState = makeSandbox({
    bootstrapBehavior: {
      getBootstrapStatus: fail,
      totalETHRaised: fail,
      ifrAllocation: fail,
      startTime: fail,
      endTime: fail,
      finalised: fail,
    },
  });
  const state = await IFRState.load(null);
  assert.ok(state.bootstrapStatus, "bootstrapStatus must exist on total failure");
  assert.equal(state.bootstrapStatus.available, false, "status must be marked unavailable");
  for (const field of ["active", "finalized", "totalETHRaised", "contributorCount", "timeRemaining", "startTime", "endTime", "ifrAllocation"]) {
    assert.equal(state.bootstrapStatus[field], null, `${field} must be null when unavailable`);
  }
  const serialized = JSON.stringify(state.bootstrapStatus);
  assert.ok(!serialized.includes('"0.0"') && !serialized.includes("200000000") && !serialized.includes("false,null"),
    `unavailable status must not contain fabricated chain values: ${serialized}`);
  assert.ok(!serialized.includes("1772841600000"), "unavailable status must not contain the old hardcoded startTime");
}

// ── Aggregate success → available with real values ─────────────────────
{
  const IFRState = makeSandbox({
    bootstrapBehavior: {
      getBootstrapStatus: async () => ({ active: false, _finalised: true, totalETH: 3n, timeRemaining: 0n, contributorCount: 3n }),
      totalETHRaised: async () => 30000000000000000n,
      ifrAllocation: async () => 200000000n * 1000000000n,
      startTime: async () => 1772841600n,
      endTime: async () => 1780617600n,
      finalised: async () => true,
    },
  });
  const state = await IFRState.load(null);
  assert.equal(state.bootstrapStatus.available, true, "aggregate success must be available");
  assert.equal(state.bootstrapStatus.finalized, true, "aggregate success must carry the real finalized flag");
  assert.equal(state.bootstrapStatus.contributorCount, 3);
}

// ── Aggregate failure + individual success → available via fallback ────
{
  const IFRState = makeSandbox({
    bootstrapBehavior: {
      getBootstrapStatus: fail,
      totalETHRaised: async () => 30000000000000000n,
      ifrAllocation: async () => 200000000n * 1000000000n,
      startTime: async () => 1772841600n,
      endTime: async () => 1780617600n,
      finalised: async () => true,
    },
  });
  const state = await IFRState.load(null);
  assert.equal(state.bootstrapStatus.available, true, "individual fallback success must be available");
  assert.equal(state.bootstrapStatus.finalized, true, "individual fallback must carry the real finalized flag");
  assert.equal(state.bootstrapStatus.totalETHRaised, "0.03", "individual fallback must carry the real raised value");
}

console.log("[ifr-state-unavailable-test] PASS (unavailable semantics, aggregate path, individual fallback)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
