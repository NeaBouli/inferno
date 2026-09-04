#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "security-audit.yml"),
  "utf8",
);

const actionReferences = workflow.match(/^[ \t]+(?:-[ \t]+)?uses:.*$/gm) || [];
assert.equal(actionReferences.length, 5, "review changes to the Security Audit action inventory");
assert.equal(
  actionReferences.every((line) => /@[0-9a-f]{40}(?:\s|$)/.test(line)),
  true,
  "every third-party action must use a full commit SHA",
);
assert.equal(
  (workflow.match(/^\s+runs-on: ubuntu-24\.04$/gm) || []).length,
  4,
  "all Security Audit jobs must use the reviewed Ubuntu 24.04 runner",
);
assert.equal(workflow.includes("runs-on: ubuntu-latest"), false);

for (const command of [
  "rustup toolchain install 1.88.0 --profile minimal --no-self-update",
  "cargo +1.88.0 install cargo-audit --version 0.22.2 --locked",
  "python -m pip install pip-audit==2.10.1",
  ".slither-venv/bin/pip install slither-analyzer==0.11.5",
  ".slither-venv/bin/solc-select install 0.8.28",
]) {
  assert.ok(workflow.includes(command), `missing pinned command: ${command}`);
}

assert.equal(/cargo(?:\s+\+[^\s]+)?\s+install cargo-audit\s*(?:\n|$)/.test(workflow), false);
assert.equal(/pip install pip-audit\s*(?:\n|$)/.test(workflow), false);
assert.ok(workflow.includes("run: npm run test:security-toolchain-pins"));

console.log("[security-toolchain-pins] PASS");
