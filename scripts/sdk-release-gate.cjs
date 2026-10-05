#!/usr/bin/env node
// Fail-closed gate for .github/workflows/sdk-publish.yml (T-208 review follow-up).
//
// Trust model (why there is no tag trigger): a tag- or branch-triggered run executes the workflow and this
// script from the triggering ref, so in-run checks alone cannot stop code from an unreviewed ref. The
// enforceable boundary is therefore server-side and independent of the code in the run:
//   - npm Trusted Publishing is bound to repository NeaBouli/inferno, workflow sdk-publish.yml and
//     environment npm-release, and npm rejects any OIDC token without exactly that environment;
//   - GitHub only lets a job enter npm-release from branch main (deployment policy) after a required
//     reviewer approves; main itself is protected (pull request review, required checks, no force push).
// So the only code that can obtain a publishable token is code merged to protected main. This gate runs
// before that job as defense in depth and refuses the release unless all of the following hold:
//   1. the run is a workflow_dispatch on refs/heads/main (no tag, no other branch, no other event);
//   2. the requested version is a plain semver equal to apps/sdk/package.json at the exact commit;
//   3. the commit is on main (identical to or an ancestor of main);
//   4. main is protected by pull_request, required_status_checks (covering REQUIRED_CHECKS) and
//      non_fast_forward rules;
//   5. every required check succeeded on that exact commit;
//   6. environment npm-release exists with a required reviewer and a deployment policy of exactly branch main;
//   7. ifr-sdk already exists on the registry (manual bootstrap done) and this version is not yet published.
// Any missing data, API error or unexpected shape fails the gate. It never publishes anything itself.
"use strict";

const REQUIRED_CHECKS = [
  "Hardhat contracts and tooling",
  "Secret Detection",
  "Dependency Audit",
  "Solidity Static Analysis",
  "Security Summary",
];
const REQUIRED_MAIN_RULES = ["pull_request", "required_status_checks", "non_fast_forward"];
const ENVIRONMENT = "npm-release";
const RELEASE_BRANCH = "main";
const PACKAGE_NAME = "ifr-sdk";
const SEMVER = /^\d+\.\d+\.\d+$/;

async function fetchJson(fetchImpl, url, headers) {
  const response = await fetchImpl(url, { headers });
  return { status: response.status, ok: response.ok, body: response.ok ? await response.json() : null };
}

async function getJson(fetchImpl, api, path, token) {
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchJson(fetchImpl, `${api}${path}`, headers);
  if (!response.ok) throw new Error(`GET ${path} returned HTTP ${response.status}`);
  return response.body;
}

async function runGate({
  repo, eventName, ref, sha, requestedVersion, packageVersion, token,
  fetchImpl = fetch, api = "https://api.github.com", registry = "https://registry.npmjs.org",
}) {
  const failures = [];
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "")) throw new Error("repository missing");
  if (!/^[0-9a-f]{40}$/.test(sha || "")) throw new Error("commit sha missing");

  if (eventName !== "workflow_dispatch") failures.push(`event ${eventName} cannot publish (workflow_dispatch only)`);
  if (ref !== `refs/heads/${RELEASE_BRANCH}`) failures.push(`ref ${ref} cannot publish (refs/heads/${RELEASE_BRANCH} only)`);
  if (!SEMVER.test(requestedVersion || "")) failures.push(`requested version ${requestedVersion} is not x.y.z`);
  else if (requestedVersion !== packageVersion) {
    failures.push(`requested version ${requestedVersion} does not match apps/sdk/package.json ${packageVersion}`);
  }

  const compare = await getJson(fetchImpl, api, `/repos/${repo}/compare/${RELEASE_BRANCH}...${sha}`, token);
  if (!["identical", "behind"].includes(compare.status)) {
    failures.push(`commit ${sha} is not on ${RELEASE_BRANCH} (compare status ${compare.status})`);
  }

  const rules = await getJson(fetchImpl, api, `/repos/${repo}/rules/branches/${RELEASE_BRANCH}`, token);
  if (!Array.isArray(rules)) throw new Error("branch rules response malformed");
  for (const type of REQUIRED_MAIN_RULES) {
    if (!rules.some((rule) => rule.type === type)) failures.push(`${RELEASE_BRANCH} is missing the ${type} rule`);
  }
  const contexts = rules.filter((rule) => rule.type === "required_status_checks")
    .flatMap((rule) => (rule.parameters && rule.parameters.required_status_checks) || [])
    .map((check) => check.context);
  for (const name of REQUIRED_CHECKS) {
    if (!contexts.includes(name)) failures.push(`${RELEASE_BRANCH} does not require check "${name}"`);
  }

  const runs = await getJson(fetchImpl, api, `/repos/${repo}/commits/${sha}/check-runs?per_page=100`, token);
  if (!Array.isArray(runs.check_runs)) throw new Error("check-runs response malformed");
  for (const name of REQUIRED_CHECKS) {
    const matching = runs.check_runs.filter((run) => run.name === name);
    if (!matching.length) failures.push(`required check "${name}" has no run on ${sha}`);
    else if (!matching.every((run) => run.status === "completed" && run.conclusion === "success")) {
      failures.push(`required check "${name}" did not succeed on ${sha}`);
    }
  }

  let environment;
  try {
    environment = await getJson(fetchImpl, api, `/repos/${repo}/environments/${ENVIRONMENT}`, token);
  } catch (error) {
    failures.push(`environment ${ENVIRONMENT} is not configured (${error.message})`);
  }
  if (environment) {
    const reviewers = (environment.protection_rules || []).filter((rule) => rule.type === "required_reviewers");
    if (!reviewers.some((rule) => Array.isArray(rule.reviewers) && rule.reviewers.length > 0)) {
      failures.push(`environment ${ENVIRONMENT} has no required reviewer`);
    }
    const policy = environment.deployment_branch_policy;
    if (!policy || policy.custom_branch_policies !== true) {
      failures.push(`environment ${ENVIRONMENT} must restrict deployments to branch ${RELEASE_BRANCH}`);
    } else {
      const policies = await getJson(fetchImpl, api, `/repos/${repo}/environments/${ENVIRONMENT}/deployment-branch-policies`, token);
      const list = Array.isArray(policies.branch_policies) ? policies.branch_policies : [];
      const onlyMain = list.length === 1 && list[0].type === "branch" && list[0].name === RELEASE_BRANCH;
      if (!onlyMain) failures.push(`environment ${ENVIRONMENT} deployment policy must be exactly branch ${RELEASE_BRANCH}`);
    }
  }

  const packument = await fetchJson(fetchImpl, `${registry}/${PACKAGE_NAME}`, { accept: "application/json" });
  if (packument.status === 404) {
    failures.push(`${PACKAGE_NAME} is not on the registry yet: the first version is the manual bootstrap (runbook)`);
  } else if (!packument.ok || !packument.body || typeof packument.body.versions !== "object") {
    throw new Error(`registry lookup for ${PACKAGE_NAME} returned HTTP ${packument.status}`);
  } else if (Object.prototype.hasOwnProperty.call(packument.body.versions, requestedVersion)) {
    failures.push(`${PACKAGE_NAME}@${requestedVersion} is already published (npm versions are immutable)`);
  }
  return { ok: failures.length === 0, failures };
}

module.exports = { runGate, REQUIRED_CHECKS, REQUIRED_MAIN_RULES, ENVIRONMENT, RELEASE_BRANCH, PACKAGE_NAME };

if (require.main === module) {
  const pkg = require("../apps/sdk/package.json");
  runGate({
    repo: process.env.GITHUB_REPOSITORY,
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA,
    requestedVersion: process.env.SDK_RELEASE_VERSION,
    packageVersion: pkg.version,
    token: process.env.GITHUB_TOKEN,
  }).then(({ ok, failures }) => {
    if (!ok) {
      for (const failure of failures) console.error(`[sdk-release-gate] FAIL ${failure}`);
      process.exit(1);
    }
    console.log("[sdk-release-gate] PASS - dispatch on protected main, required checks green, protected environment, unpublished version");
  }).catch((error) => {
    console.error(`[sdk-release-gate] FAIL ${error.message}`);
    process.exit(1);
  });
}
