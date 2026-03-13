// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  use: {
    headless: true,
    baseURL: "http://localhost:8787",
  },
  webServer: {
    command: "npx serve docs -l 8787 --no-clipboard",
    port: 8787,
    reuseExistingServer: true,
    timeout: 10000,
  },
});
