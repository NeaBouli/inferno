// @ts-check
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  globalSetup: "./scripts/test-docs-server-compat.cjs",
  use: {
    headless: true,
    baseURL: "http://localhost:8787",
  },
  webServer: {
    command: "./node_modules/.bin/sirv docs --host 127.0.0.1 --port 8787",
    env: { HOST: "127.0.0.1", PORT: "8787" },
    port: 8787,
    reuseExistingServer: true,
    timeout: 10000,
  },
});
