#!/usr/bin/env node
/**
 * Security reporting configuration regression test (dependency-free).
 *
 * Verifies consistency between the GitHub issue chooser contact links
 * (.github/ISSUE_TEMPLATE/config.yml) and the public security policy
 * documents (SECURITY.md, docs/SECURITY_POLICY.md):
 *
 *  1. The issue chooser offers a clearly named private security report
 *     contact link to GitHub Security Advisories plus a general security
 *     discussion contact link, while legitimate bug/feature templates stay
 *     available.
 *  2. Both policy documents state: Private Vulnerability Reporting is
 *     enabled; public issues must not contain undisclosed vulnerabilities;
 *     there is no bug bounty; duplicates/known findings are not new
 *     findings; and private reports should include impact, affected
 *     version/deployment, reproducible evidence, and suggested remediation.
 *  3. No guaranteed response time is promised.
 *  4. The legacy public security issue templates
 *     (.github/ISSUE_TEMPLATE/security.md, security-audit.md) are removed.
 *     This check fails if either public template is reintroduced.
 *  5. Published security entry points do not retain links to the removed
 *     public template, and the Docs workflow keeps this test enabled.
 *  6. docs/.well-known/security.txt (RFC 9116) names only the public
 *     advisory contact, states the no-bounty status and has not expired.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ADVISORY_URL = "https://github.com/NeaBouli/inferno/security/advisories/new";
const DISCUSSIONS_URL = "https://github.com/NeaBouli/inferno/discussions";

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// --- 1. Issue chooser contact links ----------------------------------------
const configPath = ".github/ISSUE_TEMPLATE/config.yml";
assert.ok(fs.existsSync(path.join(root, configPath)), `${configPath} must exist`);
const config = read(configPath);

assert.ok(
  /blank_issues_enabled:\s*false/.test(config),
  `${configPath} must set blank_issues_enabled: false`
);
assert.equal(
  (config.match(/^  - name:/gm) || []).length,
  2,
  `${configPath} must contain exactly two correctly indented contact links`
);
assert.equal(
  (config.match(/^    url:/gm) || []).length,
  2,
  `${configPath} contact-link URLs must use valid mapping indentation`
);
assert.ok(
  config.includes(ADVISORY_URL),
  `${configPath} must link to ${ADVISORY_URL} for private security reports`
);
assert.ok(
  /name:\s*["']?[^\n]*private security report/i.test(config),
  `${configPath} must have a contact link clearly named for private security reports`
);
assert.ok(
  config.includes(DISCUSSIONS_URL),
  `${configPath} must link to ${DISCUSSIONS_URL} for general security discussion`
);
assert.ok(
  /name:\s*["']?[^\n]*security discussion/i.test(config),
  `${configPath} must have a contact link named for general security discussion`
);

for (const template of ["bug_report.md", "feature_request.md"]) {
  assert.ok(
    fs.existsSync(path.join(root, ".github/ISSUE_TEMPLATE", template)),
    `Legitimate reporting template .github/ISSUE_TEMPLATE/${template} must stay available`
  );
}

// --- 2. Policy document consistency -----------------------------------------
for (const doc of ["SECURITY.md", "docs/SECURITY_POLICY.md"]) {
  const text = read(doc);

  assert.ok(
    /private vulnerability reporting is enabled/i.test(text),
    `${doc} must state that Private Vulnerability Reporting is enabled`
  );
  assert.ok(
    text.includes(ADVISORY_URL),
    `${doc} must point to ${ADVISORY_URL}`
  );
  assert.ok(
    /must\s+not[^\n]*undisclosed/i.test(text),
    `${doc} must state that public issues must not contain undisclosed vulnerabilities`
  );
  assert.ok(
    /no bug bounty/i.test(text),
    `${doc} must state that there is no bug bounty`
  );
  assert.ok(
    /duplicates?[^\n]*known|known[^\n]*duplicates?/i.test(text) &&
      /not new findings/i.test(text),
    `${doc} must state that duplicates/known findings are not new findings`
  );
  for (const field of [
    /impact/i,
    /affected version\/deployment/i,
    /reproducible evidence/i,
    /suggested remediation/i,
  ]) {
    assert.ok(
      field.test(text),
      `${doc} must ask reporters to include ${field.source} in private reports`
    );
  }
  assert.ok(
    !/within\s+48\s?h/i.test(text) && !/respond(s|ed)?\s+in\s+\d+\s?h/i.test(text),
    `${doc} must not promise a guaranteed response time`
  );
}

// --- 3. Legacy public security issue templates must be gone -----------------
const legacy = [
  ".github/ISSUE_TEMPLATE/security.md",
  ".github/ISSUE_TEMPLATE/security-audit.md",
].filter((rel) => fs.existsSync(path.join(root, rel)));

assert.deepStrictEqual(
  legacy,
  [],
  "Public security issue templates must not exist: " +
    legacy.join(", ")
);

// --- 4. Published entry points and CI wiring -------------------------------
for (const doc of [
  "README.md",
  "SECURITY.md",
  "docs/SECURITY_POLICY.md",
  "docs/SECURITY_AUDIT_SKYWALKER.md",
  "docs/index.html",
  "docs/wiki/open-audit.html",
  "docs/wiki/press-kit.html",
  "docs/wiki/security.html",
  "docs/wiki/testnet.html",
]) {
  const text = read(doc);
  assert.ok(
    !text.includes("issues/new?template=security-audit.md"),
    `${doc} must not link to the removed public security issue template`
  );
}

// --- 5. RFC 9116 security.txt on the apex host (CWA-22) --------------------
// Only the public advisory URL is allowed as contact; no private e-mail or phone
// data, no reward promise, and an Expires date that still lies in the future.
const securityTxt = read("docs/.well-known/security.txt");
const securityFields = Object.fromEntries(
  securityTxt
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator), line.slice(separator + 1).trim()];
    })
);
assert.equal(securityFields.Contact, ADVISORY_URL, "security.txt Contact must be the private advisory URL");
assert.equal(
  (securityTxt.match(/^Contact:/gm) || []).length,
  1,
  "security.txt must list exactly one contact"
);
assert.ok(!/mailto:|tel:|@[a-z0-9-]+\./i.test(securityTxt), "security.txt must not expose private contact data");
assert.equal(securityFields.Policy, "https://github.com/NeaBouli/inferno/blob/main/SECURITY.md");
assert.equal(securityFields.Canonical, "https://ifrunit.tech/.well-known/security.txt");
const expires = Date.parse(securityFields.Expires);
assert.ok(Number.isFinite(expires), "security.txt must carry a parseable Expires field");
assert.ok(expires > Date.now(), "security.txt Expires has passed; refresh it");
assert.ok(/no bug bounty/i.test(securityTxt), "security.txt must state that there is no bug bounty");
assert.ok(
  !/reward/i.test(securityTxt.replace(/no reward is promised/gi, "")),
  "security.txt must not promise rewards"
);

const workflow = read(".github/workflows/docs-validator.yml");
assert.ok(
  workflow.includes("run: npm run test:security-reporting"),
  "Docs Validator must run the security reporting regression test"
);
assert.ok(
  workflow.includes("'scripts/test-security-reporting-config.cjs'") &&
    workflow.includes("'.github/ISSUE_TEMPLATE/**'"),
  "Docs Validator path filters must cover the security reporting configuration"
);

console.log("[security-reporting-config] PASS");
