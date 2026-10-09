# IFR SDK on npm: one-time owner setup

This page lists the clicks the owner makes once in the browser so that the IFR SDK (`ifr-sdk`,
`apps/sdk`) can be published on npm as a public, MIT-licensed, community package with provenance.
The technical details, the trust model and the release gate are in
[`docs/runbooks/IFR_SDK_NPM_RELEASE.md`](runbooks/IFR_SDK_NPM_RELEASE.md); that runbook is the
binding reference if the two pages ever disagree.

Owner decision 2026-10-06: publishing is approved as long as the package stays public (MIT), is
published from the public repository `NeaBouli/inferno` with provenance, and has no proprietary
lock-in. No long-lived npm token is created or stored anywhere; the single manual bootstrap uses a
short-lived local login session that is ended with `npm logout` right after the publish (step C).

## Why there is one manual publish

npm can only attach a "Trusted Publisher" (the link between the npm package and our GitHub
workflow) to a package that already exists on npm. So:

1. version `0.4.0` (the first npm version; 0.3.0 was never published) is published **once by hand** (the "bootstrap"), without provenance;
2. then the Trusted Publisher is switched on;
3. every later version is published by the GitHub workflow `IFR SDK Publish`
   (`.github/workflows/sdk-publish.yml`) with a public provenance attestation, and only after the owner
   clicks "Approve".

## Order of the steps

| # | Where | What | When |
| --- | --- | --- | --- |
| A | GitHub | Create the protected environment `npm-release` | any time, before the first workflow release |
| B | npmjs.com | Prepare the publisher account `ifr-protocol` (2FA, project e-mail) | before the bootstrap |
| C | Terminal + npmjs.com | Bootstrap publish of `0.4.0` | after an explicit "yes" from the owner |
| D | npmjs.com | Add the Trusted Publisher and lock the package to it | right after C |

## A. GitHub: protected environment `npm-release`

1. Open <https://github.com/NeaBouli/inferno/settings/environments> and click **New environment**.
2. Name: `npm-release` (exactly this spelling). Click **Configure environment**.
3. Tick **Required reviewers** and add the owner account.
4. Leave **Prevent self-review** switched **off** (Codex/owner dispatch and the owner approve through
   the same account; this is a documented exception).
5. Under **Deployment branches and tags** choose **Selected branches and tags**, click
   **Add deployment branch or tag rule**, type `main`, and keep the type **Branch**. Add nothing else
   (no tag rule, no other branch).
6. Do **not** add any secret or variable to this environment. No `NPM_TOKEN` is needed.
7. Click **Save protection rules**.

Optional hygiene: a tag ruleset for `sdk-v*` (Settings -> Rules -> Rulesets) so that only the owner
can create release marker tags. Tags trigger nothing; they are only labels after a release.

## B. npmjs.com: publisher account

1. Sign in at <https://www.npmjs.com/login> as `ifr-protocol`.
2. Account -> **Two-Factor Authentication**: enable it (authenticator app or security key) for
   **authorization and writes**.
3. Account -> **Profile** / e-mail: set a confirmed **project alias** address. npm copies this
   address into the public package metadata, so a personal address must never be used.
4. The package name `ifr-sdk` was free on 2026-10-06 (`npm view ifr-sdk` returns 404). It is checked
   again directly before the bootstrap.

## C. Bootstrap publish of 0.4.0 (once)

This is the only step that needs a terminal. Claude prepares it and runs it **only after the owner's
explicit "yes" in the chat**; the owner signs in to npm in the browser and confirms the 2FA prompt.

The approval for this step is separate from the general publication decision. It must name: version
`0.4.0`, the exact commit SHA, the seven-file package listing, and that this first version is published
**without provenance** (in this repository's release path, provenance is produced only by the GitHub Actions
Trusted Publishing workflow; the local bootstrap uses `--provenance=false`, and every later version is published by
that workflow with provenance. Any other bootstrap path or an npm token needs a separate owner/security decision).

From a clean checkout of the approved commit, one command does the whole bootstrap:

```bash
git fetch origin && git checkout --detach <approved-sha>   # the reviewed main commit
bash scripts/sdk-bootstrap-publish.sh 0.4.0 <approved-sha>
```

What the script (`scripts/sdk-bootstrap-publish.sh`) does, and where it stops (HOLD, non-zero exit):

1. Refuses to start unless the checkout is exactly the approved commit, the tree is clean and the package
   is `ifr-sdk` at the approved version.
2. Creates a private temporary npm config file and uses only that one (`NPM_CONFIG_USERCONFIG`). Your
   normal npm configuration is never read, changed or removed.
3. Runs `npm ci`, the SDK tests, the package check and `npm pack --dry-run`.
4. `npm login --auth-type=web`: you sign in in the browser as `ifr-protocol` with 2FA. This **does**
   write a session token into the temporary config file.
5. Publishes only if `npm whoami` is exactly `ifr-protocol`:
   `npm publish --access public --provenance=false --ignore-scripts`.
6. On every exit after a login (success, wrong account, publish failure, Ctrl-C) it runs `npm logout`,
   which ends the token session on the npm registry. It deletes the temporary file only when the logout
   succeeded **and** the file verifiably contains no credential line.

If it ends with **HOLD** after a login (logout failed, a credential line is still there, or the file is
missing or unreadable), the temporary file is kept on purpose and its path is printed. Then: open
npmjs.com -> **Access Tokens**, revoke the session from this bootstrap, and only afterwards delete that
file. Tokens are never printed. No long-lived publish token is created, and nothing is stored in GitHub.
The fail-closed behaviour is covered by `scripts/test-sdk-bootstrap-publish.cjs` (dummy npm, no real
login), which runs in `IFR SDK CI`.

Afterwards: `npm view ifr-sdk maintainers` must show only the project alias.

## D. npmjs.com: Trusted Publisher and lock-down

1. Open <https://www.npmjs.com/package/ifr-sdk/access> (package page -> **Settings**).
2. Section **Trusted Publisher** -> choose **GitHub Actions** and fill in exactly:
   - Organization or user: `NeaBouli`
   - Repository: `inferno`
   - Workflow filename: `sdk-publish.yml`
   - Environment name: `npm-release`
3. Click **Set up connection** / save.
4. Same page, section **Publishing access**: choose
   **Require two-factor authentication and disallow tokens**. Save. From now on nobody can publish
   with a token; only the approved workflow (and 2FA-confirmed humans) can.

## Every later release

1. A reviewed PR bumps `apps/sdk/package.json` and `dist` to the new version and is merged to `main`.
2. GitHub -> **Actions** -> **IFR SDK Publish** -> **Run workflow** on `main`, input `version`
   (for example `0.3.1`).
3. The gate job checks branch, version, green checks, the environment and that the version is new.
4. The owner checks that the commit SHA of the run is the reviewed one and clicks **Approve** on the
   `npm-release` deployment.
5. The package appears on npm with a provenance badge linking to the exact workflow run and commit.

Every pull request touching `apps/sdk` already runs the same build, tests, committed-`dist` check,
tarball allowlist check and an `npm publish --dry-run` in `IFR SDK CI`, so a release cannot ship
files that were not visible in review.
