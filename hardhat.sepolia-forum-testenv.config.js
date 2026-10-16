import { fileURLToPath } from "node:url";

// Deliberately independent of hardhat.config.js: no dotenv, existing keys,
// remote networks, administrative tasks, or mainnet forks.
export default {
  paths: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    artifacts: "artifacts/sepolia-forum-testenv",
    cache: "cache/sepolia-forum-testenv",
  },
  solidity: {
    compilers: [
      { version: "0.8.20", settings: { evmVersion: "paris" } },
      { version: "0.8.28", settings: { evmVersion: "cancun" } },
    ],
  },
  networks: {
    hardhat: { type: "edr-simulated", chainType: "l1", chainId: 31337 },
  },
};
