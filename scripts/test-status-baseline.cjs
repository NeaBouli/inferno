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
  "> Last updated: 2026-07-30 | Branch: main",
  "CURRENT WATCHLIST — verified 2026-07-30",
  "Status verified 2026-07-30: open, REVIEW_REQUIRED",
  "open, MERGEABLE but BLOCKED",
  "Dependency modernization — completed 2026-07-29",
  "Ethers 6 / Hardhat 3 / Chai 6 / Node 22 migration",
  "13 high, 8 low, 0 critical",
  "Deterministic local Hardhat test network",
  "Technical: WalletConnect v2 + ethers.js v6",
  "*Last updated: 2026-07-30*",
]);
assert.ok(
  !todo.includes("- [ ] Dependency modernization"),
  "Dependency modernization must not remain open"
);
assert.ok(
  !todo.includes("- [ ] Deterministic local Hardhat test network"),
  "Deterministic local Hardhat test network must not remain open"
);

requireText("internal/operations/TODO.html", [
  "Last updated: 2026-07-30",
  "Current Watchlist &mdash; verified 2026-07-30",
  "open, review required",
  "open, mergeable but blocked",
  "Dependency modernization</strong> &mdash; completed 2026-07-29",
  "Deterministic local Hardhat test network",
]);

requireText("BACKLOG.md", [
  "**Legacy snapshot updated for closure on 2026-07-29.**",
  "Ethers 6 / Hardhat 3 / Chai 6 / Node 22 Migration",
]);
requireText("SKYWALKER.md", [
  "**Hinweis 29.07.2026:**",
  "Hardhat 3.11.1",
  "lokale Tests forken nicht automatisch",
  "HARDHAT_FORK_BLOCK_NUMBER=<block>",
  "## Historischer Stand (05.03.2026)",
  "## 8. Historischer nächster Schritt (Stand 05.03.2026)",
]);
requireText("docs/DEPENDENCY_UPGRADES.md", [
  "## Historical Operational Note — 2026-07-08",
  "## 2026-07-29 Hardhat 3 Completion",
  "### Deterministic local networks",
  "HARDHAT_FORK_BLOCK_NUMBER=<positive-mainnet-block>",
]);
requireText("docs/WALLET_ICON_DISTRIBUTION_STATUS_20260708.md", [
  "Last verified: 2026-07-30",
  "Open; `REVIEW_REQUIRED`",
  "Open, `MERGEABLE` but `BLOCKED`",
]);
requireText("docs/TOKEN_ICON_DISTRIBUTION.md", [
  "Last checked: 2026-07-30",
  "PR open / review required",
  "Open / blocked",
]);
requireText("docs/PHASE3_OPEN_ITEMS_STATUS_20260708.md", [
  "Sections 3 and 4 were reverified on 2026-07-30",
  "Status verified 2026-07-30: migration completed",
  "13 high / 8 low / 0 critical",
  "Status verified 2026-07-30",
  "keep all three external threads under watch without duplicate",
]);

console.log("[status-baseline] PASS");
