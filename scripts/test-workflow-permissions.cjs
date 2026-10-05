#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflowsDirectory = path.join(root, ".github", "workflows");
// update-stats.yml / post-deploy.yml were removed (T-212b-11): they would have written Sepolia figures
// into Mainnet pages and pushed to protected main. No workflow needs contents: write.
const expectedWriteWorkflows = new Set([]);
// Railway release gate reads workflow runs for the exact SHA (scripts/railway-release-preflight.cjs).
// sdk-publish.yml reads check runs and the npm-release environment for its fail-closed release gate.
const expectedExtraReadScopes = {
  "security-audit.yml": ["pull-requests"],
  "railway-copilot-release.yml": ["actions"],
  "sdk-publish.yml": ["checks", "actions"],
};
// npm provenance needs an OIDC token. Only the protected publish job of sdk-publish.yml (environment
// npm-release) may request it; this exact job-level block is the single allowed job permission override.
const sdkPublishJobPermissions = "  publish:\n    needs: gate\n    runs-on: ubuntu-latest\n    environment: npm-release\n"
  + "    permissions:\n      contents: read\n      id-token: write\n";
const expectedWorkflowFiles = [
  "ai-copilot.yml",
  "benefits-network.yml",
  "benefits-verify-ci.yml",
  "benefits-verify-live.yml",
  "benefits-wallet-prototype.yml",
  "contracts.yml",
  "creator-gateway.yml",
  "dashboard.yml",
  "docs-validator.yml",
  "governance-dashboard.yml",
  "mythril-analysis.yml",
  "points-backend.yml",
  "railway-copilot-release.yml",
  "sdk-ci.yml",
  "sdk-publish.yml",
  "security-audit.yml",
  "telegram-bot.yml",
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

// Fail-closed publication boundary for sdk-publish.yml: manual dispatch only (no tag/push trigger whose
// workflow code would come from an unreviewed ref), OIDC only in the protected npm-release publish job,
// the gate before that job, no registry token anywhere.
function assertSdkPublishBoundary(source) {
  assert.equal(source.split(sdkPublishJobPermissions).length, 2, "sdk-publish.yml publish job must be the npm-release job with exactly contents: read, id-token: write");
  const rest = source.replace(sdkPublishJobPermissions, "  publish:\n");
  assertNoJobLevelPermissions(rest, "sdk-publish.yml");
  assert.doesNotMatch(rest, /id-token/, "sdk-publish.yml: only the npm-release publish job may request an OIDC token");
  const trigger = source.match(/^on:\n([\s\S]*?)\n(?=\S)/m);
  assert.ok(trigger, "sdk-publish.yml must declare its trigger");
  assert.deepEqual(trigger[1].match(/^  [a-z_]+:/gm), ["  workflow_dispatch:"], "sdk-publish.yml must be triggered by workflow_dispatch only");
  assert.doesNotMatch(source, /^\s+(?:tags|branches|push|pull_request\w*|workflow_run|schedule):/m, "sdk-publish.yml must not run on tags, pushes or other events");
  assert.match(source, /node scripts\/sdk-release-gate\.cjs/, "sdk-publish.yml must run the release gate");
  assert.match(source, /SDK_RELEASE_VERSION: \$\{\{ inputs\.version \}\}/, "the version input must reach the gate through env, not shell interpolation");
  assert.doesNotMatch(source, /NPM_TOKEN|NODE_AUTH_TOKEN/, "sdk-publish.yml must use Trusted Publishing, not a registry token");
}

// Workflows must never receive a signing key from repository secrets.
const privateKeySecretPattern = /secrets(?:\.[A-Za-z0-9_]*PRIVATE_?KEY|\s*\[\s*['"][^'"]*PRIVATE_?KEY['"]\s*\])/i;

function assertNoPrivateKeySecret(source, fileName) {
  assert.doesNotMatch(
    source,
    privateKeySecretPattern,
    `${fileName} must not reference a private-key repository secret`,
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
  if (fileName === "sdk-publish.yml") assertSdkPublishBoundary(source);
  else {
    assertNoJobLevelPermissions(source, fileName);
    assert.doesNotMatch(source, /id-token/, `${fileName} must not request an OIDC token`);
  }
  assertNoPrivateKeySecret(source, fileName);
  const permissions = topLevelPermissions(source, fileName);
  assert.equal(permissions.contents, expectedWriteWorkflows.has(fileName) ? "write" : "read", `${fileName} contents permission`);
  const allowedKeys = ["contents", ...(expectedExtraReadScopes[fileName] || [])];
  assert.deepEqual(Object.keys(permissions).sort(), allowedKeys.sort(), `${fileName} must not receive unrelated token scopes`);
  for (const scope of expectedExtraReadScopes[fileName] || []) assert.equal(permissions[scope], "read", `${fileName} ${scope} permission`);
}

assert.throws(
  () => assertNoJobLevelPermissions("permissions:\n  contents: read\njobs:\n  test:\n    permissions:\n      contents: write\n", "fixture.yml"),
  /must not override permissions at job level/,
);

for (const fixture of [
  "env:\n  PRIVATE_KEY: ${{ secrets.DEPLOYER_PRIVATE_KEY }}\n",
  "env:\n  KEY: ${{ secrets.PRIVATE_KEY }}\n",
  "env:\n  KEY: ${{ secrets.signer_privatekey }}\n",
  "env:\n  KEY: ${{ secrets['DEPLOYER_PRIVATE_KEY'] }}\n",
]) {
  assert.throws(() => assertNoPrivateKeySecret(fixture, "fixture.yml"), /private-key repository secret/);
}
assertNoPrivateKeySecret("env:\n  SEPOLIA_RPC_URL: ${{ secrets.SEPOLIA_RPC_URL }}\n", "fixture.yml");

{
  // The reviewed workflow passes; tag triggers, workflow-wide OIDC and an unprotected publish job fail.
  const reviewed = fs.readFileSync(path.join(workflowsDirectory, "sdk-publish.yml"), "utf8");
  assertSdkPublishBoundary(reviewed);
  const dispatch = /^on:\n  workflow_dispatch:\n/m;
  assert.throws(() => assertSdkPublishBoundary(reviewed.replace(dispatch, "on:\n  push:\n    tags:\n      - 'sdk-v*'\n  workflow_dispatch:\n")), /workflow_dispatch only/);
  assert.throws(() => assertSdkPublishBoundary(reviewed.replace(dispatch, "on:\n  workflow_dispatch:\n  push:\n    tags:\n      - 'sdk-v*'\n")), /workflow_dispatch only/);
  assert.throws(() => assertSdkPublishBoundary(reviewed.replace("permissions:\n  contents: read\n", "permissions:\n  contents: read\n  id-token: write\n")), /only the npm-release publish job/);
  assert.throws(() => assertSdkPublishBoundary(reviewed.replace("    environment: npm-release\n", "")), /publish job must be the npm-release job/);
  assert.throws(() => assertSdkPublishBoundary(reviewed.replace("  gate:\n    runs-on: ubuntu-latest\n", "  gate:\n    runs-on: ubuntu-latest\n    permissions:\n      id-token: write\n")), /must not override permissions|only the npm-release/);
  assert.throws(() => assertSdkPublishBoundary(reviewed.replace("node scripts/sdk-release-gate.cjs", "true")), /must run the release gate/);
}

const securityWorkflow = fs.readFileSync(path.join(workflowsDirectory, "security-audit.yml"), "utf8");
assert.ok(securityWorkflow.includes("run: npm run test:workflow-permissions"));

console.log(`[workflow-permissions] PASS (${workflowFiles.length} workflows)`);
