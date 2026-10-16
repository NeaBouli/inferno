"use strict";

// node scripts/sepolia-forum-testenv.js prepare
// Fund the printed deployer with about 0.1 Sepolia ETH, then:
// node scripts/sepolia-forum-testenv.js deploy
// No dotenv or shared deployment configuration is loaded.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const ethers = require("ethers");

const DIRECTORY = "/Users/gio/.ifr-sepolia-testenv";
const DEFAULT_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const TX_TIMEOUT_MS = 120_000;
const LOCK_AMOUNTS = ["1000", "500", "250"];
const VOTER_ETH = ethers.parseEther("0.01");
const ROOT = path.resolve(__dirname, "..");

class TestenvError extends Error {}

function check(condition, message) {
  if (!condition) throw new TestenvError(message);
}

function checkDirectory(directory) {
  const stat = fs.lstatSync(directory);
  check(stat.isDirectory() && !stat.isSymbolicLink(), "Storage must be a real directory.");
  check((stat.mode & 0o777) === 0o700 && stat.uid === process.getuid(),
    "Storage directory must be owned by the current user with mode 0700.");
}

function writeExclusive(filename, data) {
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT |
    fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, JSON.stringify(data, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readSecure(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    check(stat.isFile() && (stat.mode & 0o777) === 0o600 && stat.uid === process.getuid(),
      "Keys and state must be regular files owned by the current user with mode 0600.");
    return JSON.parse(fs.readFileSync(fd, "utf8"));
  } finally {
    fs.closeSync(fd);
  }
}

function saveState(filename, state) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    writeExclusive(temporary, state);
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function prepare({ directory = DIRECTORY, log = console.log } = {}) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  checkDirectory(directory);
  const filename = path.join(directory, "keys.json");
  check(!fs.existsSync(filename), "keys.json already exists; refusing to overwrite it.");
  const accounts = Array.from({ length: 4 }, () => {
    const wallet = ethers.Wallet.createRandom();
    return { address: wallet.address, privateKey: wallet.privateKey };
  });
  writeExclusive(filename, { version: 1, deployer: accounts[0], voters: accounts.slice(1) });
  log(`Deployer: ${accounts[0].address}`);
  log("Required funding target: 0.1 Sepolia ETH (includes 0.03 ETH for the voters and gas).");
  return accounts[0].address;
}

async function withTimeout(action, milliseconds, label) {
  let timer;
  const controller = new AbortController();
  try {
    return await Promise.race([
      action(controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new TestenvError(`${label} timed out; rerun deploy to resume.`);
          controller.abort(error);
          reject(error);
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function allowedChain(provider) {
  // Query the RPC itself, rather than trusting a cached/static network object.
  const chainId = BigInt(await provider.send("eth_chainId", []));
  check(chainId === 11155111n || chainId === 31337n,
    `Refusing chainId ${chainId}; only Sepolia (11155111) and local Hardhat (31337) are allowed.`);
  return chainId;
}

async function createRuntime() {
  const { createHardhatRuntimeEnvironment } = await import("hardhat/hre");
  const { default: config } = await import("../hardhat.sepolia-forum-testenv.config.js");
  return createHardhatRuntimeEnvironment(config,
    { config: path.join(ROOT, "hardhat.sepolia-forum-testenv.config.js") }, ROOT);
}

async function compileArtifacts() {
  const runtime = await createRuntime();
  await runtime.tasks.getTask("compile").run({ quiet: true });
  return {
    token: await runtime.artifacts.readArtifact("contracts/token/InfernoToken.sol:InfernoToken"),
    lock: await runtime.artifacts.readArtifact("contracts/lock/IFRLock.sol:IFRLock"),
  };
}

function loadAccounts(directory, provider) {
  checkDirectory(directory);
  const keys = readSecure(path.join(directory, "keys.json"));
  check(keys.version === 1 && Array.isArray(keys.voters) && keys.voters.length === 3,
    "Invalid keys.json format; expected one deployer and three voters.");
  const accounts = [keys.deployer, ...keys.voters].map((account) => {
    const wallet = new ethers.Wallet(account.privateKey, provider);
    check(wallet.address === account.address, "Account address does not match keys.json.");
    return wallet;
  });
  check(new Set(accounts.map((account) => account.address)).size === 4, "Accounts must be distinct.");
  return { deployer: accounts[0], voters: accounts.slice(1) };
}

async function deploy({ directory = DIRECTORY, provider, artifacts,
  txTimeoutMs = TX_TIMEOUT_MS, log = console.log } = {}) {
  check(provider, "An RPC provider is required.");
  const chainId = await withTimeout(() => allowedChain(provider), txTimeoutMs, "Chain check");
  const { deployer, voters } = loadAccounts(directory, provider);
  const genesis = await provider.getBlock(0);
  check(genesis?.hash, "Cannot identify chain genesis block.");
  const identity = { version: 1, chainId: String(chainId), genesisHash: genesis.hash,
    deployer: deployer.address, voters: voters.map((voter) => voter.address) };
  const stateFile = path.join(directory, "state.json");
  const state = fs.existsSync(stateFile) ? readSecure(stateFile) : { ...identity, steps: {} };
  for (const [field, expected] of Object.entries(identity)) {
    check(JSON.stringify(state[field]) === JSON.stringify(expected),
      `Saved state ${field} does not match this chain and key set; refusing to continue.`);
  }
  check(state.steps && typeof state.steps === "object", "Invalid state steps.");
  saveState(stateFile, state);
  artifacts ??= await compileArtifacts();

  async function step(name, signer, request) {
    try {
      return await withTimeout(async (signal) => {
        check(await allowedChain(provider) === chainId, "RPC chain changed; refusing to continue.");
        signal.throwIfAborted();
        let entry = state.steps[name];
        if (!entry) {
          // Journal the signed transaction BEFORE broadcasting. A retry reuses
          // its hash and nonce, including after a timeout or process interruption.
          const nonce = Number(BigInt(await provider.send("eth_getTransactionCount", [signer.address, "pending"])));
          signal.throwIfAborted();
          const transaction = await signer.populateTransaction({ ...request, nonce, chainId });
          signal.throwIfAborted();
          const rawTransaction = await signer.signTransaction(transaction);
          signal.throwIfAborted();
          entry = state.steps[name] = { rawTransaction,
            hash: ethers.Transaction.from(rawTransaction).hash, status: "pending" };
          saveState(stateFile, state);
        }
        const signed = ethers.Transaction.from(entry.rawTransaction);
        check(signed.chainId === chainId && signed.hash === entry.hash && signed.from === signer.address,
          `Invalid transaction journal for ${name}.`);
        let receipt = await provider.getTransactionReceipt(entry.hash);
        signal.throwIfAborted();
        if (!receipt) {
          check(entry.status !== "confirmed", `Confirmed transaction missing for ${name}; refusing to replay it.`);
          if (!await provider.getTransaction(entry.hash)) {
            check(await allowedChain(provider) === chainId, "RPC chain changed; refusing to broadcast.");
            signal.throwIfAborted();
            await provider.broadcastTransaction(entry.rawTransaction);
          }
          receipt = await provider.waitForTransaction(entry.hash, 1, txTimeoutMs);
        }
        signal.throwIfAborted();
        check(receipt?.status === 1, `${name} reverted or was not confirmed; inspect the saved transaction.`);
        entry.status = "confirmed";
        saveState(stateFile, state);
        return receipt;
      }, txTimeoutMs, name);
    } catch (error) {
      if (error instanceof TestenvError) throw error;
      // RPC/ethers errors may contain signed transactions or provider credentials.
      throw new TestenvError(`${name} failed; progress is saved. Check RPC/funding and rerun deploy.`);
    }
  }

  // Match scripts/deploy-testnet.js: poolFeeReceiver = deployer.
  const tokenFactory = new ethers.ContractFactory(artifacts.token.abi, artifacts.token.bytecode, deployer);
  const tokenReceipt = await step("deploy-token", deployer, await tokenFactory.getDeployTransaction(deployer.address));
  check(tokenReceipt.contractAddress, "Token deployment did not create a contract.");
  const token = new ethers.Contract(tokenReceipt.contractAddress, artifacts.token.abi, deployer);
  // Match scripts/deploy-lock.js: IFRLock(token, deployer-as-guardian).
  const lockFactory = new ethers.ContractFactory(artifacts.lock.abi, artifacts.lock.bytecode, deployer);
  const lockReceipt = await step("deploy-lock", deployer,
    await lockFactory.getDeployTransaction(token.target, deployer.address));
  check(lockReceipt.contractAddress, "Lock deployment did not create a contract.");
  const lock = new ethers.Contract(lockReceipt.contractAddress, artifacts.lock.abi, deployer);

  // deploy-testnet.js exempts the deployer temporarily for distribution;
  // deploy-lock.js requests the permanent IFRLock exemption via governance.
  // Here the new token is still owned by our throwaway deployer.
  await step("exempt-deployer", deployer, await token.setFeeExempt.populateTransaction(deployer.address, true));
  await step("exempt-lock", deployer, await token.setFeeExempt.populateTransaction(lock.target, true));
  for (const [index, voter] of voters.entries()) {
    const amount = ethers.parseUnits(LOCK_AMOUNTS[index], 9);
    await step(`voter-${index}-eth`, deployer, { to: voter.address, value: VOTER_ETH });
    await step(`voter-${index}-ifr`, deployer, await token.transfer.populateTransaction(voter.address, amount));
    await step(`voter-${index}-approve`, voter, await token.connect(voter).approve.populateTransaction(lock.target, amount));
    await step(`voter-${index}-lock`, voter, await lock.connect(voter).lock.populateTransaction(amount));
  }
  await step("restore-deployer-fees", deployer, await token.setFeeExempt.populateTransaction(deployer.address, false));

  const balances = await Promise.all(voters.map((voter) => lock.lockedBalance(voter.address)));
  const totalLocked = await lock.totalLocked();
  check(balances.every((balance, index) => balance === ethers.parseUnits(LOCK_AMOUNTS[index], 9)) &&
    totalLocked === ethers.parseUnits("1750", 9), "Locked balances do not match the ballot fixture.");
  const block = await provider.getBlock("latest");
  check(block?.hash, "Cannot read latest block evidence.");
  log(`InfernoToken: ${token.target}`);
  log(`IFRLock: ${lock.target}`);
  voters.forEach((voter, index) => log(`Voter ${index + 1}: ${voter.address} lockedBalance=${ethers.formatUnits(balances[index], 9)} IFR (${balances[index]} base units)`));
  log(`totalLocked=${ethers.formatUnits(totalLocked, 9)} IFR (${totalLocked} base units)`);
  log(`Latest block: ${block.number} ${block.hash}`);
  return { token: token.target, lock: lock.target, voters: voters.map((voter) => voter.address),
    balances, totalLocked, blockNumber: block.number, blockHash: block.hash };
}

async function main() {
  check(process.argv.length === 3 && ["prepare", "deploy"].includes(process.argv[2]),
    "Usage: node scripts/sepolia-forum-testenv.js prepare|deploy");
  if (process.argv[2] === "prepare") return prepare();
  const request = new ethers.FetchRequest(process.env.SEPOLIA_RPC_URL || DEFAULT_RPC);
  request.timeout = 30_000;
  const provider = new ethers.JsonRpcProvider(request, undefined, { cacheTimeout: -1 });
  try {
    await deploy({ provider });
  } finally {
    provider.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof TestenvError ? error.message :
      "Test environment operation failed. Check file permissions, RPC availability and funding; no secrets are logged.");
    process.exitCode = 1;
  });
}

module.exports = { prepare, deploy, allowedChain, createRuntime, compileArtifacts, TX_TIMEOUT_MS };
