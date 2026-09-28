#!/usr/bin/env node

// Focused gate test for scripts/deploy-mainnet-continue.js::main.
// Runs the real script in a child process with the Hardhat runtime replaced by
// an in-memory stub (this file, preloaded via -r). No network, no keys, and the
// child never inherits the parent environment.

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "scripts", "deploy-mainnet-continue.js");
const runtimePath = path.join(root, "scripts", "lib", "hardhat-runtime.js");
const DEPLOY_MARKER = "STUB_SAFE_DEPLOY_REACHED";
const DEPLOYER = "0x00000000000000000000000000000000000000D1";

function installStub() {
  const chainId = BigInt(process.env.T137_CHAIN_ID);
  const supply = 1_000_000_000n * 10n ** 9n;
  const deployerBal = process.env.T137_SUPPLY_MISMATCH === "1" ? supply - 1n : supply;
  const ethers = {
    ZeroAddress: "0x0000000000000000000000000000000000000000",
    isAddress: (value) => /^0x[0-9a-fA-F]{40}$/.test(value),
    getAddress: (value) => value.toLowerCase(),
    parseUnits: (n, d) => BigInt(n) * 10n ** BigInt(d),
    formatUnits: (v) => String(v),
    formatEther: (v) => String(v),
    getSigners: async () => [{ address: DEPLOYER }],
    provider: {
      getNetwork: async () => ({ name: "stub", chainId }),
      getBalance: async () => 0n,
    },
    getContractAt: async (name, address) => ({
      target: address,
      totalSupply: async () => supply,
      balanceOf: async () => deployerBal,
      owner: async () => DEPLOYER,
      delay: async () => 172800n,
    }),
    getContractFactory: async () => ({
      deploy: async () => {
        console.log(DEPLOY_MARKER);
        process.exit(0);
      },
    }),
  };
  require.cache[runtimePath] = {
    id: runtimePath,
    filename: runtimePath,
    loaded: true,
    exports: { connectHardhat: async () => ({ ethers }) },
  };
}

function run(chainId, extraEnv = {}) {
  const result = spawnSync(process.execPath, ["-r", __filename, scriptPath], {
    cwd: root,
    env: { PATH: process.env.PATH, T137_GATE_STUB: "1", T137_CHAIN_ID: String(chainId), ...extraEnv },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function assertAborted(label, result, pattern) {
  assert.notEqual(result.status, 0, `${label}: must exit non-zero`);
  assert.ok(!result.output.includes(DEPLOY_MARKER), `${label}: safeDeploy must not be reached`);
  if (pattern) assert.match(result.output, pattern, `${label}: abort reason`);
}

const roles = {
  TREASURY_ADDRESS: "0x00000000000000000000000000000000000000a1",
  COMMUNITY_ADDRESS: "0x00000000000000000000000000000000000000a2",
  TEAM_BENEFICIARY: "0x00000000000000000000000000000000000000a3",
  VOUCHER_SIGNER_ADDRESS: "0x00000000000000000000000000000000000000a4",
  GUARDIAN_ADDRESS: "0x00000000000000000000000000000000000000a5",
};

function runCases() {
  // Sepolia is always rejected, even with every role set.
  assertAborted("sepolia", run(11155111, roles), /Use deploy-testnet\.js for Sepolia/);

  // Chain 1 without any role env: every role reported missing.
  const mainnetUnset = run(1);
  assertAborted("mainnet unset roles", mainnetUnset, /ABORT: Required env vars/);
  for (const key of Object.keys(roles)) {
    assert.match(mainnetUnset.output, new RegExp(`- ${key}\\b`), `mainnet unset roles: ${key} listed`);
  }

  assertAborted("mainnet malformed role", run(1, { ...roles, COMMUNITY_ADDRESS: "not-an-address" }), /- COMMUNITY_ADDRESS\b/);
  assertAborted("mainnet zero role", run(1, { ...roles, COMMUNITY_ADDRESS: ethersZeroAddress() }), /- COMMUNITY_ADDRESS\b/);
  assertAborted("mainnet duplicate roles", run(1, { ...roles, COMMUNITY_ADDRESS: roles.TREASURY_ADDRESS }), /- COMMUNITY_ADDRESS\b/);

  // Chain 1 with each single role missing or reusing the deployer (any case).
  for (const key of Object.keys(roles)) {
    const { [key]: _omitted, ...withoutKey } = roles;
    assertAborted(`mainnet missing ${key}`, run(1, withoutKey), new RegExp(`- ${key}\\b`));
    assertAborted(`mainnet ${key}=deployer`, run(1, { ...roles, [key]: DEPLOYER.toLowerCase() }), new RegExp(`- ${key}\\b`));
  }

  // Supply mismatch aborts before any deployment.
  assertAborted("supply mismatch", run(31337, { T137_SUPPLY_MISMATCH: "1" }), /Deployer doesn't hold full supply/);
  assertAborted("mainnet supply mismatch", run(1, { ...roles, T137_SUPPLY_MISMATCH: "1" }), /Deployer doesn't hold full supply/);

  // Safe paths reach safeDeploy: local dry run with deployer fallback, and chain 1 with distinct roles.
  for (const [label, result] of [["hardhat dry run", run(31337)], ["mainnet distinct roles", run(1, roles)]]) {
    assert.equal(result.status, 0, `${label}: must pass the gate\n${result.output}`);
    assert.ok(result.output.includes(DEPLOY_MARKER), `${label}: safeDeploy must be reached`);
  }

  console.log("[deploy-mainnet-continue-gate] PASS");
}

function ethersZeroAddress() {
  return "0x0000000000000000000000000000000000000000";
}

if (process.env.T137_GATE_STUB === "1") {
  installStub();
} else {
  runCases();
}
