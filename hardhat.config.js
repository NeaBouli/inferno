import "dotenv/config";
import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import adminTasks from "./tasks/admin.js";

const forkConfig = process.env.MAINNET_RPC_URL
  ? { forking: { url: process.env.MAINNET_RPC_URL } }
  : {};

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
