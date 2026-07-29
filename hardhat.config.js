import "dotenv/config";
import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import adminTasks from "./tasks/admin.js";

function resolveLocalForkConfig(env) {
  const forkMode = env.HARDHAT_FORK || "false";
  if (forkMode !== "true" && forkMode !== "false") {
    throw new Error('HARDHAT_FORK must be either "true" or "false"');
  }
  if (forkMode === "false") {
    return {};
  }
  if (!env.MAINNET_RPC_URL) {
    throw new Error("HARDHAT_FORK=true requires MAINNET_RPC_URL");
  }
  if (!/^[1-9]\d*$/.test(env.HARDHAT_FORK_BLOCK_NUMBER || "")) {
    throw new Error(
      "HARDHAT_FORK=true requires a positive HARDHAT_FORK_BLOCK_NUMBER",
    );
  }

  const blockNumber = Number(env.HARDHAT_FORK_BLOCK_NUMBER);
  if (!Number.isSafeInteger(blockNumber)) {
    throw new Error(
      "HARDHAT_FORK_BLOCK_NUMBER exceeds JavaScript safe integer range",
    );
  }

  return {
    forking: {
      url: env.MAINNET_RPC_URL,
      blockNumber,
    },
  };
}

const forkConfig = resolveLocalForkConfig(process.env);

const accountConfig = process.env.DEPLOYER_PRIVATE_KEY
  ? [process.env.DEPLOYER_PRIVATE_KEY]
  : "remote";

const remoteNetworks = {
  ...(process.env.SEPOLIA_RPC_URL
    ? {
        sepolia: {
          type: "http",
          chainType: "l1",
          url: process.env.SEPOLIA_RPC_URL,
          accounts: accountConfig,
        },
      }
    : {}),
  ...(process.env.MAINNET_RPC_URL
    ? {
        mainnet: {
          type: "http",
          chainType: "l1",
          url: process.env.MAINNET_RPC_URL,
          accounts: accountConfig,
        },
      }
    : {}),
};

export default defineConfig({
  plugins: [
    hardhatEthers,
    hardhatEthersChaiMatchers,
    hardhatMocha,
    hardhatVerify,
  ],
  tasks: adminTasks,
  solidity: {
    compilers: [
      { version: "0.8.20", settings: { evmVersion: "paris" } },
      { version: "0.8.28", settings: { evmVersion: "cancun" } },
    ],
  },
  networks: {
    default: {
      type: "edr-simulated",
      chainType: "l1",
      ...forkConfig,
    },
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
      ...forkConfig,
    },
    ...remoteNetworks,
  },
  verify: {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY || "",
    },
  },
  test: {
    mocha: {
      timeout: 120000,
    },
  },
});
