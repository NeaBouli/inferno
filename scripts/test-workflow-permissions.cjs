#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflowsDirectory = path.join(root, ".github", "workflows");
const expectedWriteWorkflows = new Set(["post-deploy.yml", "update-stats.yml"]);
const expectedWorkflowFiles = [
  "ai-copilot.yml",
  "benefits-network.yml",
  "benefits-wallet-prototype.yml",
  "contracts.yml",
  "creator-gateway.yml",
  "dashboard.yml",
  "docs-validator.yml",
  "governance-dashboard.yml",
  "mythril-analysis.yml",
  "points-backend.yml",
  "post-deploy.yml",
  "sdk-ci.yml",
  "security-audit.yml",
  "telegram-bot.yml",
  "update-stats.yml",
  "vault-invariant-monitor.yml",
];

function topLevelPermissions(source, fileName) {
  const header = source.split(/^jobs:/m)[0];
  const match = header.match(/^permissions:[ \t]*\n((?: {2}[a-z-]+:[ \t]*[a-z]+[ \t]*\n?)+)/m);
  assert.ok(match, `${fileName} must declare top-level GITHUB_TOKEN permissions`);
  return Object.fromEntries(match[1].trim().split("\n").map((line) => {
    const permission = line.trim().match(/^([a-z-]+):\s*([a-z]+)$/);
    assert.ok(permission, `${fileName} has an invalid permission line: ${line}`);
    return [permission[1], permission[2]];
  }));
}

function assertNoJobLevelPermissions(source, fileName) {
  const jobs = source.match(/^jobs:[\s\S]*$/m)?.[0] || "";
  assert.doesNotMatch(
    jobs,
    /^\s+permissions:/m,
    `${fileName} must not override permissions at job level`,
  );
}

const workflowFiles = fs.readdirSync(workflowsDirectory)
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();
assert.deepEqual(
  workflowFiles,
  expectedWorkflowFiles,
  "workflow inventory changed; review token permissions and update the deliberate inventory",
);

for (const fileName of workflowFiles) {
  const source = fs.readFileSync(path.join(workflowsDirectory, fileName), "utf8");
  assertNoJobLevelPermissions(source, fileName);
  const permissions = topLevelPermissions(source, fileName);
  assert.equal(permissions.contents, expectedWriteWorkflows.has(fileName) ? "write" : "read", `${fileName} contents permission`);
  const allowedKeys = fileName === "security-audit.yml" ? ["contents", "pull-requests"] : ["contents"];
  assert.deepEqual(Object.keys(permissions).sort(), allowedKeys.sort(), `${fileName} must not receive unrelated token scopes`);
  if (fileName === "security-audit.yml") assert.equal(permissions["pull-requests"], "read");
}

assert.throws(
  () => assertNoJobLevelPermissions("permissions:\n  contents: read\njobs:\n  test:\n    permissions:\n      contents: write\n", "fixture.yml"),
  /must not override permissions at job level/,
);

const securityWorkflow = fs.readFileSync(path.join(workflowsDirectory, "security-audit.yml"), "utf8");
assert.ok(securityWorkflow.includes("run: npm run test:workflow-permissions"));

console.log(`[workflow-permissions] PASS (${workflowFiles.length} workflows)`);
