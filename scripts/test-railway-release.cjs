#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  REQUIRED_WORKFLOWS,
  assertDispatchRef,
  assertFullSha,
  assertShaIsMain,
  assertRequiredWorkflowsGreen,
} = require("./railway-release-preflight.cjs");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/railway-copilot-release.yml"),
  "utf8"
);
const runbook = fs.readFileSync(path.join(root, "docs/RAILWAY_COPILOT_RELEASE.md"), "utf8");

// --- Workflow contract -------------------------------------------------------

const onBlock = workflow.split(/^on:\n/m)[1].split(/^\S/m)[0];
assert.match(onBlock, /^  workflow_dispatch:/m, "release must be manual (workflow_dispatch)");
for (const trigger of ["push", "pull_request", "pull_request_target", "schedule", "workflow_run", "repository_dispatch"]) {
  assert.doesNotMatch(onBlock, new RegExp(`^  ${trigger}:`, "m"), `release must not trigger on ${trigger}`);
}
assert.match(onBlock, /sha:\n(?: {8}.*\n)*? {8}required: true/, "sha input must be required");
assert.match(onBlock, /default: preflight/, "mode must default to read-only preflight");

const [preflightJob, releaseJob] = workflow.split(/^  release:\n/m);
assert.ok(releaseJob, "release job must exist");
assert.doesNotMatch(preflightJob, /secrets\./, "preflight job must not read any secret");
assert.doesNotMatch(preflightJob, /railway (up|redeploy|deploy)/, "preflight job must not call the provider");
assert.doesNotMatch(preflightJob, /environment:/, "preflight job must not unlock the production environment");
assert.match(preflightJob, /ref: \$\{\{ inputs\.sha \}\}/, "preflight checkout must use the supplied SHA");
assert.match(preflightJob, /run: node scripts\/test-railway-release\.cjs/, "preflight must verify its release contract");
assert.match(preflightJob, /run: node scripts\/railway-release-preflight\.cjs/, "preflight must run the gate");

assert.match(releaseJob, /needs: preflight/, "release must depend on preflight");
assert.match(releaseJob, /if: inputs\.mode == 'release'/, "release must only run in release mode");
assert.match(releaseJob, /^    environment: production$/m, "release must require production environment approval");
assert.match(releaseJob, /ref: \$\{\{ inputs\.sha \}\}/, "checkout must be pinned to the supplied SHA");
assert.match(releaseJob, /test "\$\(git rev-parse HEAD\)" = "\$RELEASE_SHA"/, "checkout SHA must be asserted");

const steps = releaseJob.split(/^      - /m);
const stepIndex = (needle) => steps.findIndex((s) => s.includes(needle));
const reverify = stepIndex("run: node scripts/railway-release-preflight.cjs");
const guard = stepIndex("RAILWAY_TOKEN missing");
const deploy = stepIndex("railway up");
assert.ok(reverify > 0 && guard > reverify && deploy > guard, "gate and secret guard must precede provider command");
assert.equal(
  [...releaseJob.matchAll(/\brailway (up|redeploy|rollback|down|deploy|service|variables|link|environment)\b/g)].length,
  1,
  "exactly one provider command"
);
for (const flag of ["--ci", '--project "$RAILWAY_PROJECT_ID"', '--service "$RAILWAY_SERVICE"', "--environment production"]) {
  assert.ok(steps[deploy].includes(flag), `provider command must pin ${flag}`);
}
assert.match(releaseJob, /@railway\/cli@\d+\.\d+\.\d+/, "Railway CLI must be pinned to an exact version");
assert.doesNotMatch(steps[stepIndex("Install pinned Railway CLI")], /secrets\./, "CLI install must not see the token");
for (const use of workflow.match(/uses: \S+/g) || []) {
  assert.match(use, /@[0-9a-f]{40}$/, `action must be pinned to a full commit SHA: ${use}`);
}

assert.doesNotMatch(
  workflow.replace(/^\s*runs-on: ubuntu-latest$/gm, ""),
  /\blatest\b/i,
  "workflow must never target latest"
);
for (const step of workflow.split(/^      - /m)) {
  const runAt = step.indexOf("run:");
  if (runAt >= 0) {
    assert.doesNotMatch(step.slice(runAt), /\$\{\{/, "expressions must reach shell via env, not interpolation");
  }
}
const secretNames = [...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
assert.deepEqual([...new Set(secretNames)], ["RAILWAY_TOKEN"], "only RAILWAY_TOKEN may be referenced, by name");
assert.match(workflow, /^permissions:\n  contents: read\n  actions: read\n/m, "token must be read-only");
assert.match(workflow, /cancel-in-progress: false/, "releases must not cancel each other mid-deploy");

const copilotCi = fs.readFileSync(path.join(root, ".github/workflows/ai-copilot.yml"), "utf8");
assert.match(copilotCi, /^  workflow_dispatch:/m, "AI Copilot CI must be dispatchable to produce exact-main evidence");

for (const section of ["## Preflight", "## Release", "## Health", "## Functional smoke", "## Rollback", "## Fail-closed"]) {
  assert.ok(runbook.includes(section), `runbook must document ${section}`);
}

// --- Trusted SHA guard: presence, ordering, fail-closed behavior -------------

const GUARD_NAME = "name: Require release SHA to equal dispatched commit";
const guardScripts = [preflightJob, releaseJob].map((job, i) => {
  const label = i === 0 ? "preflight" : "release";
  const jobSteps = job.split(/^      - /m);
  assert.equal(jobSteps.filter((s) => s.includes(GUARD_NAME)).length, 1, `${label} job must have exactly one SHA guard`);
  assert.ok(jobSteps[1].startsWith(GUARD_NAME), `${label} SHA guard must be the first step`);
  const firstInputUse = jobSteps.findIndex((s, idx) => idx > 1 && /uses: actions\/checkout@|inputs\.sha|run: node /.test(s));
  assert.ok(firstInputUse > 1, `${label} SHA guard must precede checkout and scripts from inputs.sha`);
  assert.ok(jobSteps[firstInputUse].includes("uses: actions/checkout@"), `${label} first step after the guard must be the checkout`);
  const guardStep = jobSteps[1];
  assert.match(guardStep, /^        shell: bash$/m, `${label} SHA guard must run in bash`);
  assert.match(guardStep, /^          RELEASE_SHA: \$\{\{ inputs\.sha \}\}$/m, `${label} SHA guard must read inputs.sha via env`);
  assert.doesNotMatch(guardStep, /continue-on-error|\bif:/, `${label} SHA guard must not be skippable`);
  const body = guardStep.split(/^        run: \|\n/m)[1];
  assert.ok(body, `${label} SHA guard must have a run block`);
  return body.replace(/^ {10}/gm, "");
});
assert.equal(guardScripts[0], guardScripts[1], "both jobs must run the identical SHA guard");

const runGuard = (releaseSha, githubSha) =>
  spawnSync("bash", ["-e", "-c", guardScripts[0]], {
    env: { PATH: process.env.PATH, RELEASE_SHA: releaseSha, GITHUB_SHA: githubSha },
    encoding: "utf8",
  });
const TRUSTED = "c".repeat(40);
const accepted = runGuard(TRUSTED, TRUSTED);
assert.equal(accepted.status, 0, `guard must accept inputs.sha equal to GITHUB_SHA: ${accepted.stderr}`);
for (const [releaseSha, githubSha, why] of [
  ["d".repeat(40), TRUSTED, "another full SHA"],
  [TRUSTED.slice(0, 7), TRUSTED, "short SHA prefix"],
  [TRUSTED.toUpperCase(), TRUSTED, "uppercase SHA"],
  [` ${TRUSTED}`, TRUSTED, "leading whitespace"],
  [`${TRUSTED}\n`, TRUSTED, "trailing newline"],
  [`${TRUSTED}\n${"d".repeat(40)}`, TRUSTED, "multi-line input"],
  ["main", TRUSTED, "branch name"],
  ["", TRUSTED, "empty input"],
  ["", "", "empty input and empty GITHUB_SHA"],
  ["main", "main", "non-SHA GITHUB_SHA"],
  ["*", "*", "glob pattern"],
]) {
  const res = runGuard(releaseSha, githubSha);
  assert.notEqual(res.status, 0, `guard must fail closed on ${why}`);
  assert.match(res.stdout, /::error::inputs\.sha must be exactly the dispatched commit/, `guard must explain ${why}`);
}

// --- Gate logic: positive and negative cases ---------------------------------

const REPO = "NeaBouli/inferno";
const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const run = (over) => ({
  id: 1,
  path: REQUIRED_WORKFLOWS[0],
  head_sha: SHA,
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
  created_at: "2026-09-27T10:00:00Z",
  run_attempt: 1,
  head_repository: { full_name: REPO },
  ...over,
});
const green = REQUIRED_WORKFLOWS.map((p, i) => run({ id: i + 1, path: p }));

assert.doesNotThrow(() => assertDispatchRef("refs/heads/main"));
assert.throws(() => assertDispatchRef("refs/heads/feature"), /refs\/heads\/main/);
assert.throws(() => assertDispatchRef(undefined), /refs\/heads\/main/);

assert.doesNotThrow(() => assertFullSha(SHA));
for (const bad of [undefined, "", "abc1234", SHA.slice(0, 39), SHA + "a", "A".repeat(40), "g".repeat(40), `${SHA.slice(0, 39)};`, "main", "latest"]) {
  assert.throws(() => assertFullSha(bad), /40-character/, `must reject SHA ${JSON.stringify(bad)}`);
}

assert.doesNotThrow(() => assertShaIsMain(SHA, SHA));
assert.throws(() => assertShaIsMain(SHA, OTHER), /not current origin\/main/);
assert.throws(() => assertShaIsMain(SHA, undefined), /40-character/, "missing main ref must fail closed");

assert.doesNotThrow(() => assertRequiredWorkflowsGreen(green, SHA, REPO));
assert.throws(() => assertRequiredWorkflowsGreen([], SHA, REPO), /no .* run on main/, "no CI evidence");
assert.throws(() => assertRequiredWorkflowsGreen(green.slice(1), SHA, REPO), /ai-copilot\.yml/, "missing one required workflow");
assert.throws(() => assertRequiredWorkflowsGreen([...green.slice(1), run({ conclusion: "failure" })], SHA, REPO), /completed\/failure/);
assert.throws(() => assertRequiredWorkflowsGreen([...green.slice(1), run({ status: "in_progress", conclusion: null })], SHA, REPO), /in_progress/);
assert.throws(() => assertRequiredWorkflowsGreen([...green.slice(1), run({ head_sha: OTHER })], SHA, REPO), /no .* run/, "run on another SHA");
assert.throws(() => assertRequiredWorkflowsGreen([...green.slice(1), run({ head_branch: "feature" })], SHA, REPO), /no .* run/, "run on a non-main branch");
assert.throws(() => assertRequiredWorkflowsGreen([...green.slice(1), run({ event: "pull_request" })], SHA, REPO), /no .* run/, "PR run is not main evidence");
assert.throws(() => assertRequiredWorkflowsGreen([...green.slice(1), run({ head_repository: { full_name: "evil/inferno" } })], SHA, REPO), /no .* run/, "fork run");
assert.throws(
  () =>
    assertRequiredWorkflowsGreen(
      [...green, run({ id: 9, conclusion: "failure", created_at: "2026-09-27T11:00:00Z" })],
      SHA,
      REPO
    ),
  /latest run 9/,
  "a newer failed run overrides an older success"
);
assert.throws(
  () => assertRequiredWorkflowsGreen([...green, run({ id: 9, conclusion: "cancelled", run_attempt: 2 })], SHA, REPO),
  /latest run 9/,
  "a failed re-run attempt overrides the first attempt"
);
assert.doesNotThrow(
  () =>
    assertRequiredWorkflowsGreen(
      [...green.map((r) => (r.path === REQUIRED_WORKFLOWS[0] ? { ...r, conclusion: "failure" } : r)), run({ id: 9, created_at: "2026-09-27T11:00:00Z", event: "workflow_dispatch" })],
      SHA,
      REPO
    ),
  "a newer successful dispatch re-run on the same SHA is accepted"
);

console.log("[railway-release-contract] PASS");
