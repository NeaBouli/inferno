#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const configUrl = pathToFileURL(path.join(root, "hardhat.config.js")).href;
const inspectScript = `
  const config = (await import(${JSON.stringify(configUrl)})).default;
  const summarize = (network) => ({
    forked: Boolean(network.forking),
    blockNumber: network.forking?.blockNumber ?? null,
  });
  console.log(JSON.stringify({
    default: summarize(config.networks.default),
    hardhat: summarize(config.networks.hardhat),
    mainnet: config.networks.mainnet
      ? {
          configured: true,
          type: config.networks.mainnet.type,
          chainType: config.networks.mainnet.chainType,
          urlMatchesEnvironment:
            config.networks.mainnet.url === process.env.MAINNET_RPC_URL,
          accountsRemote: config.networks.mainnet.accounts === "remote",
        }
      : { configured: false },
  }));
`;

function runConfig(overrides) {
  const env = {
    ...process.env,
    MAINNET_RPC_URL: "",
    HARDHAT_FORK: "",
    HARDHAT_FORK_BLOCK_NUMBER: "",
    DEPLOYER_PRIVATE_KEY: "",
    ...overrides,
  };
  return spawnSync(process.execPath, ["--input-type=module", "-e", inspectScript], {
    cwd: root,
    env,
    encoding: "utf8",
  });
}

function loadConfig(overrides) {
  const result = runConfig(overrides);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split("\n").at(-1));
}

function assertConfigError(overrides, expectedMessage) {
  const result = runConfig(overrides);
  assert.notEqual(result.status, 0, "invalid fork configuration must fail");
  assert.match(result.stderr, expectedMessage);
}

const rpcUrl = "https://rpc.invalid.example";

const localOnlyConfig = loadConfig({});
assert.deepEqual(localOnlyConfig.mainnet, { configured: false });

const defaultConfig = loadConfig({ MAINNET_RPC_URL: rpcUrl });
assert.deepEqual(defaultConfig.default, { forked: false, blockNumber: null });
assert.deepEqual(defaultConfig.hardhat, { forked: false, blockNumber: null });
assert.deepEqual(defaultConfig.mainnet, {
  configured: true,
  type: "http",
  chainType: "l1",
  urlMatchesEnvironment: true,
  accountsRemote: true,
});

const disabledFork = loadConfig({
  MAINNET_RPC_URL: rpcUrl,
  HARDHAT_FORK: "false",
  HARDHAT_FORK_BLOCK_NUMBER: "not-used",
});
assert.deepEqual(disabledFork.default, { forked: false, blockNumber: null });
assert.deepEqual(disabledFork.hardhat, { forked: false, blockNumber: null });

const explicitFork = loadConfig({
  MAINNET_RPC_URL: rpcUrl,
  HARDHAT_FORK: "true",
  HARDHAT_FORK_BLOCK_NUMBER: "12345678",
});
assert.deepEqual(explicitFork.default, {
  forked: true,
  blockNumber: 12345678,
});
assert.deepEqual(explicitFork.hardhat, {
  forked: true,
  blockNumber: 12345678,
});
assert.equal(explicitFork.mainnet.configured, true);

assertConfigError(
  { HARDHAT_FORK: "true", HARDHAT_FORK_BLOCK_NUMBER: "12345678" },
  /HARDHAT_FORK=true requires MAINNET_RPC_URL/,
);
assertConfigError(
  { MAINNET_RPC_URL: rpcUrl, HARDHAT_FORK: "true" },
  /positive HARDHAT_FORK_BLOCK_NUMBER/,
);
assertConfigError(
  {
    MAINNET_RPC_URL: rpcUrl,
    HARDHAT_FORK: "true",
    HARDHAT_FORK_BLOCK_NUMBER: "latest",
  },
  /positive HARDHAT_FORK_BLOCK_NUMBER/,
);
assertConfigError(
  {
    MAINNET_RPC_URL: rpcUrl,
    HARDHAT_FORK: "true",
    HARDHAT_FORK_BLOCK_NUMBER: "99999999999999999999",
  },
  /exceeds JavaScript safe integer range/,
);
assertConfigError(
  { MAINNET_RPC_URL: rpcUrl, HARDHAT_FORK: "1" },
  /HARDHAT_FORK must be either "true" or "false"/,
);

console.log("[hardhat-network-config] PASS");
