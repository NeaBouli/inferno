#!/usr/bin/env node

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const auditDir = path.join(root, "docs", "community-audits");
const dataPath = path.join(auditDir, "july-2026-remediation-register.json");
const markdownPath = path.join(auditDir, "JULY_2026_REMEDIATION_REGISTER.md");
const writeMode = process.argv.includes("--write");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const statuses = new Set(Object.keys(data.statusDefinitions));
const severities = new Set(["Critical", "High", "Medium", "Low"]);

assert.equal(data.schemaVersion, 1, "unsupported July audit register schema");
assert.equal(data.findings.length, 23, "July audit register must contain 23 normalized findings");

const statusTotals = Object.fromEntries([...statuses].map((key) => [key, 0]));
const severityTotals = Object.fromEntries([...severities].map((key) => [key, 0]));

for (const [index, finding] of data.findings.entries()) {
  assert.equal(finding.id, `JUL-${String(index + 1).padStart(2, "0")}`);
  assert.ok(statuses.has(finding.status), `${finding.id} has invalid status`);
  assert.ok(severities.has(finding.severity), `${finding.id} has invalid severity`);
  for (const field of ["title", "sourceSection", "currentAssessment", "remainingAction", "verification"]) {
    assert.equal(typeof finding[field], "string", `${finding.id}.${field} must be a string`);
    assert.ok(finding[field].trim(), `${finding.id}.${field} must not be empty`);
  }
  assert.ok(Array.isArray(finding.evidence) && finding.evidence.length > 0, `${finding.id} needs evidence`);
  for (const evidence of finding.evidence) {
    assert.ok(evidence.path && evidence.marker, `${finding.id} evidence must include path and marker`);
    const evidencePath = path.join(root, evidence.path);
    assert.ok(fs.existsSync(evidencePath), `${finding.id} evidence path missing: ${evidence.path}`);
    assert.ok(
      fs.readFileSync(evidencePath, "utf8").includes(evidence.marker),
      `${finding.id} evidence marker missing from ${evidence.path}: ${evidence.marker}`
    );
  }
  statusTotals[finding.status] += 1;
  severityTotals[finding.severity] += 1;
}

assert.deepEqual(statusTotals, data.expectedStatusTotals);
assert.deepEqual(severityTotals, data.expectedSeverityTotals);

const originalPath = path.join(auditDir, data.originalAudit.path);
const originalHash = crypto.createHash("sha256").update(fs.readFileSync(originalPath)).digest("hex");
assert.equal(originalHash, data.originalAudit.sha256, "original July audit hash changed");

assert.equal(fs.existsSync(path.join(root, "docs", "TODO.md")), false, "public TODO.md returned");
assert.equal(fs.existsSync(path.join(root, "docs", "TODO.html")), false, "public TODO.html returned");
assert.equal(fs.existsSync(path.join(root, "LICENSE")), false, "JUL-15 status must be reviewed when a root license is added");

const buybackSources = [
  "contracts/buyback/BuybackController.sol",
  "contracts/buyback/BuybackVault.sol",
].map((relative) => fs.readFileSync(path.join(root, relative), "utf8")).join("\n");
assert.ok(buybackSources.includes("swapExactETHForTokens"), "JUL-08 status no longer matches sources");
assert.ok(!buybackSources.includes("SupportingFeeOnTransferTokens"), "JUL-08 requires status review");

const markdown = renderMarkdown(data);
if (writeMode) {
  fs.writeFileSync(markdownPath, markdown);
  console.log(`[july-audit-register] wrote ${path.relative(root, markdownPath)}`);
} else {
  assert.ok(fs.existsSync(markdownPath), "missing generated July audit remediation Markdown");
  assert.equal(
    fs.readFileSync(markdownPath, "utf8"),
    markdown,
    "July audit remediation Markdown is stale; run npm run build:july-audit-register"
  );
}

for (const relative of [
  "README.md",
  "docs/community-audits/README.md",
  "docs/wiki/open-audit.html",
  "docs/wiki/security.html",
  "docs/llms.txt",
  "apps/ai-copilot/src/context/ifr-knowledge.ts",
]) {
  const content = fs.readFileSync(path.join(root, relative), "utf8");
  assert.ok(content.includes("JULY_2026_REMEDIATION_REGISTER"), `${relative} must link to July status register`);
}

const publicStatusMarkers = {
  "README.md": [
    `${statusTotals.fixed_and_verified} fixed and verified`,
    `${statusTotals.partially_remediated} partially remediated`,
  ],
  "docs/community-audits/README.md": [
    `${statusTotals.fixed_and_verified} fixed and verified`,
    `${statusTotals.partially_remediated} partially`,
  ],
  "docs/wiki/open-audit.html": [
    `${statusTotals.fixed_and_verified} fixed and verified`,
    `${statusTotals.partially_remediated} partially`,
  ],
  "docs/wiki/security.html": [
    `${statusTotals.fixed_and_verified} findings are fixed and verified`,
    `${statusTotals.partially_remediated} partially remediated`,
  ],
  "docs/llms.txt": [
    `${statusTotals.fixed_and_verified} fixed and verified`,
    `${statusTotals.partially_remediated} partially remediated`,
  ],
  "apps/ai-copilot/src/context/ifr-knowledge.ts": [
    `${statusTotals.fixed_and_verified} fixed and verified`,
    `${statusTotals.partially_remediated} partially remediated`,
  ],
};
for (const [relative, markers] of Object.entries(publicStatusMarkers)) {
  const content = fs.readFileSync(path.join(root, relative), "utf8");
  for (const marker of markers) {
    assert.ok(content.includes(marker), `${relative} missing current July status marker: ${marker}`);
  }
}

console.log(
  `[july-audit-register] PASS - ${data.findings.length} findings; statuses ${JSON.stringify(statusTotals)}`
);

function renderMarkdown(register) {
  const order = [
    "fixed_and_verified",
    "partially_remediated",
    "corrected_outdated_snapshot",
    "governance_or_future_version_gated",
    "documented_accepted_or_monitored",
    "open_actionable",
  ];
  const labels = {
    fixed_and_verified: "Fixed and verified",
    partially_remediated: "Partially remediated",
    corrected_outdated_snapshot: "Corrected outdated snapshot",
    governance_or_future_version_gated: "Governance or future-version gated",
    documented_accepted_or_monitored: "Accepted or monitored",
    open_actionable: "Open actionable",
  };
  const lines = [
    "# July 2026 Community Audit Remediation Register",
    "",
    `**Updated:** ${register.updatedAt}`,
    `**Repository baseline:** \`${register.baseline}\``,
    "",
    "This register shows the current status of every normalized finding in the community",
    "audit submitted on 27 July 2026. The original report remains unchanged and preserves",
    "the severity and project snapshot recorded on that date. A red or high-severity label",
    "in the original report is therefore historical severity, not proof that the issue is",
    "still open today. Current status is authoritative only in this evidence-backed register.",
    "",
    `- [Original unchanged report](${register.originalAudit.path})`,
    `- Original SHA-256: \`${register.originalAudit.sha256}\``,
    "- [Audit index](README.md)",
    "- [Current CWA-01...CWA-82 register](CWA_REMEDIATION_REGISTER.md)",
    "",
    "## Status Summary",
    "",
    "| Status | Count | Meaning |",
    "| --- | ---: | --- |",
    ...order.map((key) => `| ${labels[key]} | ${register.expectedStatusTotals[key]} | ${escapeCell(register.statusDefinitions[key])} |`),
    "",
    "## Finding-by-Finding Status",
    "",
    "| Finding | Severity at audit | Current status | Current assessment | Remaining action | Verification | Evidence |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...register.findings.map((finding) => {
      const evidence = finding.evidence
        .map((item) => `[${escapeCell(item.path)}](../../${item.path})`)
        .join("; ");
      return `| **${finding.id}** ${escapeCell(finding.title)} (section ${escapeCell(finding.sourceSection)}) | ${finding.severity} | **${labels[finding.status]}** | ${escapeCell(finding.currentAssessment)} | ${escapeCell(finding.remainingAction)} | ${escapeCell(finding.verification)} | ${evidence} |`;
    }),
    "",
    "## Maintenance Rule",
    "",
    "A status may change only with a concrete integrated change or governance record and",
    "the verification named above. Update the JSON source, regenerate this page and run",
    "`npm run test:july-audit-register`. Never rewrite the original audit to make an old",
    "finding disappear; preserve its hash and update this register instead.",
  ];
  return `${lines.join("\n")}\n`;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
