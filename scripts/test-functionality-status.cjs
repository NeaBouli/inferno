#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const status = read("docs/CURRENT_FUNCTIONALITY_STATUS.md");
for (const marker of [
  "**Verified:** 6 September 2026",
  "**Repository baseline:** current release branch",
  "`700/700` passing",
  "LendingVault.ifrPriceWei = 0",
  "priceOracle` is the zero address",
  "physical device/wallet acceptance matrix is 1/10",
  "embedded-wallet package is a prototype only",
  "0 registered and 0 active builders",
  "Initial timelock ended 01.09.2026",
  "50,000,000 IFR` currently withdrawable",
  "0 IFR` withdrawn",
  "no LiquidityReserve proposal was pending at block `25918433`",
]) {
  assert.ok(status.includes(marker), `functionality status missing: ${marker}`);
}

// F3: npm delivery and the current source patch are separate release states.
function assertSdkReleaseState(copy) {
  assert.ok(/Published npm `ifr-sdk` \*\*0\.4\.0\*\*/.test(copy), "SDK npm delivery must identify published 0.4.0");
  assert.ok(/source\/docs \*\*0\.4\.1\*\* is unpublished/.test(copy), "SDK source patch must identify unpublished 0.4.1");
  assert.ok(copy.includes("separate npm release gate"), "SDK patch must retain its publication gate");
  assert.ok(!/Published npm `ifr-sdk` \*\*0\.4\.1\*\*/.test(copy), "source 0.4.1 is not published npm delivery");
}
for (const copy of [status, read("README.md")]) {
  assertSdkReleaseState(copy);
  assert.throws(() => assertSdkReleaseState(copy.replace("Published npm `ifr-sdk` **0.4.0**", "Published npm `ifr-sdk` **0.4.1**")), { name: "AssertionError" });
  assert.throws(() => assertSdkReleaseState(copy.replace("is unpublished", "is published")), { name: "AssertionError" });
}
assert.ok(status.includes("Publisher validation") && status.includes("#238 compatibility/cutover HOLD"), "SDK status must preserve publisher validation and backend compatibility/cutover hold");

// F7: official-interface retirement is independent of the dated contract-price snapshot.
function assertLendingInterfaceRetirement(row) {
  assert.equal(typeof row, "string", "current interface row missing");
  for (const marker of ["Official interfaces permanently retire LendingVault V1 creation/increase and new borrowing", "#209/#211", "regardless of price"]) {
    assert.ok(row.includes(marker), `interface retirement boundary missing: ${marker}`);
  }
  assert.ok(/underlying contract functions are not removed/i.test(row), "interface retirement must not imply removed contract functions");
  assert.ok(!row.includes("offer creation/withdrawal"), "current official interfaces do not offer creation");
  assert.ok(!/borrowing[^.]{0,100}(because|while|until)[^.]{0,100}(price|ifrPriceWei)/i.test(row), "borrowing retirement must not depend on price activation");
}
for (const surface of ["Wiki", "Web3"]) {
  const row = status.match(new RegExp(`^\\| \\[${surface}\\].*$`, "m"))?.[0];
  assertLendingInterfaceRetirement(row);
  assert.throws(() => assertLendingInterfaceRetirement(row.replace("regardless of price", "until price is set")), { name: "AssertionError" });
  assert.throws(() => assertLendingInterfaceRetirement(`${row} offer creation/withdrawal`), { name: "AssertionError" });
}
const web3Row = status.match(/^\| \[Web3\].*$/m)?.[0];
for (const marker of ["full-available lender withdrawal", "existing-loan repayment/top-up", "contract-input snapshot", "LendingVault.ifrPriceWei = 0", "50af"]) {
  assert.ok(web3Row.includes(marker), `Web3 retained capability/evidence missing: ${marker}`);
}
const benefitsRow = status.match(/^\| \[IFR Benefits\].*$/m)?.[0];
assert.ok(benefitsRow.includes("per-period Governance `recordMilestone`") && benefitsRow.includes("not an authorized-caller path") && benefitsRow.includes("no pilot partner is activated"), "Model B must not imply an activated pilot or authorized-caller reward path");

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
assert.ok(landing.includes("ALL 82 QUESTIONS &amp; ANSWERS"));
assert.ok(landing.includes("wiki/liquidity.html"));
assert.ok(!landing.includes("ALL 61 QUESTIONS &amp; ANSWERS"));

const copilotWiki = read("apps/ai-copilot/src/context/wiki-content.json");
assert.ok(copilotWiki.includes("Borrowing is disabled while LendingVault.ifrPriceWei = 0"));
// T-271: V1 is retired (3 October 2026); the borrower path is permanently disabled, not "future".
assert.ok(copilotWiki.includes("Borrower path — disabled (V1 retired)"));
assert.ok(!copilotWiki.includes("Future borrower path"));
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
    "Borrowing is permanently disabled: LendingVault V1 is retired by owner decision (3 October 2026), regardless of ifrPriceWei. Existing loans can still be repaid or topped up."
  ),
  // T-273: owner decision retired LendingVault V1; the stricter pin requires new borrowing to stay
  // blocked regardless of ifrPriceWei (previously only while the price was zero).
  "Web3 must block new LendingVault borrowing permanently (V1 retired), regardless of price"
);
assert.ok(
  read("docs/web3/index.html").includes(
    "Price-condition locks are disabled until the CommitmentVault price oracle is configured on-chain."
  ),
  "Web3 must fail closed when the CommitmentVault oracle is absent"
);

const faq = read("docs/wiki/faq.html");
const faqCount = (faq.match(/class="faq-item"/g) || []).length;
assert.equal(faqCount, 82, "Wiki FAQ count changed; update its visible count");
assert.ok(faq.includes(`${faqCount} questions.`));
assert.ok(read("docs/index.html").includes(`view all ${faqCount} questions`));

console.log("[functionality-status] PASS");
