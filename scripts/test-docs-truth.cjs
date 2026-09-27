#!/usr/bin/env node

// Guards the documentation truth matrix (docs/community-audits/DOCS_TRUTH_MATRIX_2026-09-27.md):
// the 17-component definition, Safe-address coverage, current test counts, historical coverage
// labelling and the deployed application inventory.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const lower = (text) => text.toLowerCase();

const manifest = JSON.parse(read("deployments/mainnet.json"));
const contracts = Object.entries(manifest)
  .filter(([name]) => name !== "_manifest")
  .map(([name, entry]) => ({ name, address: entry.address }));
assert.equal(contracts.length, 14, "deployments/mainnet.json must list 14 protocol contracts");

const safes = {
  "Treasury Safe": "0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b",
  "Community Safe": "0xaC5687547B2B21d80F8fd345B51e608d476667C7",
  "LP Reserve Safe": "0x5D93E7919a71d725054e31017eCA86B026F86C04",
};
const excluded = {
  lpPair: "0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0",
  bootstrapVaultV1: "0xA820540936d18e1377C39dd9445E5b36F3F1261a",
};
assert.equal(contracts.length + Object.keys(safes).length, 17);
for (const address of Object.values(excluded)) {
  assert.ok(
    !contracts.some((c) => lower(c.address) === lower(address)),
    `${address} must not be counted as a protocol contract`
  );
}

// Every surface that states "14 + 3 = 17" must list all 14 contracts and all 3 Safes.
for (const relative of ["README.md", "docs/DEPLOYMENTS.md", "docs/index.html"]) {
  const content = lower(read(relative));
  for (const { name, address } of contracts) {
    assert.ok(content.includes(lower(address)), `${relative} is missing ${name} ${address}`);
  }
  for (const [label, address] of Object.entries(safes)) {
    assert.ok(content.includes(lower(address)), `${relative} is missing ${label} ${address}`);
  }
}

// README contract table: no duplicate address rows.
const readme = read("README.md");
const tableAddresses = [...readme.matchAll(/^\| [^|]+ \| \[`(0x[0-9a-fA-F]{40})`\]/gm)].map((m) =>
  lower(m[1])
);
assert.equal(new Set(tableAddresses).size, tableAddresses.length, "README table has duplicate addresses");
assert.ok(readme.includes("DEPLOYMENTS.md#canonical-mainnet-component-count-17"));

const deployments = read("docs/DEPLOYMENTS.md");
assert.ok(deployments.includes("### Canonical Mainnet Component Count (17)"));
assert.ok(deployments.includes("## Gnosis Safes (Mainnet)"));

// Landing list: 14 contracts + 3 Safes rendered as copyable rows.
const landing = read("docs/index.html");
const start = landing.indexOf('<h2 class="section-title">Contract Addresses</h2>');
const end = landing.indexOf("14 deployed contracts + 3 Gnosis Safes = 17 on-chain components", start);
assert.ok(start > 0 && end > start, "landing contract address section not found");
const rows = landing.slice(start, end).match(/class="contract-row"/g) || [];
assert.equal(rows.length, 17, "landing contract address list must render 14 contracts + 3 Safes");

// Safes are proxies: never call all 17 components protocol contracts or immutable.
const currentSurfaces = [
  "README.md",
  "STATUS-REPORT.md",
  "docs/STATUS-REPORT.md",
  "docs/index.html",
  "docs/wiki/faq.html",
  "docs/wiki/security.html",
  "docs/wiki/fair-launch.html",
  "docs/wiki/contracts.html",
  "docs/wiki/deployment.html",
  "docs/CURRENT_FUNCTIONALITY_STATUS.md",
];
const forbidden = [
  /\b17 (deployed )?protocol contracts\b/i,
  /All 17 contracts\b/i,
  /\b16 on-chain components\b/i,
  /\b13 deployed contracts\b/i,
];
for (const relative of currentSurfaces) {
  const content = read(relative);
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(content), `${relative} matches stale claim ${pattern}`);
  }
}

// Tests: the register's canonical contract count is the current reproduced count.
const register = JSON.parse(read("docs/community-audits/cwa-remediation-register.json"));
assert.equal(register.canonicalTests.contracts, "644/644");
const status = read("docs/CURRENT_FUNCTIONALITY_STATUS.md");
assert.ok(status.includes("`644/644` passing"));
// Browser suites: reproduced with `npx playwright test --list` (wallet-connect 24, web3-write 27).
assert.equal(register.canonicalTests.landingWikiBrowser, "24/24");
assert.equal(register.canonicalTests.web3Browser, "27/27");
assert.ok(status.includes("Landing/Wiki wallet browser suite: `24/24` passing"));
assert.ok(status.includes("Web3 write-path browser suite: `27/27` passing"));
assert.ok(readme.includes("Landing/Wiki browser **24/24**, Web3 browser **27/27**"));
for (const relative of ["docs/llms.txt", "apps/ai-copilot/src/context/ifr-knowledge.ts"]) {
  assert.ok(read(relative).includes("Landing/Wiki browser 24/24, Web3 browser 27/27"), `${relative} browser counts`);
}
for (const relative of ["README.md", "docs/CURRENT_FUNCTIONALITY_STATUS.md", "docs/index.html"]) {
  assert.ok(!/\b642 (contract )?tests\b/i.test(read(relative)), `${relative} cites the stale 642 count`);
}

// Coverage: README may cite branch coverage only as the dated historical snapshot.
assert.ok(!readme.includes("91% Branch)"), "README cites unlabelled 91% branch coverage");
assert.ok(readme.includes("90.79% branches / 99.45% statements (solidity-coverage, 544 tests, 05.03.2026)"));
assert.ok(readme.includes("no current branch-coverage figure is published"));

// Apps: four public surfaces, seven deployment units, each with repository evidence.
const inventory = status.slice(status.indexOf("## Deployed Application Inventory"));
assert.ok(inventory.startsWith("## Deployed Application Inventory"));
const units = inventory.match(/^\| [1-9] \| /gm) || [];
assert.equal(units.length, 7, "deployed application inventory must list 7 units");
for (const host of [
  "`ifrunit.tech`",
  "`web3.ifrunit.tech`",
  "`shop.ifrunit.tech`",
  "`points-api.ifrunit.tech`",
  "`copilot-api.ifrunit.tech`",
  "`verify-api.ifrunit.tech`",
]) {
  assert.ok(inventory.includes(host), `inventory missing ${host}`);
}
for (const evidence of [
  "docs/CNAME",
  "infra/web3/web3-security-headers.conf",
  "scripts/deploy-benefits-network.sh",
  "docs/POINTS_BACKEND_MIGRATION.md",
  "docs/wiki/verify.html",
]) {
  assert.ok(fs.existsSync(path.join(root, evidence)), `inventory evidence missing: ${evidence}`);
}

console.log("[docs-truth] PASS - 14 contracts + 3 Safes = 17; 644 tests; historical coverage labelled; 7 deployment units");
