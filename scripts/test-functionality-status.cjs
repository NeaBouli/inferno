#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const status = read("docs/CURRENT_FUNCTIONALITY_STATUS.md");
for (const marker of [
  "**Verified:** 26 August 2026",
  "**Repository baseline:** `9782106a`",
  "LendingVault.ifrPriceWei = 0",
  "priceOracle` is the zero address",
  "physical device/wallet acceptance matrix is 1/10",
  "embedded-wallet package is a prototype only",
  "0 registered and 0 active builders",
]) {
  assert.ok(status.includes(marker), `functionality status missing: ${marker}`);
}

const statusLinks = {
  "README.md": /\[[^\]]+\]\([^)]*CURRENT_FUNCTIONALITY_STATUS\.md[^)]*\)/,
  "STATUS-REPORT.md": /\[[^\]]+\]\([^)]*CURRENT_FUNCTIONALITY_STATUS\.md[^)]*\)/,
  "docs/STATUS-REPORT.md": /\[[^\]]+\]\([^)]*CURRENT_FUNCTIONALITY_STATUS\.md[^)]*\)/,
  "docs/DOCS.md": /\[[^\]]+\]\([^)]*CURRENT_FUNCTIONALITY_STATUS\.md[^)]*\)/,
  "docs/KNOWN-ISSUES.md": /\[[^\]]+\]\([^)]*CURRENT_FUNCTIONALITY_STATUS\.md[^)]*\)/,
  "docs/ROADMAP.md": /\[[^\]]+\]\([^)]*CURRENT_FUNCTIONALITY_STATUS\.md[^)]*\)/,
  "docs/DEPLOYMENTS.md": /\[[^\]]+\]\([^)]*CURRENT_FUNCTIONALITY_STATUS\.md[^)]*\)/,
  "docs/ONE-PAGER.md": /\[[^\]]+\]\([^)]*CURRENT_FUNCTIONALITY_STATUS\.md[^)]*\)/,
  "docs/PRESS_KIT.md": /\[[^\]]+\]\([^)]*CURRENT_FUNCTIONALITY_STATUS\.md[^)]*\)/,
  "docs/wiki/index.html": /href=["'][^"']*CURRENT_FUNCTIONALITY_STATUS\.md["']/,
  "docs/wiki/ecosystem.html": /href=["'][^"']*CURRENT_FUNCTIONALITY_STATUS\.md["']/,
  "apps/benefits-network/frontend/src/components/AppShell.tsx": /href=["'][^"']*CURRENT_FUNCTIONALITY_STATUS\.md["']/,
  "docs/llms.txt": /https:\/\/ifrunit\.tech\/CURRENT_FUNCTIONALITY_STATUS\.md/,
};
for (const [relative, linkPattern] of Object.entries(statusLinks)) {
  assert.ok(
    linkPattern.test(read(relative)),
    `${relative} must link to the canonical functionality status`
  );
}

const landing = read("docs/index.html");
assert.ok(landing.includes("ALL 77 QUESTIONS &amp; ANSWERS"));
assert.ok(!landing.includes("ALL 61 QUESTIONS &amp; ANSWERS"));

const copilotWiki = read("apps/ai-copilot/src/context/wiki-content.json");
assert.ok(copilotWiki.includes("Borrowing is disabled while LendingVault.ifrPriceWei = 0"));
assert.ok(copilotWiki.includes("Future borrower path — currently disabled"));
assert.ok(!copilotWiki.includes("every step creates buy pressure on Uniswap"));

const onePager = read("docs/ONE-PAGER.md");
assert.ok(!onePager.includes("no yield, no risk"));
assert.ok(!onePager.includes("PartnerVault pays creator rewards (10% of lock amount)"));

const currentLendingDocs = [
  "docs/wiki/lending-vault.html",
  "docs/wiki/bootstrap.html",
  "docs/wiki/protocol-plan.html",
  "docs/wiki/ecosystem.html",
  "docs/wiki/lending-market.html",
];
const forbidden = [
  /48 hours? to top up/i,
  /collateral is automatically used to buy IFR/i,
  /default = collateral buys IFR automatically/i,
  /Uniswap TWAP \(24h average\)/i,
  /liquidation &rarr; buys on Uniswap/i,
];
for (const relative of currentLendingDocs) {
  const content = read(relative);
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(content), `${relative} retains false V1 claim: ${pattern}`);
  }
}

for (const relative of [
  "docs/llms.txt",
  "apps/ai-copilot/src/context/ifr-knowledge.ts",
]) {
  const content = read(relative);
  assert.ok(!/Every default = collateral buys IFR/i.test(content));
  assert.ok(content.includes("52,155,440.952845656 IFR"));
  assert.ok(content.includes("0 IFR lent"));
}
assert.ok(
  !appsKnowledgeHasStaleSupply(read("apps/ai-copilot/src/context/ifr-knowledge.ts")),
  "Copilot knowledge must not retain the stale 998.5M supply snapshot"
);
assert.ok(!read("docs/DEPLOYMENTS.md").includes("BuybackController (pending Proposal A)"));
assert.ok(!read("docs/DEPLOYMENTS.md").includes("Proposal A: setFeeExempt(BuybackController)"));
for (const contract of ["CommitmentVault", "LendingVault", "BuilderRegistry"]) {
  assert.ok(read("docs/DEPLOYMENTS.md").includes(`**${contract}**`));
}

function appsKnowledgeHasStaleSupply(content) {
  return content.includes('currentSupply: "~998,500,000 IFR');
}

assert.ok(
  read("docs/web3/index.html").includes(
    "Borrowing is disabled until Governance sets LendingVault ifrPriceWei."
  ),
  "Web3 must fail closed when LendingVault price is zero"
);
assert.ok(
  read("docs/web3/index.html").includes(
    "Price-condition locks are disabled until the CommitmentVault price oracle is configured on-chain."
  ),
  "Web3 must fail closed when the CommitmentVault oracle is absent"
);

const faq = read("docs/wiki/faq.html");
const faqCount = (faq.match(/class="faq-item"/g) || []).length;
assert.equal(faqCount, 77, "Wiki FAQ count changed; update its visible count");
assert.ok(faq.includes("12 sections, 77 questions."));
assert.ok(read("docs/index.html").includes("view all 77 questions"));

console.log("[functionality-status] PASS");
