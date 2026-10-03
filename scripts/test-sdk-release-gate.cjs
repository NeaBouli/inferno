// Tests for scripts/sdk-release-gate.cjs: every unsafe release state must fail before npm publish.
"use strict";
const assert = require("node:assert/strict");
const { runGate, REQUIRED_CHECKS } = require("./sdk-release-gate.cjs");

const SHA = "a".repeat(40);
const base = { repo: "NeaBouli/inferno", tag: "sdk-v0.2.0", sha: SHA, packageVersion: "0.2.0", token: "t" };
const greenRuns = { check_runs: REQUIRED_CHECKS.map((name) => ({ name, status: "completed", conclusion: "success" })) };
const goodEnv = {
  protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", reviewer: { login: "owner" } }] }],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
};
const goodPolicies = { branch_policies: [{ name: "sdk-v*", type: "tag" }] };

function fake(overrides = {}) {
  const routes = {
    compare: { status: 200, body: { status: "identical" } },
    runs: { status: 200, body: greenRuns },
    env: { status: 200, body: goodEnv },
    policies: { status: 200, body: goodPolicies },
    ...overrides,
  };
  return async (url) => {
    const key = url.includes("/compare/") ? "compare" : url.includes("/check-runs") ? "runs"
      : url.includes("/deployment-branch-policies") ? "policies" : url.includes("/environments/") ? "env" : null;
    const route = routes[key];
    return { ok: route.status >= 200 && route.status < 300, status: route.status, json: async () => route.body };
  };
}

(async () => {
  // A reviewed main commit with the configured gate may proceed.
  assert.deepEqual(await runGate({ ...base, fetchImpl: fake() }), { ok: true, failures: [] });
  assert.equal((await runGate({ ...base, fetchImpl: fake({ compare: { status: 200, body: { status: "behind" } } }) })).ok, true);

  const failsWith = async (overrides, pattern, input = {}) => {
    const result = await runGate({ ...base, ...input, fetchImpl: fake(overrides) });
    assert.equal(result.ok, false, `expected failure: ${pattern}`);
    assert.ok(result.failures.some((f) => pattern.test(f)), `${pattern} not in ${JSON.stringify(result.failures)}`);
  };
  // Missing environment (404) and unprotected environments fail.
  await failsWith({ env: { status: 404, body: {} } }, /not configured/);
  await failsWith({ env: { status: 200, body: { ...goodEnv, protection_rules: [] } } }, /no required reviewer/);
  await failsWith({ env: { status: 200, body: { ...goodEnv, protection_rules: [{ type: "required_reviewers", reviewers: [] }] } } }, /no required reviewer/);
  await failsWith({ env: { status: 200, body: { ...goodEnv, deployment_branch_policy: null } } }, /restrict deployments/);
  await failsWith({ policies: { status: 200, body: { branch_policies: [{ name: "*", type: "branch" }] } } }, /exactly tag/);
  await failsWith({ policies: { status: 200, body: { branch_policies: [] } } }, /exactly tag/);
  // A matching-version tag on an unreviewed branch commit fails.
  await failsWith({ compare: { status: 200, body: { status: "ahead" } } }, /not on main/);
  await failsWith({ compare: { status: 200, body: { status: "diverged" } } }, /not on main/);
  // Required checks missing or not green on the exact commit fail.
  await failsWith({ runs: { status: 200, body: { check_runs: greenRuns.check_runs.slice(1) } } }, /has no run/);
  await failsWith({ runs: { status: 200, body: { check_runs: [...greenRuns.check_runs, { name: REQUIRED_CHECKS[0], status: "completed", conclusion: "failure" }] } } }, /did not succeed/);
  await failsWith({ runs: { status: 200, body: { check_runs: greenRuns.check_runs.map((r, i) => (i ? r : { ...r, status: "in_progress", conclusion: null })) } } }, /did not succeed/);
  // Tag/version mismatch fails.
  await failsWith({}, /does not match/, { tag: "sdk-v0.2.1" });
  // API errors and malformed data throw (the CLI exits non-zero).
  await assert.rejects(runGate({ ...base, fetchImpl: fake({ compare: { status: 500, body: {} } }) }), /HTTP 500/);
  await assert.rejects(runGate({ ...base, fetchImpl: fake({ runs: { status: 200, body: {} } }) }), /malformed/);
  await assert.rejects(runGate({ ...base, sha: "main", fetchImpl: fake() }), /sha missing/);
  console.log("[sdk-release-gate] PASS - 15 unsafe states fail closed, reviewed main commit passes");
})().catch((error) => { console.error(error); process.exit(1); });
