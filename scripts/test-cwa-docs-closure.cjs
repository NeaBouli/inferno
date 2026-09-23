#!/usr/bin/env node
/**
 * Public-documentation CWA closure guard (dependency-free).
 *
 * Pins the T-116 remediations of CWA-15, CWA-22, CWA-23, CWA-51, CWA-52 and
 * CWA-53, plus the repository-verifiable members of the CWA-20 drift cluster
 * and the apex-host members of CWA-81, against the sources they were derived
 * from: contract source, the deployment record and the served Copilot code.
 *
 * Every assertion here exists because a published claim drifted away from its
 * source once. A claim that this file cannot tie back to a source in the
 * repository is not treated as closed.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function requireText(relative, markers) {
  const content = read(relative);
  for (const marker of markers) {
    assert.ok(content.includes(marker), `${relative} missing marker: ${marker}`);
  }
  return content;
}

function forbidText(relative, markers) {
  const content = read(relative);
  for (const marker of markers) {
    assert.ok(!content.includes(marker), `${relative} retains stale claim: ${marker}`);
  }
}

// --- CWA-15: the withdrawal cap is a governed parameter, not an invariant ----
requireText("contracts/liquidity/LiquidityReserve.sol", [
  "function setMaxWithdrawPerPeriod(uint256 _max) external onlyOwner",
]);
requireText("README.md", [
  "That cap is a governed parameter (`setMaxWithdrawPerPeriod`, owner = Governance), not a hardcoded invariant",
  "the per-period withdrawal cap itself is Governance-changeable under the 48-hour timelock",
]);
requireText("docs/wiki/security.html", [
  "That cap is a governed parameter (<code>setMaxWithdrawPerPeriod</code>, owner = Governance), not a hardcoded invariant",
]);
requireText("docs/wiki/transparency.html", [
  "itself Governance-changeable under the 48-hour timelock",
  "a governed parameter, changeable by Governance under the 48-hour timelock",
]);
requireText("docs/wiki/lp-strategy.html", [
  "a governed parameter, changeable by Governance under the 48-hour timelock",
]);
requireText("docs/llms.txt", [
  "the per-period cap is a governed parameter (setMaxWithdrawPerPeriod), not a hardcoded invariant",
]);
forbidText("docs/wiki/security.html", [
  "the contract limits withdrawals to 50M IFR per 90-day period.",
]);

// --- CWA-22: a machine-readable security contact exists and stays truthful ---
const securityTxt = requireText("docs/.well-known/security.txt", [
  "Contact: https://github.com/NeaBouli/inferno/security/advisories/new",
  "Policy: https://github.com/NeaBouli/inferno/blob/main/SECURITY.md",
  "Canonical: https://ifrunit.tech/.well-known/security.txt",
  "There is no bug bounty programme.",
]);
const expires = securityTxt.match(/^Expires:\s*(\S+)$/m);
assert.ok(expires, "security.txt must carry an RFC 9116 Expires field");
const expiresAt = new Date(expires[1]);
assert.ok(!Number.isNaN(expiresAt.getTime()), "security.txt Expires must be a valid date");
assert.ok(expiresAt > new Date(), `security.txt expired on ${expires[1]} — renew it`);
assert.ok(
  (expiresAt - Date.now()) / 86400000 <= 366,
  "security.txt Expires must stay within one year, per RFC 9116"
);
requireText("SECURITY.md", ["https://ifrunit.tech/.well-known/security.txt"]);
requireText("docs/SECURITY_POLICY.md", ["https://ifrunit.tech/.well-known/security.txt"]);

// --- CWA-23: the mainnet manifest records every current component -----------
const manifest = JSON.parse(read("deployments/mainnet.json"));
const deployments = read("docs/DEPLOYMENTS.md");
const readme = read("README.md");
const mainnetContracts = [
  "InfernoToken",
  "Governance",
  "IFRLock",
  "BurnReserve",
  "BuybackVault",
  "PartnerVault",
  "FeeRouterV1",
  "Vesting",
  "LiquidityReserve",
  "BootstrapVaultV3",
  "BuilderRegistry",
  "CommitmentVault",
  "LendingVault",
  "BuybackController",
];
assert.equal(manifest._manifest.chainId, 1, "mainnet manifest must pin chain 1");
for (const name of mainnetContracts) {
  const entry = manifest[name];
  assert.ok(entry, `deployments/mainnet.json is missing ${name}`);
  assert.match(entry.address, /^0x[0-9a-fA-F]{40}$/, `${name} address is malformed`);
  assert.equal(entry.network, "mainnet", `${name} must be recorded on mainnet`);
  assert.equal(entry.verified, true, `${name} must record its verification status`);
  assert.match(entry.deployedOn, /^\d{4}-\d{2}-\d{2}$/, `${name} needs a documented deployment date`);
  assert.ok(
    deployments.includes(entry.address),
    `${name} address in the manifest is not backed by docs/DEPLOYMENTS.md`
  );
  assert.ok(
    readme.includes(entry.address),
    `${name} address in the manifest is not published in README.md`
  );
}
assert.equal(
  manifest.BootstrapVaultV1.status,
  "deprecated",
  "the manifest must keep BootstrapVault V1 marked deprecated"
);
assert.equal(manifest.BootstrapVaultV1.supersededBy, "BootstrapVaultV3");
// The BuybackController provenance written by scripts/deploy-buyback-controller.js
// must survive; scripts/propose-buyback-wiring.js resolves the address from here.
assert.match(manifest.BuybackController.tx, /^0x[0-9a-fA-F]{64}$/);

// --- CWA-51: allocation intent and current custody are stated separately ----
requireText("README.md", [
  "Original allocation. Current custody: LP Reserve Safe (3-of-5)",
  "which holds 400.6M IFR — the DEX allocation plus the aggregated Treasury and Community remainders",
  "and therefore **currently holds 0 IFR**; the remainder is aggregated in the LP Reserve Safe",
  "so the Safe **currently holds 7.9M IFR** as its permanent operational reserve",
]);
forbidText("README.md", [
  "| Treasury | 15% | 150M IFR | Gnosis Safe multisig (0x5ad6193...).",
  "Community Safe (57.9M received after burn). 50M → Bootstrap. ~7.9M operational reserve.",
]);
// The custody statements above must match the canonical transparency balances.
requireText("docs/wiki/transparency.html", ["400,600,000 IFR", "7,900,000 IFR"]);

// --- CWA-52: the fee flywheel claim follows the deployed FeeRouterV1 flow ---
forbidText("README.md", [
  "BuybackVault and BurnReserve accumulate from the 1% protocol pool fee",
]);
requireText("README.md", [
  "routed to FeeRouterV1, which has no IFR withdrawal or forwarding function",
  "BuybackVault and BurnReserve currently hold 0 IFR",
]);
requireText("docs/FEE_DESIGN.md", [
  "It does not forward IFR transfer-pool fees already held by FeeRouterV1.",
]);
const feeRouter = read("contracts/FeeRouterV1.sol");
assert.ok(
  !/function\s+withdraw(IFR|Token)?\s*\(/.test(feeRouter),
  "FeeRouterV1 gained a withdrawal path — the README fee description must be revisited"
);

// --- CWA-53: the Copilot safety claim matches the served control ------------
const copilot = read("apps/ai-copilot/src/components/IFRCopilot.tsx");
requireText("apps/ai-copilot/src/components/IFRCopilot.tsx", [
  'const SAFETY_WORDS = ["seed phrase", "private key", "mnemonic", "secret recovery"];',
]);
assert.ok(
  copilot.includes("const safetyWarning = checkSafety(trimmed);"),
  "the Copilot widget must keep screening inbound messages before sending them"
);
forbidText("README.md", ["Automatic seed phrase / private key detection"]);
requireText("README.md", [
  "matches inbound messages against a fixed keyword list",
  "There is no pattern-based detector for secret values themselves.",
]);

// --- CWA-20 (repository-verifiable members) ---------------------------------
requireText("docs/DOCS.md", [
  "rewardBps=1500 (15%)",
  "`ifrLock` is unset (`address(0)`) on the deployed vault",
]);
forbidText("docs/DOCS.md", ["rewardBps=1000 (10%)"]);
requireText("docs/wiki/contracts.html", [
  "Dormant on mainnet: <code>ifrLock</code> is unset (<code>address(0)</code>)",
]);
// Vesting starts at genesis (2026-03-05), not a year earlier.
requireText("docs/wiki/vesting.html", ["start:         1772670647   // Mar 5, 2026 (Unix timestamp)"]);
forbidText("docs/wiki/vesting.html", ["1741168424"]);
assert.equal(
  new Date(1772670647 * 1000).getUTCFullYear(),
  2026,
  "the published vesting start must fall in the genesis year"
);
forbidText("docs/wiki/integration.html", [
  "The remaining 57.9M IFR (6%) is reserved for community grants",
]);
requireText("docs/wiki/integration.html", [
  "leaving 7.9M IFR as the standing reserve for community grants",
]);

// --- CWA-81 (apex host) -----------------------------------------------------
const sitemap = read("docs/sitemap.xml");
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert.ok(locations.length > 0, "apex sitemap must list URLs");
for (const location of locations) {
  assert.ok(
    location.startsWith("https://ifrunit.tech/"),
    `apex sitemap must stay same-host: ${location}`
  );
  const relative = location.replace("https://ifrunit.tech/", "") || "index.html";
  const file = relative.endsWith("/") ? `docs/${relative}index.html` : `docs/${relative}`;
  assert.ok(fs.existsSync(path.join(root, file)), `apex sitemap points at a missing page: ${file}`);
}
// /web3/ canonicalises to the web3 host, so the apex sitemap must not claim it.
assert.ok(
  read("docs/web3/index.html").includes('<link rel="canonical" href="https://web3.ifrunit.tech/">'),
  "docs/web3/index.html must keep its cross-host canonical"
);
assert.ok(
  !locations.includes("https://ifrunit.tech/web3/"),
  "apex sitemap must not list /web3/, which canonicalises to https://web3.ifrunit.tech/"
);
assert.ok(
  locations.includes("https://ifrunit.tech/wiki/liquidity.html"),
  "apex sitemap must keep the liquidity page"
);
const staleLastmod = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)]
  .map((match) => match[1])
  .filter((value) => value < "2026-09-01");
assert.deepEqual(
  staleLastmod,
  [],
  `apex sitemap carries lastmod values from before the September documentation pass: ${staleLastmod.join(", ")}`
);
// Every page reachable from the sitemap that is not the wiki index carries JSON-LD;
// docs/builder.html was the one gap the AI-readiness audit found.
const builder = read("docs/builder.html");
const builderBlocks = [
  ...builder.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
];
assert.ok(builderBlocks.length >= 1, "docs/builder.html must carry JSON-LD");
for (const [index, block] of builderBlocks.entries()) {
  let parsed;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(block[1]);
  }, `docs/builder.html JSON-LD block ${index + 1} must be valid JSON`);
  assert.equal(parsed["@context"], "https://schema.org");
}
const builderPrimary = builderBlocks
  .map((block) => JSON.parse(block[1]))
  .find((block) => block["@type"] === "WebApplication");
assert.ok(builderPrimary, "docs/builder.html needs a primary WebApplication schema");
assert.equal(builderPrimary.url, "https://ifrunit.tech/builder.html");

// --- Register dispositions must match the evidence above --------------------
const register = JSON.parse(read("docs/community-audits/cwa-remediation-register.json"));
const disposition = (id) => register.findings.find((entry) => entry.id === id)?.disposition;
for (const id of ["CWA-15", "CWA-22", "CWA-23", "CWA-51", "CWA-52", "CWA-53"]) {
  assert.equal(disposition(id), "fixed_and_verified", `${id} status must match evidence`);
}
// Still open: CWA-20 spans off-repository surfaces, CWA-21 needs an owner and
// legal decision, CWA-81 needs the web3 host's own anchors.
for (const id of ["CWA-20", "CWA-21", "CWA-81"]) {
  assert.equal(disposition(id), "open_actionable", `${id} must not be closed without evidence`);
}

console.log(
  "[cwa-docs-closure] PASS - CWA-15/22/23/51/52/53 closed; CWA-20/81 partial members pinned"
);
