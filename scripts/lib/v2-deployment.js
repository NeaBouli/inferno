"use strict";

const DELAY = 172800n;
const MAX_DELAY = 2592000n;
const CONTRACTS = ["GovernanceV2", "LendingVaultV2", "CommitmentVaultV2"];

function flag(env, name) {
  if (env[name] !== undefined && !["true", "false"].includes(env[name])) {
    throw new Error(`${name} must be true or false`);
  }
  return env[name] === "true";
}

// No signer or private key is accessed while preparing this manifest.
async function prepareV2Deployment({ ethers, artifacts, chainId, networkName, env }) {
  const broadcast = flag(env, "V2_BROADCAST");
  const allowMainnet = flag(env, "V2_ALLOW_MAINNET");
  if ((BigInt(chainId) === 1n || networkName === "mainnet") && !allowMainnet) {
    throw new Error("Mainnet refused: V2_ALLOW_MAINNET=true is required even for dry-run");
  }
  const contract = env.V2_CONTRACT || "GovernanceV2";
  if (!CONTRACTS.includes(contract)) throw new Error(`Unsupported V2_CONTRACT: ${contract}`);
  const address = (key) => {
    if (!ethers.isAddress(env[key] || "") || env[key] === ethers.ZeroAddress) {
      throw new Error(`${key} must be an explicit nonzero address`);
    }
    return ethers.getAddress(env[key]);
  };
  let constructorArgs;
  if (contract === "GovernanceV2") {
    const rawDelay = env.V2_DELAY_SECONDS ?? DELAY.toString();
    if (!/^[1-9]\d*$/.test(rawDelay)) throw new Error("Invalid V2_DELAY_SECONDS");
    const delay = BigInt(rawDelay);
    if (delay < DELAY || delay > MAX_DELAY) throw new Error("V2_DELAY_SECONDS outside [172800, 2592000]");
    constructorArgs = [address("V2_TREASURY_SAFE"), address("V2_GUARDIAN_SAFE"), delay];
    if (constructorArgs[0] === constructorArgs[1]) throw new Error("Treasury and guardian must be separate");
  } else {
    constructorArgs = contract === "LendingVaultV2"
      ? [address("V2_IFR_TOKEN"), address("V2_WETH"), address("V2_FACTORY"), address("V2_OWNER")]
      : [address("V2_IFR_TOKEN"), address("V2_OWNER")];
    if (contract === "LendingVaultV2" && constructorArgs[0] === constructorArgs[1]) {
      throw new Error("IFR and WETH must be separate");
    }
  }
  const artifact = await artifacts.readArtifact(contract);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
  const { data } = await factory.getDeployTransaction(...constructorArgs);
  const runtimeBytes = (artifact.deployedBytecode.length - 2) / 2;
  if (!runtimeBytes || runtimeBytes > 24576) throw new Error("Runtime bytecode violates EIP-170");
  return {
    contract, network: networkName, chainId: BigInt(chainId).toString(),
    mode: broadcast ? "broadcast" : "dry-run", constructorArgs,
    creationBytecodeHash: ethers.keccak256(artifact.bytecode),
    initCodeHash: ethers.keccak256(data), runtimeBytes,
    status: "Release candidate, ratified 2026-10-18; not externally audited; activation only via Governance + Treasury Safe",
  };
}

async function runV2Deployment(runtime, env = process.env, log = console.log) {
  const { ethers } = runtime;
  const { chainId } = await ethers.provider.getNetwork();
  const plan = await prepareV2Deployment({
    ethers, artifacts: runtime.hardhat.artifacts, chainId, networkName: runtime.network.name, env,
  });
  log(JSON.stringify(plan, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
  if (plan.mode === "dry-run") {
    log("Dry-run only: no signer requested, no transaction sent, no activation performed.");
    return plan;
  }
  // Keys/signers are resolved exclusively by the existing Hardhat network configuration.
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployment signer configured in Hardhat");
  const factory = await ethers.getContractFactory(plan.contract, deployer);
  const contract = await factory.deploy(...plan.constructorArgs);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  log(JSON.stringify({ address, transactionHash: contract.deploymentTransaction().hash,
    deployedCodeHash: ethers.keccak256(await ethers.provider.getCode(address)) }, null, 2));
  log("Deployed only; verify build, roles and disabled state before any separately approved activation.");
  return { ...plan, address };
}

module.exports = { prepareV2Deployment, runV2Deployment };
