import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "./helpers/hardhat.js";
import deployment from "../scripts/lib/v2-deployment.js";

const { prepareV2Deployment, runV2Deployment } = deployment;

describe("V2 release deployment guards and dry-run", function () {
  let env;
  beforeEach(async function () {
    const [treasury, guardian, token, weth, factory, owner] = await ethers.getSigners();
    env = {
      V2_TREASURY_SAFE: treasury.address, V2_GUARDIAN_SAFE: guardian.address,
      V2_IFR_TOKEN: token.address, V2_WETH: weth.address, V2_FACTORY: factory.address,
      V2_OWNER: owner.address,
    };
  });
  const prepare = (overrides = {}, context = {}) => prepareV2Deployment({
    ethers, artifacts: hre.artifacts, chainId: 31337n, networkName: "hardhat", env: { ...env, ...overrides }, ...context,
  });
  async function rejects(promise, message) {
    try { await promise; } catch (error) { expect(error.message).to.include(message); return; }
    expect.fail(`Expected rejection: ${message}`);
  }

  for (const contract of ["GovernanceV2", "LendingVaultV2", "CommitmentVaultV2"]) {
    it(`dry-runs ${contract} on Hardhat with exact args/hashes and no signer or transaction`, async function () {
      const before = await ethers.provider.getBlockNumber();
      const output = [];
      const plan = await runV2Deployment({
        hardhat: hre, network: { name: "hardhat" },
        ethers: { ...ethers, getSigners: () => { throw new Error("Dry-run requested a signer"); } },
      }, { ...env, V2_CONTRACT: contract }, (line) => output.push(line));
      const args = contract === "GovernanceV2" ? [env.V2_TREASURY_SAFE, env.V2_GUARDIAN_SAFE, 172800n]
        : contract === "LendingVaultV2" ? [env.V2_IFR_TOKEN, env.V2_WETH, env.V2_FACTORY, env.V2_OWNER]
          : [env.V2_IFR_TOKEN, env.V2_OWNER];
      const artifact = await hre.artifacts.readArtifact(contract);
      const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
      expect(plan.constructorArgs).to.deep.equal(args);
      expect(plan.creationBytecodeHash).to.equal(ethers.keccak256(artifact.bytecode));
      expect(plan.initCodeHash).to.equal(ethers.keccak256((await factory.getDeployTransaction(...args)).data));
      expect(plan.runtimeBytes).to.be.at.most(24576);
      expect(JSON.parse(output[0]).mode).to.equal("dry-run");
      expect(await ethers.provider.getBlockNumber()).to.equal(before);
    });
  }
  for (const context of [{ chainId: 1n }, { networkName: "mainnet" }]) {
    it(`refuses mainnet dry-run and broadcast using ${JSON.stringify(context, (_k, v) => typeof v === "bigint" ? v.toString() : v)}`, async function () {
      await rejects(prepare({}, context), "Mainnet refused");
      await rejects(prepare({ V2_BROADCAST: "true" }, context), "Mainnet refused");
      expect((await prepare({ V2_ALLOW_MAINNET: "true" }, context)).mode).to.equal("dry-run");
    });
  }
  for (const key of ["V2_BROADCAST", "V2_ALLOW_MAINNET"]) {
    it(`rejects ambiguous ${key}`, async function () { await rejects(prepare({ [key]: "1" }), key); });
  }
  for (const delay of ["0", "172799", "2592001", "1.5", "9007199254740993"]) {
    it(`rejects invalid/out-of-bounds delay ${delay}`, async function () {
      await rejects(prepare({ V2_DELAY_SECONDS: delay }), "V2_DELAY_SECONDS");
    });
  }
  it("accepts the ratified inclusive delay bounds using integers", async function () {
    for (const delay of ["172800", "2592000"]) {
      expect((await prepare({ V2_DELAY_SECONDS: delay })).constructorArgs[2]).to.equal(BigInt(delay));
    }
  });
  it("rejects missing/zero roles, overlapping principals and unknown contracts", async function () {
    await rejects(prepare({ V2_TREASURY_SAFE: undefined }), "V2_TREASURY_SAFE");
    await rejects(prepare({ V2_GUARDIAN_SAFE: ethers.ZeroAddress }), "V2_GUARDIAN_SAFE");
    await rejects(prepare({ V2_GUARDIAN_SAFE: env.V2_TREASURY_SAFE }), "must be separate");
    await rejects(prepare({ V2_CONTRACT: "LendingVaultV2", V2_WETH: env.V2_IFR_TOKEN }), "must be separate");
    await rejects(prepare({ V2_CONTRACT: "LendingVaultV2", V2_OWNER: undefined }), "V2_OWNER");
    await rejects(prepare({ V2_CONTRACT: "CommitmentVaultV2", V2_IFR_TOKEN: undefined }), "V2_IFR_TOKEN");
    await rejects(prepare({ V2_CONTRACT: "Unknown" }), "Unsupported V2_CONTRACT");
  });
  it("broadcasts only when explicitly requested, leaving GovernanceV2 with no proposals", async function () {
    const plan = await runV2Deployment({ hardhat: hre, ethers, network: { name: "hardhat" } },
      { ...env, V2_BROADCAST: "true" }, () => {});
    const controller = await ethers.getContractAt("GovernanceV2", plan.address);
    expect(await controller.owner()).to.equal(env.V2_TREASURY_SAFE);
    expect(await controller.guardian()).to.equal(env.V2_GUARDIAN_SAFE);
    expect(await controller.delay()).to.equal(172800n);
    expect(await controller.proposalCount()).to.equal(0n);
  });
});
