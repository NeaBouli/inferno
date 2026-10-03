#!/usr/bin/env node
// Fail-closed gate for .github/workflows/sdk-publish.yml (T-208 review follow-up).
// Publication may only continue when all of the following hold for the pushed tag sdk-v<version>:
//   1. the tag equals sdk-v<apps/sdk/package.json version>;
//   2. the tagged commit is on protected main (identical to or an ancestor of main);
//   3. every required main check (ruleset main-required-ci) succeeded on that exact commit;
//   4. the environment npm-release exists, has a required-reviewer rule with at least one reviewer,
//      and only allows deployments from sdk-v* tags (custom deployment policy).
// Any missing data, API error or unexpected shape fails the gate. It never publishes anything itself.
"use strict";

const REQUIRED_CHECKS = [
  "Hardhat contracts and tooling",
  "Secret Detection",
  "Dependency Audit",
  "Solidity Static Analysis",
  "Security Summary",
];
const ENVIRONMENT = "npm-release";
const TAG_PATTERN = "sdk-v*";

async function getJson(fetchImpl, api, path, token) {
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(`${api}${path}`, { headers });
  if (!response.ok) throw new Error(`GET ${path} returned HTTP ${response.status}`);
  return response.json();
}

async function runGate({ repo, tag, sha, packageVersion, token, fetchImpl = fetch, api = "https://api.github.com" }) {
  const failures = [];
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "")) throw new Error("repository missing");
  if (!/^[0-9a-f]{40}$/.test(sha || "")) throw new Error("commit sha missing");

  if (tag !== `sdk-v${packageVersion}`) failures.push(`tag ${tag} does not match sdk-v${packageVersion}`);

  const compare = await getJson(fetchImpl, api, `/repos/${repo}/compare/main...${sha}`, token);
  if (!["identical", "behind"].includes(compare.status)) {
    failures.push(`commit ${sha} is not on main (compare status ${compare.status})`);
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
    if (!reviewers.length || !reviewers.some((rule) => Array.isArray(rule.reviewers) && rule.reviewers.length > 0)) {
      failures.push(`environment ${ENVIRONMENT} has no required reviewer`);
    }
    const policy = environment.deployment_branch_policy;
    if (!policy || policy.custom_branch_policies !== true) {
      failures.push(`environment ${ENVIRONMENT} must restrict deployments to ${TAG_PATTERN} tags`);
    } else {
      const policies = await getJson(fetchImpl, api, `/repos/${repo}/environments/${ENVIRONMENT}/deployment-branch-policies`, token);
      const list = Array.isArray(policies.branch_policies) ? policies.branch_policies : [];
      const onlyTags = list.length > 0 && list.every((entry) => entry.type === "tag" && entry.name === TAG_PATTERN);
      if (!onlyTags) failures.push(`environment ${ENVIRONMENT} deployment policy must be exactly tag ${TAG_PATTERN}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

module.exports = { runGate, REQUIRED_CHECKS, ENVIRONMENT, TAG_PATTERN };

if (require.main === module) {
  const pkg = require("../apps/sdk/package.json");
  runGate({
    repo: process.env.GITHUB_REPOSITORY,
    tag: process.env.GITHUB_REF_NAME,
    sha: process.env.GITHUB_SHA,
    packageVersion: pkg.version,
    token: process.env.GITHUB_TOKEN,
  }).then(({ ok, failures }) => {
    if (!ok) {
      for (const failure of failures) console.error(`[sdk-release-gate] FAIL ${failure}`);
      process.exit(1);
    }
    console.log("[sdk-release-gate] PASS - reviewed main commit, required checks green, protected environment verified");
  }).catch((error) => {
    console.error(`[sdk-release-gate] FAIL ${error.message}`);
    process.exit(1);
  });
}
