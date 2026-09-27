# AI Copilot — Railway Exact-SHA Release

Status: release candidate. Nothing in this runbook has been executed against Railway yet.

Workflow: `.github/workflows/railway-copilot-release.yml` (manual `workflow_dispatch` only).
Gate: `scripts/railway-release-preflight.cjs`. Contract test: `npm run test:railway-release`.

## Prerequisites (operator, one-time)

- GitHub environment `production` with a required reviewer and deployment branches limited to `main`.
- Environment secret `RAILWAY_TOKEN`: a Railway **project token** scoped to the copilot project's
  `production` environment. Created by Gio only; never pasted into chats, briefs or logs.
- Repository or environment variables `RAILWAY_COPILOT_PROJECT_ID` and `RAILWAY_COPILOT_SERVICE`
  (IDs/names, not secrets).
- Prove `railway up` build behaviour (Root Directory, config path, builder) on a non-production
  environment before the first production release.
- Railway GitHub autodeploy on production stays the second path until Gio disables it (see
  `INFERNO-RAILWAY-PRODUCTION-RELEASE-GATE-20260927`). Until then, main pushes still deploy directly.

## Preflight

Read-only; no secret, no provider call.

1. `git fetch origin main && git rev-parse origin/main` — pick this full 40-character SHA.
2. If `AI Copilot CI` has no successful run on that SHA (main head did not touch
   `apps/ai-copilot/`), dispatch `AI Copilot CI` on `main` and wait for it to finish.
3. Actions → **Railway Copilot Release** → Run workflow on `main`, `sha=<SHA>`, `mode=preflight`.
4. Before any checkout, the trusted workflow file requires `<SHA>` to equal the dispatched
   commit (`GITHUB_SHA`) exactly; then the job checks out `<SHA>` and runs the
   release-workflow contract before evaluating CI.
5. Pass means: dispatch ref is `main`, SHA equals current `origin/main`, and the latest runs of
   `ai-copilot.yml` and `security-audit.yml` on that SHA (push or dispatch on main, this repo)
   are `completed/success`.

## Release

1. Record the current production deployment ID and SHA in the Railway UI (rollback target).
2. Run the workflow on `main` with the same SHA and `mode=release`.
3. Preflight runs again, then the job waits for `production` approval.
4. After approval the job re-runs the gate (main may have moved during the wait), checks out and
   asserts exactly `<SHA>`, requires token, project and service, installs the pinned CLI without
   the token, and runs a single `railway up --ci --project … --service … --environment production
   --message "release <SHA>"`. `railway up` uploads the checked-out tree, not a git ref.
5. If main moved, the job fails. Re-run preflight with the new SHA; never widen the SHA.

## Health

```bash
curl -fsS --max-time 10 https://copilot-api.ifrunit.tech/api/health
# expect HTTP 200 and "status":"ok","apiKeySet":true
```

Poll every 15 s for at most 2 minutes after the deploy step finishes.

## Functional smoke

Bounded, read-only, no LLM cost:

```bash
curl -fsS --max-time 15 https://copilot-api.ifrunit.tech/api/ifr/supply  # expect HTTP 200 JSON
```

One `/api/chat` request only if Gio approves the model cost for this release.

## Rollback

Trigger on: deploy step failure, health not 200 within 2 minutes, smoke failure, or Railway showing
a deployment message other than `release <SHA>`.

1. Railway UI → service → Deployments → recorded previous deployment → ⋯ → **Rollback**
   (restores image and variables; limited by plan retention).
2. Re-run the Health and Functional smoke checks.
3. Do not re-dispatch with an older SHA — the gate rejects any SHA that is not current main.

## Fail-closed

The workflow stops before any checkout when the SHA is not exactly the dispatched commit
(`GITHUB_SHA`). It stops before any provider command when: the SHA is not 40 lowercase hex characters,
the dispatch ref is not `main`, the SHA is not current `origin/main`, a required workflow run is
missing, running, failed or from a fork/PR/other branch, the run list is incomplete, approval is
not given, `RAILWAY_TOKEN` is missing, or the project/service variables are missing.
