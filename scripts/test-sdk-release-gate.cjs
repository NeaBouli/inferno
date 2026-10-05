// Tests for scripts/sdk-release-gate.cjs: every unsafe release state must fail before npm publish.
// The trigger/permission shape of sdk-publish.yml (dispatch only, OIDC only in the npm-release job) is
// asserted in scripts/test-workflow-permissions.cjs.
"use strict";
const assert = require("node:assert/strict");
const { runGate, REQUIRED_CHECKS } = require("./sdk-release-gate.cjs");

const SHA = "a".repeat(40);
const base = {
  repo: "NeaBouli/inferno", eventName: "workflow_dispatch", ref: "refs/heads/main", sha: SHA,
  requestedVersion: "0.4.0", packageVersion: "0.4.0", token: "t",
};
const greenRuns = { check_runs: REQUIRED_CHECKS.map((name) => ({ name, status: "completed", conclusion: "success" })) };
const mainRules = [
  { type: "deletion" },
  { type: "non_fast_forward" },
  { type: "pull_request", parameters: { required_approving_review_count: 0 } },
  { type: "required_status_checks", parameters: { required_status_checks: REQUIRED_CHECKS.map((context) => ({ context })) } },
];
const goodEnv = {
  protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", reviewer: { login: "owner" } }] }],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
};
const goodPolicies = { branch_policies: [{ name: "main", type: "branch" }] };
const bootstrapped = { name: "ifr-sdk", versions: { "0.3.0": {} } };

function fake(overrides = {}) {
  const routes = {
    compare: { status: 200, body: { status: "identical" } },
    rules: { status: 200, body: mainRules },
    runs: { status: 200, body: greenRuns },
    env: { status: 200, body: goodEnv },
    policies: { status: 200, body: goodPolicies },
    registry: { status: 200, body: bootstrapped },
    ...overrides,
  };
  return async (url) => {
    const key = url.startsWith("https://registry.npmjs.org/") ? "registry"
      : url.includes("/compare/") ? "compare" : url.includes("/rules/branches/") ? "rules"
        : url.includes("/check-runs") ? "runs" : url.includes("/deployment-branch-policies") ? "policies"
          : url.includes("/environments/") ? "env" : null;
    const route = routes[key];
    return { ok: route.status >= 200 && route.status < 300, status: route.status, json: async () => route.body };
  };
}

let unsafe = 0;
(async () => {
  // A reviewed main commit, dispatched on main, with the configured gate may proceed.
  assert.deepEqual(await runGate({ ...base, fetchImpl: fake() }), { ok: true, failures: [] });
  assert.equal((await runGate({ ...base, fetchImpl: fake({ compare: { status: 200, body: { status: "behind" } } }) })).ok, true);

  const failsWith = async (overrides, pattern, input = {}) => {
    unsafe += 1;
    const result = await runGate({ ...base, ...input, fetchImpl: fake(overrides) });
    assert.equal(result.ok, false, `expected failure: ${pattern}`);
    assert.ok(result.failures.some((f) => pattern.test(f)), `${pattern} not in ${JSON.stringify(result.failures)}`);
  };
  // Tag-only or other triggers and non-main refs cannot publish, even with every other condition met.
  await failsWith({}, /event push cannot publish/, { eventName: "push", ref: "refs/tags/sdk-v0.4.0" });
  await failsWith({}, /ref refs\/tags\/sdk-v0\.4\.0 cannot publish/, { ref: "refs/tags/sdk-v0.4.0" });
  await failsWith({}, /ref refs\/heads\/feature cannot publish/, { ref: "refs/heads/feature" });
  await failsWith({}, /event pull_request_target cannot publish/, { eventName: "pull_request_target" });
  // Missing environment (404) and unprotected environments fail.
  await failsWith({ env: { status: 404, body: {} } }, /not configured/);
  await failsWith({ env: { status: 200, body: { ...goodEnv, protection_rules: [] } } }, /no required reviewer/);
  await failsWith({ env: { status: 200, body: { ...goodEnv, protection_rules: [{ type: "required_reviewers", reviewers: [] }] } } }, /no required reviewer/);
  await failsWith({ env: { status: 200, body: { ...goodEnv, deployment_branch_policy: null } } }, /restrict deployments to branch main/);
  await failsWith({ env: { status: 200, body: { ...goodEnv, deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } } } }, /restrict deployments/);
  await failsWith({ policies: { status: 200, body: { branch_policies: [{ name: "sdk-v*", type: "tag" }] } } }, /exactly branch main/);
  await failsWith({ policies: { status: 200, body: { branch_policies: [{ name: "main", type: "branch" }, { name: "sdk-v*", type: "tag" }] } } }, /exactly branch main/);
  await failsWith({ policies: { status: 200, body: { branch_policies: [] } } }, /exactly branch main/);
  // A commit that is not on main (unreviewed branch) fails.
  await failsWith({ compare: { status: 200, body: { status: "ahead" } } }, /not on main/);
  await failsWith({ compare: { status: 200, body: { status: "diverged" } } }, /not on main/);
  // main must stay protected: PR review, required checks covering the gate list, no force push.
  await failsWith({ rules: { status: 200, body: mainRules.filter((r) => r.type !== "pull_request") } }, /missing the pull_request rule/);
  await failsWith({ rules: { status: 200, body: mainRules.filter((r) => r.type !== "non_fast_forward") } }, /missing the non_fast_forward rule/);
  await failsWith({ rules: { status: 200, body: [] } }, /missing the required_status_checks rule/);
  await failsWith({ rules: { status: 200, body: mainRules.map((r) => (r.type === "required_status_checks" ? { ...r, parameters: { required_status_checks: [] } } : r)) } }, /does not require check/);
  // Required checks missing or not green on the exact commit fail.
  await failsWith({ runs: { status: 200, body: { check_runs: greenRuns.check_runs.slice(1) } } }, /has no run/);
  await failsWith({ runs: { status: 200, body: { check_runs: [...greenRuns.check_runs, { name: REQUIRED_CHECKS[0], status: "completed", conclusion: "failure" }] } } }, /did not succeed/);
  await failsWith({ runs: { status: 200, body: { check_runs: greenRuns.check_runs.map((r, i) => (i ? r : { ...r, status: "in_progress", conclusion: null })) } } }, /did not succeed/);
  // Version input must be x.y.z and equal the package version.
  await failsWith({}, /does not match/, { requestedVersion: "0.4.1" });
  await failsWith({}, /is not x\.y\.z/, { requestedVersion: "0.4.0; rm -rf /" });
  await failsWith({}, /is not x\.y\.z/, { requestedVersion: undefined });
  // Single first-release path: no automated publish before the manual bootstrap, never the same version twice.
  await failsWith({ registry: { status: 404, body: null } }, /manual bootstrap/);
  await failsWith({ registry: { status: 200, body: { name: "ifr-sdk", versions: { "0.4.0": {} } } } }, /already published/);
  // API errors and malformed data throw (the CLI exits non-zero).
  await assert.rejects(runGate({ ...base, fetchImpl: fake({ compare: { status: 500, body: {} } }) }), /HTTP 500/);
  await assert.rejects(runGate({ ...base, fetchImpl: fake({ rules: { status: 200, body: {} } }) }), /rules response malformed/);
  await assert.rejects(runGate({ ...base, fetchImpl: fake({ runs: { status: 200, body: {} } }) }), /malformed/);
  await assert.rejects(runGate({ ...base, fetchImpl: fake({ registry: { status: 503, body: null } }) }), /registry lookup/);
  await assert.rejects(runGate({ ...base, sha: "main", fetchImpl: fake() }), /sha missing/);
  unsafe += 5;
  console.log(`[sdk-release-gate] PASS - ${unsafe} unsafe states fail closed, reviewed main dispatch passes`);
})().catch((error) => { console.error(error); process.exit(1); });
