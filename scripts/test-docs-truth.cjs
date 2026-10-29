#!/usr/bin/env node

// Guards the documentation truth matrix (docs/community-audits/DOCS_TRUTH_MATRIX_2026-09-27.md):
// the 18-component definition (15 deployed contracts + 3 Safes; a deployed list, not an activity claim), Safe-address coverage, current test counts, historical coverage
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
assert.equal(contracts.length, 15, "deployments/mainnet.json must list 15 protocol contracts");
assert.ok(!("pendingWiring" in manifest._manifest), "CommitmentVaultV2 is counted; no pendingWiring block may remain");
assert.equal(manifest.CommitmentVaultV2.address, "0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F");
assert.equal(manifest.CommitmentVault.address, "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3", "CommitmentVault V1 stays listed as legacy");
assert.equal(new Set(contracts.map((c) => lower(c.address))).size, contracts.length, "manifest must not double-count an address");
assert.ok(!contracts.some((c) => /PriceLockVault/i.test(c.name)), "undeployed PriceLockVault must not be counted");

const safes = {
  "Treasury Safe": "0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b",
  "Community Safe": "0xaC5687547B2B21d80F8fd345B51e608d476667C7",
  "LP Reserve Safe": "0x5D93E7919a71d725054e31017eCA86B026F86C04",
};
const excluded = {
  lpPair: "0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0",
  bootstrapVaultV1: "0xA820540936d18e1377C39dd9445E5b36F3F1261a",
};
assert.equal(contracts.length + Object.keys(safes).length, 18);
for (const address of Object.values(excluded)) {
  assert.ok(
    !contracts.some((c) => lower(c.address) === lower(address)),
    `${address} must not be counted as a protocol contract`
  );
}

// Every surface that states "15 + 3 = 18" must list all 15 contracts and all 3 Safes.
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
assert.ok(readme.includes("DEPLOYMENTS.md#canonical-mainnet-component-count-18"));

const deployments = read("docs/DEPLOYMENTS.md");
assert.ok(deployments.includes("### Canonical Mainnet Component Count (18)"));
assert.ok(deployments.includes("## Gnosis Safes (Mainnet)"));

// Landing list: 15 contracts + 3 Safes rendered as copyable rows.
const landing = read("docs/index.html");
// Visible landing counters show the canonical 18 (stat card and ledger row), never the previous 17.
assert.ok(/<div class="stat-value">18<\/div>\s*<div class="stat-label">On-chain components<\/div>/.test(landing), "landing stat card must show 18 on-chain components");
assert.ok(landing.includes('<span class="k">On-chain components</span><span class="v">18</span>'), "landing ledger must show 18 on-chain components");
const start = landing.indexOf('<h2 class="section-title">Contract Addresses</h2>');
const end = landing.indexOf("15 deployed contracts + 3 Gnosis Safes = 18 on-chain components", start);
assert.ok(start > 0 && end > start, "landing contract address section not found");
// Authority is contract-specific: the register includes Governance, Safe and deployer roles.
const contractSummary = landing.slice(start, landing.indexOf("</p>", start));
assert.ok(!/\ball contracts\b[\s\S]*\bowned by (?:the )?Governance\b/i.test(contractSummary), "landing must not claim universal Governance ownership");
assert.ok(contractSummary.includes('href="https://github.com/NeaBouli/inferno/blob/main/docs/DEPLOYMENTS.md#ownership-status-post-transfer"'), "landing authority summary must link to the rendered deployment register");
assert.ok(deployments.includes("### Ownership Status (Post-Transfer)"), "deployment register ownership link target must exist");
const rows = landing.slice(start, end).match(/class="contract-row"/g) || [];
assert.equal(rows.length, 18, "landing contract address list must render 15 contracts + 3 Safes");
// Rows are siblings, not nested: each row segment carries exactly one copy button and closes before the next row.
for (const segment of landing.slice(start, end).split('class="contract-row"').slice(1)) {
  assert.equal((segment.match(/data-addr="0x/g) || []).length, 1, "each landing contract row must hold exactly one address");
  // The segment ends with the next element's "<div " opener, so a closed row has at least as many closes as opens.
  const opens = (segment.match(/<div\b/g) || []).length;
  const closes = (segment.match(/<\/div>/g) || []).length;
  assert.ok(closes >= opens, "a landing contract row must close before the next row starts");
}

// Safes are proxies: never call all 18 components protocol contracts or immutable.
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
  /\b1[78] (deployed )?protocol contracts\b/i,
  /All 1[78] contracts\b/i,
  /\b1[67] (documented )?on-chain components\b/i,
  /\b14 deployed (protocol )?contracts\b/i,
  /All 14 (protocol |deployed )?contracts\b/i,
  /\b13 deployed contracts\b/i,
];
for (const relative of currentSurfaces) {
  const content = read(relative);
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(content), `${relative} matches stale claim ${pattern}`);
  }
}

// External audit IFRUNIT 2026-10-11 (IFR-DEV-08): since Proposal #21 (05.10.2026) the 1% pool fee goes to
// BuybackController, and the IFR held by FeeRouterV1 was recovered on 07.10.2026 (Proposals #22/#23).
const feeSurfaces = [
  "docs/index.html",
  "docs/wiki/protocol-plan.html",
  "docs/wiki/wallet-guide.html",
  "docs/wiki/tokenomics.html",
  "docs/wiki/contracts.html",
  "docs/wiki/fee-design.html",
];
const staleFee = [
  /1% to FeeRouterV1/i,
  /&rarr; FeeRouterV1 \(1\.0%\)/,
  /\+ 1% FeeRouter</,
  />FeeRouterV1 \(1%\)</,
  /stays without a withdrawal path/i,
  /held by FeeRouterV1 are not forwarded automatically/i,
];
for (const relative of feeSurfaces) {
  const content = read(relative);
  for (const pattern of staleFee) {
    assert.ok(!pattern.test(content), `${relative} matches stale pool-fee claim ${pattern}`);
  }
}

// Tests: the register's contract count is pinned to accepted exact-source CI evidence.
const register = JSON.parse(read("docs/community-audits/cwa-remediation-register.json"));
assert.equal(register.canonicalTests.contracts, "700/700");
const status = read("docs/CURRENT_FUNCTIONALITY_STATUS.md");
assert.ok(status.includes("`700/700` passing"));
for (const marker of [
  "37998031908", "9 October 2026", "22:14:36.8215428Z",
  "d095ff4b73ea78466b3aa45ff10e7621f5d2eb57",
  "prior 693 plus exactly 7 FeeRouter parity tests",
  "700 passing (16s)", "700 passing (700 mocha)",
  "Mocha serializer selfcheck runs separately",
]) {
  assert.ok(status.includes(marker), `contract evidence missing: ${marker}`);
}
// Browser suites: "Landing/Wiki browser" = tests/browser/wallet-connect.spec.js (26) and
// "Web3 browser" = tests/browser/web3-write.spec.js (85), each reproduced with
// `npx playwright test tests/browser/<spec> --list` on main eead5086 (T-274).
assert.equal(register.canonicalTests.landingWikiBrowser, "26/26");
assert.equal(register.canonicalTests.web3Browser, "85/85");
assert.ok(status.includes("Landing/Wiki wallet browser suite: `26/26` passing"));
assert.ok(status.includes("Web3 write-path browser suite: `85/85` passing"));
assert.ok(readme.includes("Landing/Wiki browser **26/26**, Web3 browser **85/85**"));
for (const relative of ["README.md", "docs/CURRENT_FUNCTIONALITY_STATUS.md", "docs/llms.txt", ]) {
  const content = read(relative);
  assert.ok(content.includes("T-274") && content.includes("6 October 2026") && content.includes("eead5086"), `${relative} must date retained browser evidence`);
}
for (const relative of ["docs/llms.txt", ]) {
  assert.ok(read(relative).includes("Landing/Wiki browser 26/26, Web3 browser 85/85"), `${relative} browser counts`);
}
for (const relative of ["README.md", "docs/CURRENT_FUNCTIONALITY_STATUS.md", "docs/index.html"]) {
  assert.ok(!/\b642 (contract )?tests\b/i.test(read(relative)), `${relative} cites the stale 642 count`);
}

// F6: visible and structured FAQ answers must describe proposals, not settled mechanics.
const faq = read("docs/wiki/faq.html");
const faqSchema = [...faq.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
  .map((match) => JSON.parse(match[1]))
  .find((data) => data["@type"] === "FAQPage");
assert.ok(faqSchema, "FAQPage structured data missing");
const structuredForum = faqSchema.mainEntity.find((entry) => entry.name === "What is the two-chamber governance system?")?.acceptedAnswer?.text;
const visibleForum = faq.match(/id="faq-two-chamber">[\s\S]*?<div class="faq-a">([\s\S]*?)<\/div>/)?.[1];
function assertForumProposal(answer) {
  assert.equal(typeof answer, "string", "Forum answer missing");
  for (const marker of ["draft proposes", "10 IFR proposal deposit", "1 locked IFR = 1 vote", "neither mechanic is ratified", "not live", "ADVISORY"]) {
    assert.ok(answer.includes(marker), `Forum answer must retain proposal boundary: ${marker}`);
  }
  assert.ok(!answer.includes("(10 IFR spam protection fee)"), "Forum fee must not be presented as settled");
}
for (const answer of [structuredForum, visibleForum]) {
  assertForumProposal(answer);
  for (const [from, to] of [
    ["draft proposes", "rules require"],
    ["neither mechanic is ratified", "both mechanics are ratified"],
    ["10 IFR proposal deposit", "(10 IFR spam protection fee)"],
  ]) {
    assert.throws(() => assertForumProposal(answer.replace(from, to)), { name: "AssertionError" });
  }
}
const depositAnswer = faqSchema.mainEntity.find((entry) => entry.name === "What is the 10 IFR spam protection fee?")?.acceptedAnswer?.text;
assert.ok(depositAnswer?.includes("unratified") && depositAnswer.includes("not a live fee"), "structured deposit answer must match the visible draft boundary");
const governance = read("docs/wiki/governance.html");
const dipBoundary = governance.match(/<p id="ifr-dip-01">([\s\S]*?)<\/p>/)?.[1];
function assertAdvisoryBoundary(boundary) {
  assert.equal(typeof boundary, "string", "IFR-DIP-01 boundary missing");
  for (const marker of ["IFR-DIP-01", "10 October 2026", "ADVISORY", "until binding authority is resolved", "Council readiness, Forum signal and authorized Safe action are separate stages"]) {
    assert.ok(boundary.includes(marker), `IFR-DIP-01 boundary missing: ${marker}`);
  }
}
assertAdvisoryBoundary(dipBoundary);
assert.throws(() => assertAdvisoryBoundary(dipBoundary.replace("ADVISORY", "BINDING")), { name: "AssertionError" });
assert.ok(read("docs/wiki/roadmap.html").includes('href="governance.html#ifr-dip-01"'), "roadmap must link the advisory completion boundary");

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

// Public claims must retain the accepted capability boundaries, across the retained public surfaces.
// Historical audit submissions and deprecated documents are deliberately outside this current-copy corpus.
const claimSurfaces = [
  "README.md", "docs/PRESS_KIT.md", "docs/WHITEPAPER.md", "docs/index.html", "docs/llms.txt",
  ...["docs/wiki", "docs/web3", "docs/wizard"].flatMap((directory) =>
    fs.readdirSync(path.join(root, directory))
      .filter((file) => file.endsWith(".html"))
      .map((file) => `${directory}/${file}`)
  ),

];
const stalePublicClaims = [
  /no insider allocations?\b/i,
  /no private allocation\b/i,
  /direct Uniswap V2 listing.{0,50}day one/i,
  /buyback loop from protocol fees adds further pressure/i,
  /automatic premium access to all builder products/i,
  /access (?:tiers )?across all partner products/i,
  /no personal data (?:stored|processed)/i,
  /no wallet data stored/i,
  /no privacy concerns/i,
  /create\/increase LendingVault offers/i,
  /create or increase LendingVault offers/i,
  /borrow when on-chain pricing is active/i,
  /lock with time or price conditions/i,
  /guided lender flow:.*create offer/i,
  /the builder automatically receives a percentage of the locked amount/i,
  /Bootstrap (?:is |phase is )?LIVE since/i,
  /BOOTSTRAP STATUS: NOW ACTIVE/i,
];
function assertCurrentPublicClaims(content, label) {
  // Join prose across HTML tags, Markdown emphasis and line breaks without discarding FAQ scripts.
  const prose = content.replace(/<[^>]*>/g, " ").replace(/\*/g, "").replace(/\s+/g, " ");
  for (const pattern of stalePublicClaims) {
    assert.ok(!pattern.test(prose), `${label} contains a superseded public claim: ${pattern}`);
  }
}
for (const relative of claimSurfaces) assertCurrentPublicClaims(read(relative), relative);

// Negative fixtures prove the guards reject the actual contradictions, including HTML and wrapped prose.
for (const stale of [
  "No insider allocations.", "no private allocation.",
  "<strong>Direct Uniswap V2 Listing</strong> &mdash; permissionless, day one",
  "A buyback loop from protocol fees adds further pressure.",
  "As long as locked, automatic premium access to all builder products.",
  "Gain access tiers across all partner products.",
  "Unlock Bronze / Silver / Gold / Platinum access across all partner products.",
  "Privacy-neutral: no personal data stored.", "No personal data processed",
  "Privacy: No wallet data stored", "No privacy concerns.",
  "create/increase LendingVault offers", "create or increase LendingVault offers",
  "borrow when on-chain pricing is active", "lock with time or price conditions",
  "Guided lender flow: connect, choose amount, approve, create offer, verify market status.",
  "The builder automatically receives a percentage\nof the locked amount",
  "Bootstrap is LIVE since 07.03.2026", "BOOTSTRAP STATUS: NOW ACTIVE",
]) assert.throws(() => assertCurrentPublicClaims(stale, "negative fixture"), { name: "AssertionError" });
for (const accurate of [
  "No names or emails required; public wallet addresses are processed as pseudonymous identifiers.",
  "Ordinary Benefits checkout records exclude raw customer wallet addresses; the backend processes them to check eligibility. Merchant checkout records remain, and conditional Model B rewards can retain scoped wallet-derived HMACs and a UTC month. Retention period not yet defined.",
  "BuybackVault is dormant; no active buyback/burn flywheel is fed by the IFR pool fee.",
  "LendingVault V1 creation/increase and new borrowing are permanently retired in official interfaces.",
]) assertCurrentPublicClaims(accurate, "positive fixture");

const requiredClaimBoundaries = [
  ["README.md", ["15% team allocation is vested", "Bootstrap ended and finalized on 5 June 2026", "After the separately governed FeeRouterV1 recovery, the Treasury Safe held 734,545.074097347 IFR at block 26,151,369", "No buyback/burn flywheel is fed by the pool fee today"]],
  ["docs/PRESS_KIT.md", ["15% team allocation is vested", "Bootstrap ended and finalized on 5 June 2026", "BuybackVault is dormant", "no active buyback/burn flywheel", "no pilot partner is activated", "no production deployment record"]],
  ["docs/WHITEPAPER.md", ["each participating product's required IFR amount remaining locked", "a lock does not unlock every builder product", "IFRLock can be unlocked at any time", "CommitmentVault tranches are separate locks", "Until March 2027", "Locks alone earn no rewards", "recordMilestone", "no pilot partner is activated", "BuybackVault is dormant", "no active buyback/burn flywheel", "15 deployed protocol contracts plus 3 Gnosis Safes", "Phase 2 — Multisig | Complete", "Phase 3 — Growth | In Progress", "public wallet addresses are", "pseudonymous identifiers"]],
  ["docs/index.html", ["15% team allocation is vested", "Bootstrap finalized 5 June 2026", "BuybackVault is dormant", "no active buyback/burn flywheel", "New CommitmentVault locks are TIME_ONLY in V2", "no new offers, increases or borrowing", "withdrawals and existing-loan repayment/top-up remain available", "New TIME_ONLY locks use V2", "Price-conditioned locks are unavailable", "Withdraw the full available unlent amount", "New borrowing is disabled", "public wallet addresses are processed as pseudonymous identifiers"]],
  ["docs/wiki/fair-launch.html", ["Public Bootstrap, then Uniswap V2", "finalized on 5 June 2026", "pool was created separately with 100M IFR + 0.030 ETH"]],
  ["docs/wiki/press-kit.html", ["15% team allocation is vested", "Bootstrap finalized on 5 June 2026", "Bootstrap liquidity followed in Q2", "Partner activation remains open", "Access depends on each participating product's required amount remaining locked"]],
  ["docs/wiki/one-pager.html", ["BuybackVault is dormant", "no active buyback/burn flywheel", "each participating product sets its own required amount"]],
  ["docs/wiki/index.html", ["creation/increase and new borrowing are permanently retired", "New TIME_ONLY locks in V2", "V1 retired: no new offers, increases or borrowing"]],
  ["docs/wiki/integration.html", ["Data minimization", "No names or emails required for lock checks", "Public wallet addresses are processed as pseudonymous identifiers"]],
  ["docs/wiki/integrate-benefits.html", ["Self-hosted instances process", "public wallet addresses as pseudonymous identifiers", "may also process membership identifiers"]],
  ["docs/wiki/lock-mechanism.html", ["No names or emails are required for the lock check", "public wallet addresses are processed as pseudonymous identifiers"]],
  ["docs/wiki/faq.html", ["public wallet addresses are processed as pseudonymous identifiers by the app and its RPC provider", "historical contributor plan", "permanently retire V1 offer creation/increase and new borrowing"]],
  ["docs/wiki/ecosystem.html", ["retired LendingVault V1", "permanently retired in official interfaces, regardless of price", "existing-loan repayment/top-up remain available", "PartnerVault rewards planned, not active", "no authorized-caller path is used"]],
  ["docs/wizard/lend.html", ["<title>LendingVault V1 Withdrawals", "permanently disable new offers, offer increases and new borrowing, regardless of price", "existing borrowers can repay or top up collateral", "historical V1 design parameters, not an available earning offer"]],
  ["docs/web3/index.html", ["CommitmentVault V2 TIME_ONLY locks and existing-tranche unlocks", "existing-loan repayment/top-up (no new offers, increases or borrowing)"]],
  ["docs/llms.txt", ["create TIME_ONLY locks in CommitmentVault V2", "permanently retired in official interfaces, regardless of price", "underlying contract functions are not removed", "dormant; no active buyback/burn flywheel", "public wallet addresses are processed as pseudonymous identifiers", "retains merchant checkout records, seller wallets and audit events"]],


];
for (const [relative, markers] of requiredClaimBoundaries) {
  const content = read(relative);
  for (const marker of markers) assert.ok(content.includes(marker), `${relative} must retain claim boundary: ${marker}`);
}
console.log("[docs-truth] PASS - 15 contracts + 3 Safes = 18; 700 contract tests; dated browser evidence; Forum advisory boundary; historical coverage labelled; 7 deployment units; public launch, buyback, capability and pseudonymous-data boundaries");
