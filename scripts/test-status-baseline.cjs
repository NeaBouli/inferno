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
const packageLock = JSON.parse(read("package-lock.json"));
assert.equal(packageJson.engines?.node, ">=22.13.0");
assert.equal(packageJson.dependencies?.ethers, "6.17.0");
assert.equal(packageJson.devDependencies?.hardhat, "3.12.0");
assert.equal(packageJson.overrides?.["serialize-javascript"], "7.0.5");
assert.equal(packageJson.devDependencies?.chai, "6.2.2");
assert.equal(packageJson.devDependencies?.mocha, "11.7.6");
assert.equal(
  packageJson.scripts?.["test:mocha-serializer"],
  "mocha --parallel --jobs 2 test/mocha-serializer-compat.test.cjs"
);
assert.equal(packageLock.packages?.["node_modules/hardhat"]?.version, "3.12.0");
assert.equal(packageLock.packages?.["node_modules/adm-zip"]?.version, "0.6.0");
assert.equal(
  packageLock.packages?.["node_modules/serialize-javascript"]?.version,
  "7.0.5"
);
assert.equal(
  packageLock.packages?.["node_modules/serve-handler/node_modules/brace-expansion"]
    ?.version,
  "1.1.18"
);

const currentBaseline = [
  "**Current engineering baseline:** 1 August 2026",
  "Hardhat `3.12.0`",
  "contracts `642/642`",
  "10 transitive low findings",
  "## Historical Snapshot — 5 March 2026",
];
requireText("STATUS-REPORT.md", currentBaseline);
requireText("docs/STATUS-REPORT.md", currentBaseline);

const todo = requireText("internal/operations/TODO.md", [
  "> Last updated: 2026-08-04 | Branch: main",
  "CURRENT WATCHLIST — verified 2026-08-04",
  "LendingVault V1 borrow activation policy — keep disabled",
  "V1 cannot set price back to zero",
  "DEFERRED / LATER — resume only when its trigger occurs",
  "Status verified 2026-08-04: open, REVIEW_REQUIRED",
  "open, MERGEABLE but BLOCKED",
  "IFRp Commerce App / shop.ifrunit.tech production decisions",
  "Contributor CommitmentVault Locks abgeschlossen",
  "Contributor LendingVault Offers abgeschlossen",
  "Monitor reports `Next: done` for C1/C2/C3",
  "52,155,440.952845656 IFR",
  "CommitmentVault native batch-lock UX",
  "Global LendingVault liquidation dashboard and Telegram alerts",
  "Ticket `1390230` is submitted",
  "not verified by CoinMarketCap",
  "128px icon",
  "Wallet-level Collateral Health Monitor",
  "Dependency modernization — completed 2026-07-29",
  "Ethers 6 / Hardhat 3 / Chai 6 / Node 22 migration",
  "10 transitive low findings",
  "Deterministic local Hardhat test network",
  "Technical: WalletConnect v2 + ethers.js v6",
  "*Last updated: 2026-07-31*",
]);
assert.ok(
  !todo.includes("- [ ] Dependency modernization"),
  "Dependency modernization must not remain open"
);
assert.ok(!todo.includes("13 high"), "TODO must not retain stale high-severity count");
assert.ok(
  !todo.includes("- [ ] Deterministic local Hardhat test network"),
  "Deterministic local Hardhat test network must not remain open"
);
assert.ok(
  !todo.includes("- [ ] 🔴 CommitmentVault Lock ausführen"),
  "Contributor CommitmentVault locks must not remain open"
);
assert.ok(
  !todo.includes("- [ ] 🔴 LendingVault createOffer() ausführen"),
  "Contributor LendingVault offers must not remain open"
);

requireText("internal/operations/TODO.html", [
  "Last updated: 2026-08-04",
  "Current Watchlist &mdash; verified 2026-08-04",
  "LendingVault V1 borrow activation policy",
  "V1 cannot set the price back to zero",
  "Deferred / Waiting &mdash; resume only when the trigger occurs",
  "Open and review required",
  "Open, mergeable but blocked",
  "IFRp Commerce App / shop.ifrunit.tech production decisions",
  "Contributor CommitmentVault Locks abgeschlossen",
  "Contributor LendingVault Offers abgeschlossen",
  "Next: done",
  "52,155,440.952845656 IFR",
  "CommitmentVault native batch-lock UX",
  "Global LendingVault liquidation dashboard and Telegram alerts",
  "Ticket <code>1390230</code> is submitted",
  "not verified by CoinMarketCap",
  "Dependency modernization</strong> &mdash; completed 2026-07-29",
  "Deterministic local Hardhat test network",
  "Submission completed, not approval",
]);
assert.ok(
  !read("internal/operations/TODO.html").includes("13 high"),
  "TODO.html must not retain stale high-severity count"
);

requireText("BACKLOG.md", [
  "**Legacy snapshot updated for closure on 2026-07-29.**",
  "Ethers 6 / Hardhat 3 / Chai 6 / Node 22 Migration",
  "10 transitive Low-Funde",
]);
requireText("SKYWALKER.md", [
  "**Hinweis 29.07.2026:**",
  "Hardhat 3.12.0",
  "lokale Tests forken nicht automatisch",
  "HARDHAT_FORK_BLOCK_NUMBER=<block>",
  "## Historischer Stand (05.03.2026)",
  "## 8. Historischer nächster Schritt (Stand 05.03.2026)",
]);
requireText("docs/DEPENDENCY_UPGRADES.md", [
  "## Historical Operational Note — 2026-07-08",
  "## 2026-07-29 Hardhat 3 Completion",
  "## 2026-08-01 Creator Gateway Security Patch",
  "path-to-regexp@0.1.13",
  "all 41 Creator Gateway tests",
  "### Deterministic local networks",
  "HARDHAT_FORK_BLOCK_NUMBER=<positive-mainnet-block>",
]);
requireText("docs/WALLET_ICON_DISTRIBUTION_STATUS_20260708.md", [
  "Last verified: 2026-08-04",
  "Open; `REVIEW_REQUIRED`",
  "Open, `MERGEABLE` but `BLOCKED`",
  "there is no",
  "500 TWT",
  "exact Ethereum contract on a public token page",
  "does not currently expose an IFR token image",
  "CoinGecko exact-contract endpoint: `coin not found`",
  "Searching Zerion by the exact IFR contract returns `Nothing was found`",
  "docs/assets/ifr_icon_128.png",
  "Submitted 2026-07-30",
  "Resolved and verified 2026-07-31",
  "IFR-8f9ccb3d-2e3b-4c3c-bda1-5040d80548f6",
]);
requireText("docs/TOKEN_ICON_DISTRIBUTION.md", [
  "Last checked: 2026-08-04",
  "PR open / review required",
  "Open / blocked",
  "External-data path / no verification form",
  "Not eligible / do not pay",
  "Live / verified",
  "Token page live / icon missing",
]);
requireText("docs/ZERION_SUBMISSION_PACK_20260730.md", [
  "Status: resolved and live 2026-07-31",
  "docs/assets/ifr_icon_128.png",
  "human support agent Sebastien",
  "IFR-8f9ccb3d-2e3b-4c3c-bda1-5040d80548f6",
  "Do not submit a duplicate",
]);
requireText("docs/PHASE3_OPEN_ITEMS_STATUS_20260708.md", [
  "Section 3 was reverified on 2026-08-01",
  "Status verified 2026-08-01: migration completed",
  "0 moderate / 0 high / 0 critical",
  "Status verified 2026-07-30",
  "keep all three external threads under watch without duplicate",
]);
requireText("docs/COINGECKO_FOLLOWUP_PACK_20260716.md", [
  "## Recheck - 2026-07-30",
  "CoinGecko coin listing is not yet approved or publicly indexed.",
]);
requireText("docs/COINMARKETCAP_SUBMISSION.md", [
  "GeckoTerminal: live",
  "CoinGecko: application submitted",
  "`coin not found` as of 2026-08-04",
  "submitted as ticket `1390230`",
  "not verified by CoinMarketCap",
  "is not a standalone tracked CMC coin listing",
]);

requireText("docs/wiki/index.html", [
  "35 wiki pages",
  '<span class="stat-value">17</span>',
  '<span class="stat-value">35</span>',
]);
requireText("docs/index.html", ["Complete wiki with 35 pages"]);
requireText("docs/wiki/roadmap.html", [
  "Contributor buys, CommitmentVault locks and LendingVault offers are verified for C1/C2/C3",
  "52,155,440.952845656 IFR",
  "V1 borrowing remains intentionally disabled",
]);
requireText("docs/wiki/bootstrap.html", [
  "Historical snapshot 16.06.2026",
  "Current follow-up 30.07.2026",
  "52,155,440.952845656 IFR",
]);
requireText("docs/wiki/reputation.html", [
  "Zerion",
  "Rainbow",
  "IFR-8f9ccb3d-2e3b-4c3c-bda1-5040d80548f6",
  "not counted as formal audit or trust evidence",
]);
requireText("docs/llms.txt", [
  "Three contributor offers provide 52,155,440.952845656 IFR",
  "V1 borrowing is intentionally disabled with ifrPriceWei = 0",
  "Zerion lists the canonical IFR token",
  "Rainbow resolves the exact Ethereum contract",
]);
requireText("docs/CONTRIBUTOR_RUNBOOK.md", [
  "Current completion status 30.07.2026",
  "Next: done",
  "52,155,440.952845656 IFR",
  "V1 borrowing remains intentionally disabled with `ifrPriceWei = 0`",
  "Historical pre-execution snapshot 28.06.2026",
]);
requireText("docs/wiki/contributing.html", [
  "Use ethers v6 syntax with 9 decimals in current packages",
  'ethers.parseUnits("1000", 9)',
]);

console.log("[status-baseline] PASS");
