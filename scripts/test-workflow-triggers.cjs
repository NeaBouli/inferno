#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function readWorkflow(name) {
  return fs.readFileSync(path.join(root, ".github/workflows", name), "utf8");
}

function requireMarkers(name, markers) {
  const workflow = readWorkflow(name);
  for (const marker of markers) {
    assert.ok(workflow.includes(marker), `${name} must include ${marker}`);
  }
}

for (const [name, appPath] of [
  ["ai-copilot.yml", "apps/ai-copilot/**"],
  ["creator-gateway.yml", "apps/creator-gateway/**"],
]) {
  requireMarkers(name, [
    "workflow_dispatch:",
    `- '${appPath}'`,
    `- '.github/workflows/${name}'`,
  ]);

  const selfPathCount = readWorkflow(name).split(`- '.github/workflows/${name}'`).length - 1;
  assert.equal(selfPathCount, 2, `${name} must self-trigger on push and pull_request`);
}

for (const name of ["docs-validator.yml", "benefits-network.yml"]) {
  const workflow = readWorkflow(name);
  const lockfileCount = workflow.split("- 'package-lock.json'").length - 1;
  assert.equal(lockfileCount, 2, `${name} must watch package-lock.json on push and pull_request`);
}

requireMarkers("docs-validator.yml", [
  "- 'scripts/test-workflow-triggers.cjs'",
  "- 'internal/operations/TODO.md'",
  "- 'internal/operations/TODO.html'",
  "- 'reports/*.md'",
  "run: npm run test:workflow-triggers",
]);
for (const watchedPath of [
  "internal/operations/TODO.md",
  "internal/operations/TODO.html",
  "reports/*.md",
]) {
  const count = readWorkflow("docs-validator.yml").split(`- '${watchedPath}'`).length - 1;
  assert.equal(count, 2, `docs-validator.yml must watch ${watchedPath} on push and pull_request`);
}

console.log("[workflow-trigger-contract] PASS");
