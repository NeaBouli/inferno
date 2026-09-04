#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  compareBaseline,
  createBaseline,
  disabledRules,
  expandFingerprint,
  listTrackedMarkdown,
  normalizeIssue,
  parseMarkdownlintResult,
  serializeBaseline,
  summarizeIssues,
} = require("./check-markdownlint-baseline.cjs");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "docs-validator.yml"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const baseline = JSON.parse(fs.readFileSync(path.join(root, "audit", "markdownlint-baseline.json"), "utf8"));

const fixture = (overrides = {}) => ({
  fileName: "docs/example.md",
  ruleNames: ["MD022", "blanks-around-headings"],
  errorDetail: "Expected: 1; Actual: 0; Below",
  errorContext: "## Example",
  lineNumber: 10,
  ...overrides,
});

const sourceLoader = () => "before\ncontext\n## Example\nafter\nend";
assert.deepEqual(
  normalizeIssue(fixture({ lineNumber: 3 }), sourceLoader),
  normalizeIssue(fixture({ lineNumber: 4 }), () => "intro\nbefore\ncontext\n## Example\nafter\nend"),
  "line movement outside the local neighborhood must not change a fingerprint",
);
const summarized = summarizeIssues([fixture({ lineNumber: 3 }), fixture({ lineNumber: 3 })], sourceLoader);
assert.equal(summarized.length, 1);
assert.equal(summarized[0].count, 2);
assert.deepEqual(compareBaseline(summarized, summarized), []);
assert.equal(compareBaseline(summarized, summarizeIssues([fixture({ lineNumber: 3 })], sourceLoader))[0].after, 1);
assert.equal(compareBaseline(summarizeIssues([fixture({ lineNumber: 3 })], sourceLoader), summarized)[0].after, 2);
assert.notEqual(
  normalizeIssue(fixture({ lineNumber: 3 }), sourceLoader).neighborhood,
  normalizeIssue(fixture({ lineNumber: 3 }), () => "different\ncontext\n## Example\nafter\nend").neighborhood,
  "moving an otherwise identical finding to a different neighborhood must change its fingerprint",
);

assert.deepEqual(parseMarkdownlintResult({ status: 0, stdout: "[]", stderr: "" }), []);
assert.equal(parseMarkdownlintResult({ status: 1, stdout: "", stderr: JSON.stringify([fixture()]) }).length, 1);
assert.equal(parseMarkdownlintResult({ status: 1, stdout: JSON.stringify([fixture()]), stderr: "diagnostic" }).length, 1);
assert.throws(() => parseMarkdownlintResult({ status: 1, stdout: "not-json", stderr: "" }), /invalid JSON/);
assert.throws(() => parseMarkdownlintResult({ status: 2, stdout: "", stderr: "usage error" }), /status 2/);

const generated = createBaseline(["README.md"], [fixture({ lineNumber: 3 })], sourceLoader);
assert.equal(generated.schemaVersion, 2);
assert.equal(generated.tool, "markdownlint-cli@0.49.1");
assert.deepEqual(generated.disabledRules, disabledRules);
assert.equal(generated.filesScanned, 1);
assert.equal(generated.baselineIssues, 1);

assert.equal(packageJson.devDependencies["markdownlint-cli"], "0.49.1");
assert.equal(baseline.schemaVersion, 2);
assert.equal(baseline.tool, "markdownlint-cli@0.49.1");
assert.deepEqual(baseline.disabledRules, disabledRules);
assert.ok(baseline.filesScanned > 0);
assert.ok(baseline.baselineIssues > 0, "historical findings must be represented honestly");
assert.ok(baseline.fingerprints.length > 0);
assert.equal(baseline.fingerprints.reduce((total, item) => total + expandFingerprint(item).count, 0), baseline.baselineIssues);
assert.ok(baseline.fingerprints.every((item) => /^[a-f0-9]{16}$/.test(expandFingerprint(item).neighborhood)));
const serialized = serializeBaseline(generated);
assert.equal(serialized.split("\n").length, generated.fingerprints.length + 10);
assert.deepEqual(expandFingerprint(JSON.parse(serialized).fingerprints[0]), generated.fingerprints[0]);

const trackedMarkdown = listTrackedMarkdown();
assert.equal(trackedMarkdown.length, baseline.filesScanned);
assert.ok(trackedMarkdown.every((file) => file.endsWith(".md") && !file.includes("node_modules")));

for (const marker of [
  "runs-on: ubuntu-24.04",
  "node-version: '22.22.0'",
  "run: npm ci --ignore-scripts",
  "run: npm run test:markdownlint-baseline",
  "run: npm run check:markdownlint",
  "- '**/*.md'",
  "- 'audit/markdownlint-baseline.json'",
  "- 'scripts/check-markdownlint-baseline.cjs'",
  "- 'scripts/test-markdownlint-baseline.cjs'",
]) assert.ok(workflow.includes(marker), `Docs Validator must include ${marker}`);
assert.equal(workflow.includes("npm install -g markdownlint-cli"), false);
assert.equal(workflow.includes("markdownlint '**/*.md'"), false);
for (const marker of [
  "- '**/*.md'",
  "- 'audit/markdownlint-baseline.json'",
  "- 'scripts/check-markdownlint-baseline.cjs'",
  "- 'scripts/test-markdownlint-baseline.cjs'",
]) assert.equal(workflow.split(marker).length - 1, 2, `${marker} must be present in push and pull_request paths`);

console.log("[markdownlint-baseline-test] PASS");
