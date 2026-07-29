"use strict";

async function connectHardhat() {
  const { default: hardhat } = await import("hardhat");
  const connection = await hardhat.network.getOrCreate();

  async function verifyContract(args) {
    const { verifyContract: verify } = await import(
      "@nomicfoundation/hardhat-verify/verify"
    );
    return verify(
      {
        address: args.address,
        constructorArgs: args.constructorArguments || [],
        provider: "etherscan",
      },
      hardhat,
    );
  }

  async function run(taskName, args) {
    if (taskName !== "verify:verify") {
      throw new Error(`Unsupported Hardhat 2 task shim: ${taskName}`);
    }
    return verifyContract(args);
  }

  return {
    hardhat,
    connection,
    ethers: connection.ethers,
    network: { name: connection.networkName },
    verifyContract,
    run,
  };
}

module.exports = { connectHardhat };
