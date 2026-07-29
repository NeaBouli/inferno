#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function requireText(relative, phrases) {
  const content = read(relative);
  for (const phrase of phrases) {
    assert.ok(
      content.includes(phrase),
      `${relative} must include current status marker: ${phrase}`
    );
  }
  return content;
}

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.engines?.node, ">=22.13.0");
assert.equal(packageJson.dependencies?.ethers, "6.17.0");
assert.equal(packageJson.devDependencies?.hardhat, "3.11.1");
assert.equal(packageJson.devDependencies?.chai, "6.2.2");
assert.equal(packageJson.devDependencies?.mocha, "11.7.6");

const currentBaseline = [
  "**Current engineering baseline:** 29 July 2026",
  "Hardhat `3.11.1`",
  "contracts `642/642`",
  "13 high, 8 low, 0 critical",
  "## Historical Snapshot — 5 March 2026",
];
requireText("STATUS-REPORT.md", currentBaseline);
requireText("docs/STATUS-REPORT.md", currentBaseline);

const todo = requireText("internal/operations/TODO.md", [
  "> Last updated: 2026-07-29 | Branch: main",
  "Dependency modernization — completed 2026-07-29",
  "Ethers 6 / Hardhat 3 / Chai 6 / Node 22 migration",
  "13 high, 8 low, 0 critical",
  "Deterministic local Hardhat test network",
  "Technical: WalletConnect v2 + ethers.js v6",
  "*Last updated: 2026-07-29*",
]);
assert.ok(
  !todo.includes("- [ ] Dependency modernization"),
  "Dependency modernization must not remain open"
);

requireText("BACKLOG.md", [
  "**Legacy snapshot updated for closure on 2026-07-29.**",
  "Ethers 6 / Hardhat 3 / Chai 6 / Node 22 Migration",
]);
requireText("SKYWALKER.md", [
  "**Hinweis 29.07.2026:**",
  "Hardhat 3.11.1",
  "env MAINNET_RPC_URL= SEPOLIA_RPC_URL= npm run test:contracts",
  "## Historischer Stand (05.03.2026)",
  "## 8. Historischer nächster Schritt (Stand 05.03.2026)",
]);
requireText("docs/DEPENDENCY_UPGRADES.md", [
  "## Historical Operational Note — 2026-07-08",
  "## 2026-07-29 Hardhat 3 Completion",
]);

console.log("[status-baseline] PASS");
