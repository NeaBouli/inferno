#!/usr/bin/env node

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const baselinePath = path.join(root, "audit", "markdownlint-baseline.json");
const markdownlintBin = path.join(root, "node_modules", ".bin", "markdownlint");
const disabledRules = ["MD013", "MD033", "MD041", "MD024", "MD036", "MD040"];
const expectedToolVersion = "0.49.1";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function listTrackedMarkdown() {
  const result = run("git", ["ls-files", "-z", "--", "*.md"]);
  if (result.status !== 0) throw new Error(`Unable to list tracked Markdown files: ${result.stderr.trim()}`);
  return result.stdout.split("\0").filter(Boolean).sort();
}

function defaultSourceLoader(fileName) {
  return fs.readFileSync(path.join(root, fileName), "utf8");
}

function neighborhoodHash(issue, sourceLoader = defaultSourceLoader) {
  const lines = sourceLoader(issue.fileName).split(/\r?\n/);
  const lineIndex = Math.max(0, Number(issue.lineNumber || 1) - 1);
  const neighborhood = lines
    .slice(Math.max(0, lineIndex - 2), Math.min(lines.length, lineIndex + 3))
    .map((line) => line.trimEnd())
    .join("\n");
  return crypto.createHash("sha256").update(neighborhood).digest("hex").slice(0, 16);
}

function normalizeIssue(issue, sourceLoader = defaultSourceLoader) {
  return {
    file: issue.fileName.split(path.sep).join("/"),
    rule: issue.ruleNames?.[0] || "UNKNOWN",
    detail: issue.errorDetail || "",
    context: issue.errorContext || "",
    neighborhood: neighborhoodHash(issue, sourceLoader),
  };
}

function issueKey(issue) {
  if (Array.isArray(issue)) issue = expandFingerprint(issue);
  return JSON.stringify([issue.file, issue.rule, issue.detail, issue.context, issue.neighborhood]);
}

function expandFingerprint(entry) {
  if (!Array.isArray(entry)) return entry;
  return {
    file: entry[0],
    rule: entry[1],
    detail: entry[2],
    context: entry[3],
    neighborhood: entry[4],
    count: entry[5],
  };
}

function summarizeIssues(issues, sourceLoader = defaultSourceLoader) {
  const byKey = new Map();
  for (const rawIssue of issues) {
    const issue = normalizeIssue(rawIssue, sourceLoader);
    const key = issueKey(issue);
    const current = byKey.get(key);
    if (current) current.count += 1;
    else byKey.set(key, { ...issue, count: 1 });
  }
  return [...byKey.values()].sort((left, right) => issueKey(left).localeCompare(issueKey(right)));
}

function compareBaseline(expected, actual) {
  const expectedMap = new Map(expected.map((entry) => [issueKey(entry), expandFingerprint(entry).count]));
  const actualMap = new Map(actual.map((entry) => [issueKey(entry), expandFingerprint(entry).count]));
  const changes = [];
  for (const key of new Set([...expectedMap.keys(), ...actualMap.keys()])) {
    const before = expectedMap.get(key) || 0;
    const after = actualMap.get(key) || 0;
    if (before !== after) changes.push({ issue: JSON.parse(key), before, after });
  }
  return changes.sort((left, right) => JSON.stringify(left.issue).localeCompare(JSON.stringify(right.issue)));
}

function parseMarkdownlintResult(result) {
  if (![0, 1].includes(result.status)) {
    throw new Error(`markdownlint failed with status ${result.status}: ${(result.stderr || "").trim()}`);
  }
  try {
    return JSON.parse(result.stdout || result.stderr || "[]");
  } catch (error) {
    throw new Error(`markdownlint returned invalid JSON: ${error.message}`);
  }
}

function readIssues(files) {
  return parseMarkdownlintResult(run(markdownlintBin, [
    "--json",
    "--disable", ...disabledRules,
    "--",
    ...files,
  ]));
}

function assertToolVersion() {
  if (!fs.existsSync(markdownlintBin)) throw new Error("Pinned markdownlint binary is missing; run npm ci");
  const result = run(markdownlintBin, ["--version"]);
  if (result.status !== 0 || result.stdout.trim() !== expectedToolVersion) {
    throw new Error(`markdownlint ${expectedToolVersion} required, received ${result.stdout.trim() || result.stderr.trim()}`);
  }
}

function createBaseline(files, issues, sourceLoader = defaultSourceLoader) {
  return {
    schemaVersion: 2,
    tool: `markdownlint-cli@${expectedToolVersion}`,
    disabledRules,
    filesScanned: files.length,
    baselineIssues: issues.length,
    fingerprints: summarizeIssues(issues, sourceLoader),
  };
}

function serializeBaseline(baseline) {
  const header = [
    "{",
    `  \"schemaVersion\": ${baseline.schemaVersion},`,
    `  \"tool\": ${JSON.stringify(baseline.tool)},`,
    `  \"disabledRules\": ${JSON.stringify(baseline.disabledRules)},`,
    `  \"filesScanned\": ${baseline.filesScanned},`,
    `  \"baselineIssues\": ${baseline.baselineIssues},`,
    "  \"fingerprints\": [",
  ];
  const rows = baseline.fingerprints.map((entry, index) => {
    const compact = [entry.file, entry.rule, entry.detail, entry.context, entry.neighborhood, entry.count];
    return `    ${JSON.stringify(compact)}${index + 1 === baseline.fingerprints.length ? "" : ","}`;
  });
  return `${[...header, ...rows, "  ]", "}"].join("\n")}\n`;
}

function main() {
  assertToolVersion();
  const files = listTrackedMarkdown();
  const issues = readIssues(files);
  const current = createBaseline(files, issues);
  if (process.argv.includes("--write-baseline")) {
    fs.writeFileSync(baselinePath, serializeBaseline(current));
    console.log(`[markdownlint] wrote ${issues.length} issues in ${files.length} tracked files to audit/markdownlint-baseline.json`);
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  if (baseline.schemaVersion !== 2 || baseline.tool !== current.tool) {
    throw new Error("Markdown baseline schema or pinned tool version does not match the runner");
  }
  if (JSON.stringify(baseline.disabledRules) !== JSON.stringify(disabledRules)) {
    throw new Error("Markdown baseline disabled-rule policy does not match the runner");
  }
  const changes = compareBaseline(baseline.fingerprints, current.fingerprints);
  if (baseline.filesScanned !== current.filesScanned) {
    changes.unshift({ issue: ["tracked-files", "COUNT", "", ""], before: baseline.filesScanned, after: current.filesScanned });
  }
  if (changes.length) {
    for (const change of changes.slice(0, 25)) {
      console.error(`[markdownlint] baseline mismatch ${change.issue[0]} ${change.issue[1]}: ${change.before} -> ${change.after} ${change.issue[3]}`);
    }
    if (changes.length > 25) console.error(`[markdownlint] ${changes.length - 25} additional mismatch(es) omitted`);
    throw new Error("Markdown findings changed; fix the Markdown or review and regenerate the baseline deliberately");
  }
  console.log(`[markdownlint] PASS - ${issues.length} historical findings unchanged across ${files.length} tracked Markdown files`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[markdownlint] FAIL - ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  compareBaseline,
  createBaseline,
  disabledRules,
  expandFingerprint,
  issueKey,
  listTrackedMarkdown,
  neighborhoodHash,
  normalizeIssue,
  parseMarkdownlintResult,
  serializeBaseline,
  summarizeIssues,
};
