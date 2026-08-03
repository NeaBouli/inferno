#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflowPath = path.join(root, ".github/workflows/docs-validator.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");

for (const watchedPath of [
  "docs/**",
  "apps/ai-copilot/src/context/ifr-knowledge.ts",
  "apps/ai-copilot/src/context/wiki-content.json",
  "scripts/build-wiki-rag.js",
  "scripts/test-content-trust.cjs",
  "scripts/test-status-baseline.cjs",
  "scripts/test-docs-workflow.cjs",
  "tests/browser/**",
  "package.json",
]) {
  assert.ok(
    workflow.includes(`- '${watchedPath}'`),
    `Docs Validator must watch ${watchedPath}`
  );
}

for (const command of [
  "npm run test:docs-ci",
  "npm run test:content-trust",
  "npm run test:status-baseline",
  "npm run test:wiki-rag",
  "npm run test:wiki-heads",
  "npm run test:surface-routing",
  "npm run test:benefits-docs",
  "npm run test:wallet-connect",
  "npm run test:web3-write",
]) {
  assert.ok(
    workflow.includes(`run: ${command}`),
    `Docs Validator must run ${command}`
  );
}

console.log("[docs-workflow-contract] PASS");
