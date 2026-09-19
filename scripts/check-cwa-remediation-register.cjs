#!/usr/bin/env node

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const auditDir = path.join(root, "docs", "community-audits");
const dataPath = path.join(auditDir, "cwa-remediation-register.json");
const markdownPath = path.join(auditDir, "CWA_REMEDIATION_REGISTER.md");
const writeMode = process.argv.includes("--write");

const register = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const dispositions = new Set(Object.keys(register.statusDefinitions));
const severities = new Set(["Critical", "High", "Medium", "Low", "Informational"]);

assert.equal(register.schemaVersion, 1, "unsupported CWA register schema");
assert.equal(register.findings.length, 82, "CWA register must contain exactly 82 findings");

const dispositionTotals = Object.fromEntries([...dispositions].map((key) => [key, 0]));
const severityTotals = Object.fromEntries([...severities].map((key) => [key, 0]));

for (const [index, finding] of register.findings.entries()) {
  const expectedId = `CWA-${String(index + 1).padStart(2, "0")}`;
  assert.equal(finding.id, expectedId, `finding ${index + 1} must be ${expectedId}`);
  assert.ok(severities.has(finding.severity), `${finding.id} has invalid severity`);
  assert.ok(dispositions.has(finding.disposition), `${finding.id} has invalid disposition`);
  for (const field of ["title", "owner", "nextAction", "verification", "source"]) {
    assert.equal(typeof finding[field], "string", `${finding.id}.${field} must be a string`);
    assert.ok(finding[field].trim(), `${finding.id}.${field} must not be empty`);
  }
  assert.ok(
    fs.existsSync(path.join(auditDir, finding.source)),
    `${finding.id} source does not exist: ${finding.source}`
  );
  const sourceContent = fs.readFileSync(path.join(auditDir, finding.source), "utf8");
  const headingPattern = new RegExp(
    `(?:^#### |^- \\*\\*)\\[${finding.id}\\]`,
    "m"
  );
  const heading = headingPattern.exec(sourceContent);
  assert.ok(
    heading,
    `${finding.id} finding heading is not present in its declared source report`
  );
  const findingSection = sourceContent.slice(heading.index, heading.index + 1600);
  const inlineSeverity = findingSection.match(
    /\*\*Severity:\*\*\s*(Critical|High|Medium|Low|Informational)/
  );
  const precedingSeverityHeadings = [
    ...sourceContent.slice(0, heading.index).matchAll(
      /^### (Critical|High|Medium|Low|Informational)\s*$/gm
    ),
  ];
  const reportedSeverity =
    inlineSeverity?.[1] || precedingSeverityHeadings.at(-1)?.[1];
  assert.equal(
    finding.severity,
    reportedSeverity,
    `${finding.id} severity differs from ${finding.source}`
  );
  dispositionTotals[finding.disposition] += 1;
  severityTotals[finding.severity] += 1;
}

assert.deepEqual(dispositionTotals, register.expectedDispositionTotals);
assert.deepEqual(severityTotals, register.expectedSeverityTotals);
assert.equal(dispositionTotals.fixed_and_verified, 0, "no CWA finding is fixed and verified yet");

const pdf = register.artifacts.consolidatedPdf;
const pdfPath = path.join(auditDir, pdf.path);
assert.ok(fs.existsSync(pdfPath), `missing consolidated PDF: ${pdf.path}`);
const pdfHash = crypto.createHash("sha256").update(fs.readFileSync(pdfPath)).digest("hex");
assert.equal(pdfHash, pdf.sha256, "consolidated PDF hash changed without register update");

const auditIndex = fs.readFileSync(path.join(auditDir, "README.md"), "utf8");
for (const report of Object.values(register.artifacts.sourceReports)) {
  const reportPath = path.join(auditDir, report.path);
  assert.ok(fs.existsSync(reportPath), `missing CWA source report: ${report.path}`);
  const reportHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(reportPath))
    .digest("hex");
  assert.equal(reportHash, report.sha256, `${report.path} hash changed without register update`);

  const reportLink = `[${report.path}](${report.path})`;
  const sectionStart = auditIndex.indexOf(reportLink);
  assert.notEqual(sectionStart, -1, `audit index missing source report link: ${report.path}`);
  const nextSection = auditIndex.indexOf("\n## ", sectionStart);
  const reportSection = auditIndex.slice(
    sectionStart,
    nextSection === -1 ? auditIndex.length : nextSection
  );
  assert.ok(
    reportSection.includes(report.sha256),
    `audit index current hash differs for ${report.path}`
  );
}

const markdown = renderMarkdown(register);
if (writeMode) {
  fs.writeFileSync(markdownPath, markdown);
  console.log(`[cwa-register] wrote ${path.relative(root, markdownPath)}`);
} else {
  assert.ok(fs.existsSync(markdownPath), "missing generated CWA remediation Markdown");
  assert.equal(
    fs.readFileSync(markdownPath, "utf8"),
    markdown,
    "CWA remediation Markdown is stale; run npm run build:cwa-register"
  );
}

const publicLinks = [
  "README.md",
  "docs/community-audits/README.md",
  "docs/wiki/open-audit.html",
  "docs/wiki/security.html",
  "docs/CURRENT_FUNCTIONALITY_STATUS.md",
  "docs/llms.txt",
  "apps/ai-copilot/src/context/ifr-knowledge.ts",
];
for (const relative of publicLinks) {
  const content = fs.readFileSync(path.join(root, relative), "utf8");
  assert.ok(
    content.includes("CWA_REMEDIATION_REGISTER"),
    `${relative} must link to the authoritative CWA remediation register`
  );
}

for (const relative of [
  "README.md",
  "docs/community-audits/README.md",
  "docs/wiki/open-audit.html",
  "docs/wiki/security.html",
]) {
  const content = fs.readFileSync(path.join(root, relative), "utf8");
  assert.ok(content.includes(pdf.path), `${relative} must link to the consolidated CWA PDF`);
}

const functionality = fs.readFileSync(
  path.join(root, "docs", "CURRENT_FUNCTIONALITY_STATUS.md"),
  "utf8"
);
for (const value of Object.values(register.canonicalTests)) {
  assert.ok(functionality.includes(value), `functionality status missing canonical result ${value}`);
}

const deepAudit = fs.readFileSync(
  path.join(auditDir, "CWA_IFR_Contracts_Deep_Audit_2026-09-14.md"),
  "utf8"
);
assert.ok(deepAudit.includes("1 Medium · 1 Low · 1 Informational"));
assert.ok(deepAudit.includes("Editorial correction — 2026-09-19"));

const contentAudit = fs.readFileSync(
  path.join(auditDir, "CWA_IFR_Content_Coherence_Audit_2026-09-14.md"),
  "utf8"
);
assert.ok(contentAudit.includes("10 Medium · 7 Low · 1 Informational"));
assert.ok(contentAudit.includes("Editorial correction — 2026-09-19"));

const currentCountMarkers = {
  "README.md": ["contracts **644/644**", "Generator Engine **30/30**", "IFR SDK **36/36**"],
  "docs/index.html": ['<div class="stat-value">644</div>'],
  "docs/llms.txt": ["contracts 644/644", "Generator Engine 30/30", "IFR SDK 36/36"],
  "apps/ai-copilot/server/index.ts": ["644 contract tests", "30 Generator Engine", "36 SDK"],
  "apps/ai-copilot/src/context/ifr-knowledge.ts": ["contracts 644/644", "30/30 Generator Engine tests passing"],
};
for (const [relative, markers] of Object.entries(currentCountMarkers)) {
  const content = fs.readFileSync(path.join(root, relative), "utf8");
  for (const marker of markers) {
    assert.ok(content.includes(marker), `${relative} missing current test marker: ${marker}`);
  }
}
assert.ok(
  !fs.readFileSync(path.join(root, "apps/ai-copilot/server/index.ts"), "utf8").includes(
    "544 documented tests"
  ),
  "Copilot welcome must not present 544 as the current test count"
);

console.log(
  `[cwa-register] PASS - ${register.findings.length} findings; dispositions ${JSON.stringify(dispositionTotals)}; severities ${JSON.stringify(severityTotals)}`
);

function renderMarkdown(data) {
  const statusOrder = [
    "fixed_and_verified",
    "governance_or_owner_gated",
    "documented_accepted_or_monitored",
    "open_actionable",
    "informational_no_action",
  ];
  const statusLabels = {
    fixed_and_verified: "Fixed and verified",
    governance_or_owner_gated: "Governance or owner gated",
    documented_accepted_or_monitored: "Accepted or monitored",
    open_actionable: "Open actionable",
    informational_no_action: "Informational, no action",
  };
  const lines = [
    "# CWA-01...CWA-82 Remediation Register",
    "",
    `**Updated:** ${data.updatedAt}`,
    `**Repository baseline:** \`${data.baseline}\``,
    "",
    "This is the authoritative public status register for the seven Collateral Web3 Open",
    "Audits reports. Publishing a finding does not mean it has been remediated. A finding",
    "moves to **Fixed and verified** only after its change is integrated and the required",
    "verification evidence passes. At this baseline, no finding meets that standard.",
    "",
    "## Status Summary",
    "",
    "| Disposition | Count | Meaning |",
    "| --- | ---: | --- |",
    ...statusOrder.map(
      (key) =>
        `| ${statusLabels[key]} | ${data.expectedDispositionTotals[key]} | ${escapeCell(data.statusDefinitions[key])} |`
    ),
    "",
    "| Severity | Count |",
    "| --- | ---: |",
    ...["Critical", "High", "Medium", "Low", "Informational"].map(
      (key) => `| ${key} | ${data.expectedSeverityTotals[key]} |`
    ),
    "",
    "The corrected aggregate is **0 Critical / 3 High / 29 Medium / 34 Low / 16 Informational**.",
    "The consolidated PDF contains an explicit editorial note explaining the correction to",
    "the original summary arithmetic; no individual finding text or severity label changed.",
    "",
    "- [Download the consolidated CWA report (PDF)](IFR_Protocol_CWA_Consolidated_Audit_Report_2026-09-14.pdf)",
    `- PDF SHA-256: \`${data.artifacts.consolidatedPdf.sha256}\``,
    `- Corrected contract deep-audit SHA-256: \`${data.artifacts.sourceReports.contractDeepAudit.sha256}\``,
    `- Corrected content-coherence-audit SHA-256: \`${data.artifacts.sourceReports.contentCoherenceAudit.sha256}\``,
    "- [Audit series index](README.md)",
    "- [Current functionality and test evidence](../CURRENT_FUNCTIONALITY_STATUS.md)",
    "",
    "## Canonical Test Evidence",
    "",
    "These are the current repository evidence counts referenced by the status surfaces. They",
    "do not convert an open audit finding into a verified fix.",
    "",
    "| Suite | Current evidence |",
    "| --- | ---: |",
    `| Smart contracts | ${data.canonicalTests.contracts} |`,
    `| Generator Engine | ${data.canonicalTests.generator} |`,
    `| IFR SDK | ${data.canonicalTests.sdk} |`,
    `| Landing/Wiki browser | ${data.canonicalTests.landingWikiBrowser} |`,
    `| Web3 browser | ${data.canonicalTests.web3Browser} |`,
    `| Benefits physical device/wallet matrix | ${data.canonicalTests.benefitsPhysicalDevices} |`,
    "",
    "## Finding-by-Finding Status",
    "",
    "| Finding | Severity | Disposition | Owner / gate | Next action | Verification required | Source |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...data.findings.map(
      (finding) =>
        `| **${finding.id}** ${escapeCell(finding.title)} | ${finding.severity} | ${statusLabels[finding.disposition]} | ${escapeCell(finding.owner)} | ${escapeCell(finding.nextAction)} | ${escapeCell(finding.verification)} | [Report](${finding.source}) |`
    ),
    "",
    "## Change Rule",
    "",
    "Every status change must update the JSON source, regenerate this file, identify the exact",
    "remediation commit or governance evidence, and pass `npm run test:cwa-register`. Historical",
    "audit reports remain dated evidence; editorial corrections are disclosed with old and new",
    "hashes in the audit index.",
  ];
  return `${lines.join("\n")}\n`;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
