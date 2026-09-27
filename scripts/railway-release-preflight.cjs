#!/usr/bin/env node
// Read-only release gate for the Railway ai-copilot production service.
// Proves: dispatch ref is main, SHA is a full 40-char hash, SHA == current origin/main,
// and every required workflow has a successful run on exactly that SHA.
// Performs no provider call and needs no provider secret.

const SHA_RE = /^[0-9a-f]{40}$/;
const MAIN_REF = "refs/heads/main";
const REQUIRED_WORKFLOWS = [
  ".github/workflows/ai-copilot.yml",
  ".github/workflows/security-audit.yml",
];
const TRUSTED_EVENTS = new Set(["push", "workflow_dispatch"]);

function assertDispatchRef(ref) {
  if (ref !== MAIN_REF) {
    throw new Error(`release must be dispatched from ${MAIN_REF}, got ${ref || "<empty>"}`);
  }
}

function assertFullSha(sha) {
  if (typeof sha !== "string" || !SHA_RE.test(sha)) {
    throw new Error("release SHA must be a full 40-character lowercase hex commit SHA");
  }
}

function assertShaIsMain(sha, mainSha) {
  assertFullSha(mainSha);
  if (sha !== mainSha) {
    throw new Error(`release SHA ${sha} is not current origin/main (${mainSha})`);
  }
}

function assertRequiredWorkflowsGreen(runs, sha, repo, required = REQUIRED_WORKFLOWS) {
  for (const workflowPath of required) {
    const candidates = runs.filter(
      (run) =>
        run.path === workflowPath &&
        run.head_sha === sha &&
        run.head_branch === "main" &&
        TRUSTED_EVENTS.has(run.event) &&
        run.head_repository?.full_name === repo
    );
    if (candidates.length === 0) {
      throw new Error(`no ${workflowPath} run on main for ${sha}`);
    }
    const latest = candidates.reduce((a, b) =>
      Date.parse(b.created_at) > Date.parse(a.created_at) ||
      (b.created_at === a.created_at && (b.run_attempt || 1) > (a.run_attempt || 1))
        ? b
        : a
    );
    if (latest.status !== "completed" || latest.conclusion !== "success") {
      throw new Error(
        `${workflowPath} latest run ${latest.id} is ${latest.status}/${latest.conclusion || "none"}`
      );
    }
  }
}

async function githubGet(repo, path, token) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} returned HTTP ${res.status}`);
  }
  return res.json();
}

async function main() {
  const sha = process.env.RELEASE_SHA;
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!repo || !token) {
    throw new Error("GITHUB_REPOSITORY and GH_TOKEN are required");
  }
  assertDispatchRef(process.env.GITHUB_REF);
  assertFullSha(sha);

  const ref = await githubGet(repo, "/git/ref/heads/main", token);
  assertShaIsMain(sha, ref?.object?.sha);

  const data = await githubGet(repo, `/actions/runs?head_sha=${sha}&per_page=100`, token);
  if (!Array.isArray(data.workflow_runs) || data.total_count > data.workflow_runs.length) {
    throw new Error("workflow run list is incomplete; refusing to evaluate CI evidence");
  }
  assertRequiredWorkflowsGreen(data.workflow_runs, sha, repo);

  console.log(`[railway-release-preflight] PASS ${sha} == origin/main, required workflows green`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[railway-release-preflight] FAIL ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  REQUIRED_WORKFLOWS,
  assertDispatchRef,
  assertFullSha,
  assertShaIsMain,
  assertRequiredWorkflowsGreen,
};
