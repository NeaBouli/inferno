"use strict";

// Run with: node --test test/sepolia-forum-testenv.test.cjs
// The runtime is created explicitly; the repository's dotenv config is never imported.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const ethers = require("ethers");
const { prepare, deploy, createRuntime, compileArtifacts } = require("../scripts/sepolia-forum-testenv.js");

const ROOT = path.resolve(__dirname, "..");
const directories = [];
let connection, provider, artifacts;

function fixture() {
  const directory = fs.mkdtempSync(path.join(ROOT, ".sepolia-forum-test-"));
  directories.push(directory);
  const output = [];
  const deployer = prepare({ directory, log: (line) => output.push(line) });
  return { directory, deployer, output };
}

async function fund(address) {
  await connection.provider.request({ method: "hardhat_setBalance",
    params: [address, ethers.toQuantity(ethers.parseEther("0.1"))] });
}

// Wrap only the RPC methods needed by the scenario, preserving all other
// BrowserProvider behavior and keeping every transaction on the in-process EDR.
function wrapProvider(overrides) {
  return new Proxy(provider, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

before(async () => {
  artifacts = await compileArtifacts();
  const runtime = await createRuntime();
  connection = await runtime.network.create("hardhat");
  provider = new ethers.BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
});

after(async () => {
  provider?.destroy();
  await connection?.close();
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
});

test("prepare creates fresh protected throwaway accounts, prints only funding details, and refuses overwrite", () => {
  const { directory, deployer, output } = fixture();
  const keyFile = path.join(directory, "keys.json");
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  // This is solely the NEW fixture generated above, never an existing wallet file.
  const keys = JSON.parse(fs.readFileSync(keyFile, "utf8"));
  const digest = () => createHash("sha256").update(fs.readFileSync(keyFile)).digest("hex");
  const originalDigest = digest();
  assert.equal(keys.voters.length, 3);
  assert.equal(new Set([keys.deployer, ...keys.voters].map((account) => account.address)).size, 4);
  assert.deepEqual(output, [`Deployer: ${deployer}`,
    "Required funding target: 0.1 Sepolia ETH (includes 0.03 ETH for the voters and gas)."]);
  for (const account of [keys.deployer, ...keys.voters]) {
    assert.equal(new ethers.Wallet(account.privateKey).address, account.address);
    assert.ok(!output.join("\n").includes(account.privateKey), "Secret appeared in prepare output");
    assert.equal(account.mnemonic, undefined);
  }
  assert.throws(() => prepare({ directory, log: () => assert.fail("Unexpected output") }), /refusing to overwrite/);
  assert.equal(digest(), originalDigest);
});

test("full local deploy locks 1000/500/250 IFR, funds voters, and reruns without transactions", async () => {
  const { directory, deployer } = fixture();
  await fund(deployer);
  const output = [];
  const result = await deploy({ directory, provider, artifacts, log: (line) => output.push(line) });
  const token = new ethers.Contract(result.token, artifacts.token.abi, provider);
  const lock = new ethers.Contract(result.lock, artifacts.lock.abi, provider);
  const expected = ["1000", "500", "250"].map((amount) => ethers.parseUnits(amount, 9));
  assert.equal((await provider.getNetwork()).chainId, 31337n);
  assert.deepEqual(result.balances, expected);
  assert.equal(result.totalLocked, ethers.parseUnits("1750", 9));
  assert.equal(await lock.totalLocked(), result.totalLocked);
  assert.equal(await token.balanceOf(result.lock), result.totalLocked);
  assert.equal(await token.decimals(), 9n);
  assert.equal(await token.poolFeeReceiver(), deployer);
  assert.equal(await token.owner(), deployer);
  assert.equal(await lock.guardian(), deployer);
  assert.equal(await lock.token(), result.token);
  assert.equal(await token.feeExempt(result.lock), true);
  assert.equal(await token.feeExempt(deployer), false);
  assert.equal(await token.totalSupply(), ethers.parseUnits("1000000000", 9));
  for (const [index, voter] of result.voters.entries()) {
    assert.equal(await lock.lockedBalance(voter), expected[index]);
    assert.equal(await token.balanceOf(voter), 0n);
    assert.equal(await provider.getTransactionCount(voter), 2);
    const ethBalance = await provider.getBalance(voter);
    assert.ok(ethBalance > 0n && ethBalance < ethers.parseEther("0.01"));
    assert.ok(output.some((line) => line.includes(voter) && line.includes("lockedBalance=")));
  }
  const block = await provider.getBlock(result.blockNumber);
  assert.equal(result.blockHash, block.hash);
  assert.ok(output.includes(`Latest block: ${result.blockNumber} ${result.blockHash}`));
  assert.ok(output.some((line) => line.startsWith("totalLocked=1750.0 IFR")));
  assert.ok(!output.join("\n").match(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g)?.some((value) => value !== result.blockHash));
  const stateFile = path.join(directory, "state.json");
  assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
  const journal = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(Object.keys(journal.steps).length, 17);
  assert.ok(Object.values(journal.steps).every((step) => step.status === "confirmed"));
  assert.equal(journal.privateKey, undefined);
  const nonce = await provider.getTransactionCount(deployer);
  const ethBalance = await provider.getBalance(deployer);
  const again = await deploy({ directory,
    provider: wrapProvider({ broadcastTransaction: () => assert.fail("Rerun broadcast a transaction") }),
    artifacts, log: () => {} });
  assert.deepEqual(again, result);
  assert.equal(await provider.getTransactionCount(deployer), nonce);
  assert.equal(await provider.getBalance(deployer), ethBalance);
});

test("chainId 1 (and every non-allowlisted chain) is refused before keys or state are accessed", async () => {
  for (const chainId of ["0x1", "0xaa36a8", "0x7a6a"]) {
    const rpc = { send: async (method) => {
      assert.equal(method, "eth_chainId");
      return chainId;
    } };
    await assert.rejects(deploy({ directory: path.join(ROOT, "not-created"), provider: rpc,
      artifacts, log: () => assert.fail("Unexpected output") }), /Refusing chainId/);
  }
});

test("a timeout after acceptance resumes the journaled transaction without a duplicate deployment", async () => {
  const { directory, deployer } = fixture();
  await fund(deployer);
  let firstHash;
  const interrupted = wrapProvider({
    broadcastTransaction: async (raw) => {
      const journal = JSON.parse(fs.readFileSync(path.join(directory, "state.json"), "utf8"));
      assert.equal(journal.steps["deploy-token"].rawTransaction, raw, "Journal must precede broadcast");
      firstHash = ethers.Transaction.from(raw).hash;
      await provider.broadcastTransaction(raw);
      // Simulate an RPC that accepted the transaction but lost the response.
      return new Promise(() => {});
    },
  });
  await assert.rejects(deploy({ directory, provider: interrupted, artifacts, txTimeoutMs: 1000, log: () => {} }), /timed out/);
  assert.ok(firstHash, "The timeout must happen after a broadcast");
  assert.equal(await provider.getTransactionCount(deployer), 1);
  const receipt = await provider.getTransactionReceipt(firstHash);
  const result = await deploy({ directory, provider, artifacts, log: () => {} });
  assert.equal(result.token, receipt.contractAddress);
  assert.equal(await provider.getTransactionCount(deployer), 11);
  assert.equal(result.totalLocked, ethers.parseUnits("1750", 9));
});

test("an interrupted pre-broadcast step reuses the saved nonce and signed transaction", async () => {
  const { directory, deployer } = fixture();
  await fund(deployer);
  let savedRaw;
  const interrupted = wrapProvider({ broadcastTransaction: async (raw) => {
    savedRaw = raw;
    throw new Error("Simulated transport failure with sensitive RPC details");
  } });
  await assert.rejects(deploy({ directory, provider: interrupted, artifacts, log: () => {} }),
    /deploy-token failed; progress is saved/);
  assert.equal(await provider.getTransactionCount(deployer), 0);
  let firstBroadcast = true;
  const resumed = wrapProvider({ broadcastTransaction: async (raw) => {
    if (firstBroadcast) {
      assert.equal(raw, savedRaw);
      firstBroadcast = false;
    }
    return provider.broadcastTransaction(raw);
  } });
  const result = await deploy({ directory, provider: resumed, artifacts, log: () => {} });
  assert.equal(result.totalLocked, ethers.parseUnits("1750", 9));
});

test("a timed-out RPC preparation cannot broadcast later in the background", async () => {
  const { directory, deployer } = fixture();
  await fund(deployer);
  let release;
  const delayed = wrapProvider({
    send: async (method, params) => {
      if (method === "eth_getTransactionCount") {
        return new Promise((resolve) => { release = resolve; });
      }
      return provider.send(method, params);
    },
    broadcastTransaction: () => assert.fail("Timed-out step broadcast in the background"),
  });
  await assert.rejects(deploy({ directory, provider: delayed, artifacts, txTimeoutMs: 1000, log: () => {} }), /timed out/);
  assert.ok(release);
  release("0x0");
  // Let the timed-out asynchronous preparation finish before checking its effects.
  await new Promise(setImmediate);
  const state = JSON.parse(fs.readFileSync(path.join(directory, "state.json"), "utf8"));
  assert.deepEqual(state.steps, {});
  assert.equal(await provider.getTransactionCount(deployer), 0);
});

test("state from another network is refused without broadcasting", async () => {
  const { directory, deployer } = fixture();
  await fund(deployer);
  await deploy({ directory, provider, artifacts, log: () => {} });
  const stateFile = path.join(directory, "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.chainId = "11155111";
  fs.writeFileSync(stateFile, JSON.stringify(state));
  await assert.rejects(deploy({ directory,
    provider: wrapProvider({ broadcastTransaction: () => assert.fail("Unexpected broadcast") }),
    artifacts, log: () => {} }), /Saved state chainId does not match/);
});
