# IFR SDK npm Release Runbook

Status: **NOT PUBLISHED**; publication approved by the project (2026-10-03, Lane 7) and confirmed by the
owner on 2026-10-06 as a public MIT package with provenance and no proprietary lock-in. First version:
manual bootstrap; later versions: manually dispatched workflow on protected `main`.

Plain-language owner click guide (npmjs.com and GitHub): [`docs/SDK_RELEASE.md`](../SDK_RELEASE.md).

Package: `ifr-sdk`

Current repository version: `0.3.0`

Supported runtime: Node.js 20 and 22

This runbook controls the first public npm release of the IFR SDK. The repository package is
usable as a versioned tarball, but it is not a public registry release.

## Current Evidence

- `npm test` validates exact IFR units, access tiers and signer-neutral Benefits checkout.
- `npm run test:package` creates the real npm tarball, checks its complete file list, installs
  it into a locked fresh consumer with `npm ci` and verifies CommonJS, ESM named-import
  interoperability and TypeScript declarations.
- CI runs the source and package-consumer tests on Node.js 20 and 22.
- The SDK accepts wallet-native signing callbacks and never accepts private keys or seed
  phrases.

## Blocking Release Gates

Do not run `npm publish` until every item is complete:

- [ ] Publisher account: the existing project npm user account `ifr-protocol` (no organization
      conversion). Enable mandatory two-factor authentication on it.
- [ ] Change the account e-mail to a confirmed project alias before the first publication. npm copies
      the account e-mail into public package metadata (`maintainers`); a personal address must never
      appear there.
- [x] Package name stays `ifr-sdk` (unclaimed on the registry on 2026-10-03); verify again
      immediately before release.
- [x] License: MIT, `Inferno Protocol contributors` (repository `LICENSE`, shipped as
      `apps/sdk/LICENSE`).
- [ ] Select and document the release version and changelog.
- [ ] Confirm the generated tarball contains only the approved README, package metadata,
      JavaScript and type declarations.
- [ ] Run clean Node.js 20 and 22 CI against the exact release commit.
- [ ] Review the public README, security contact and supported Mainnet/API claims.
- [ ] Owner, before the first workflow release: create the environment `npm-release` with a
      required reviewer (the owner), `Prevent self-review` off (see Roles), and deployment branches
      set to **selected branches: exactly `main`** (no tag rule, no other branch). No registry token
      is stored in GitHub: publication uses npm Trusted Publishing. The gate fails closed until
      this exists.
- [ ] Owner, after the bootstrap: configure npm Trusted Publishing for `ifr-sdk` on npmjs.com with
      **all four bindings**: GitHub Actions, repository `NeaBouli/inferno`, workflow filename
      `sdk-publish.yml`, environment `npm-release`. The environment binding is mandatory: without it
      a run that never entered the protected environment could mint an accepted token.
- [ ] Obtain explicit action-time approval after presenting the exact package metadata,
      tarball manifest and release command for review.

## Local Release Candidate

From the repository:

```bash
cd apps/sdk
npm ci
npm audit --audit-level=moderate
npm test
npm run test:package
npm pack --dry-run --ignore-scripts
```

Expected tarball files:

```text
LICENSE
README.md
dist/benefits.d.ts
dist/benefits.js
dist/index.d.ts
dist/index.js
package.json
```

The package-consumer test rejects all other unexpected source, test, environment or dependency
files.

## External Publication Boundary

The final registry publication is an external write. There are exactly two publication paths, used once
each in this order: the manual bootstrap for the first version, then `.github/workflows/sdk-publish.yml`
for every later version.

### Why there is no tag trigger

A tag- or push-triggered GitHub Actions run loads the workflow file and every script it calls from the
triggering ref. Anyone able to create an `sdk-v*` tag on an unreviewed commit could therefore replace
`sdk-publish.yml` or `scripts/sdk-release-gate.cjs` in that commit and skip any in-run check. The publish
boundary is therefore placed where the code of the run cannot change it:

- the workflow is `workflow_dispatch` only (input `version`), with no `push`/`tags` trigger;
- environment `npm-release` only accepts jobs from branch `main` (deployment policy, enforced by GitHub)
  and only after a required reviewer approves;
- `main` is protected by rulesets (pull request, required checks, no force push), so the workflow and
  gate that can reach `npm-release` are always reviewed code;
- npm Trusted Publishing accepts only an OIDC token for repository `NeaBouli/inferno`, workflow
  `sdk-publish.yml` **and** environment `npm-release`; `id-token: write` exists only on the `publish`
  job, which runs in that environment. The `gate` job has read-only permissions and no OIDC capability.

A run from a tag or any other branch, whatever its workflow content, either cannot enter `npm-release`
(GitHub refuses the deployment) or does not carry the environment claim npm requires. `sdk-v*` tags are
optional release markers created after publication; they trigger nothing. A tag ruleset for `sdk-v*` is
recommended hygiene but no longer part of the publish boundary.

### Workflow (fail closed)

1. **Gate job** (`scripts/sdk-release-gate.cjs`, read-only token, before approval): the run must be a
   `workflow_dispatch` on `refs/heads/main`; the `version` input must be `x.y.z` and equal
   `apps/sdk/package.json` at the exact commit; the commit must be on `main` (identical to or an
   ancestor of `main`); `main` must carry the `pull_request`, `required_status_checks` and
   `non_fast_forward` rules with the required checks listed below; every required check
   (`Hardhat contracts and tooling`, `Secret Detection`, `Dependency Audit`, `Solidity Static Analysis`,
   `Security Summary`) must have succeeded on that exact commit; `npm-release` must exist with a required
   reviewer and a deployment policy of exactly branch `main`; and `ifr-sdk` must already exist on the
   registry (bootstrap done) without this version. Any other state, or any API error, stops the run.
   Tests: `scripts/test-sdk-release-gate.cjs`; trigger and permission shape:
   `scripts/test-workflow-permissions.cjs`.
2. **Publish job** (environment `npm-release`, owner approval, the only job with `id-token: write`):
   re-checks dispatch, ref and version, re-runs audit, tests and the package check, then
   `npm publish --provenance --access public` through npm Trusted Publishing. No `NPM_TOKEN` exists; if
   no trusted publisher is configured, npm rejects the publish.

The gate cannot read the npm Trusted Publisher configuration; npm enforces it at publish time and fails
closed if it is missing or bound differently.

### Roles

Codex (or the owner) dispatches the workflow on `main` with the reviewed version; the owner approves the
`npm-release` run. Both act through the same project GitHub account today, so `Prevent self-review` must
stay **off**: this is an intentional, documented owner self-approval exception, not a copied production
setting. The approval click itself is always the owner's, after checking that the run's commit SHA is the
reviewed one.

### First release: manual bootstrap (once)

npm Trusted Publishing is configured per existing package, so the first version is published manually and
**never** again by the workflow (npm versions are immutable; the gate refuses a version that is already on
the registry and refuses every run before the package exists):

1. The owner publishes the version in `apps/sdk/package.json` on the exact reviewed `main` commit
   (currently `0.3.0`) once, locally, signed in as `ifr-protocol` with 2FA and the project alias e-mail.
   `--provenance=false` is required here: `publishConfig.provenance` is `true` for the workflow, and npm
   refuses provenance outside a supported CI provider, so a plain local `npm publish` fails before upload.
   The bootstrap version therefore carries no provenance attestation; every workflow release does.
   `npm login` writes a **session token** into the npm user config. The bootstrap therefore uses a
   temporary user config (`NPM_CONFIG_USERCONFIG`, deleted afterwards) so the global `~/.npmrc` is never
   touched, and runs `npm logout` immediately after the publish, which revokes the token on the registry.
   No long-lived token is created and nothing is stored in GitHub. No `sdk-v*` tag or workflow run is
   used for this version. Exact commands, from the repository root:

   ```bash
   cd apps/sdk
   npm ci
   npm test
   npm run test:package
   npm pack --dry-run --ignore-scripts   # must list exactly the 7 approved files

   # Temporary npm user config: the session token never touches the global ~/.npmrc.
   export NPM_CONFIG_USERCONFIG="$(mktemp "${TMPDIR:-/tmp}/ifr-npm-bootstrap.XXXXXX")"
   npm login --auth-type=web             # browser sign-in as ifr-protocol with 2FA
   npm whoami                            # must print: ifr-protocol
   npm publish --access public --provenance=false
   npm logout                            # revokes the session token on the registry and removes it locally

   # Verify no token is left behind, then delete the temporary config.
   if grep -q '//registry.npmjs.org/:_authToken' "$NPM_CONFIG_USERCONFIG"; then echo "TOKEN STILL PRESENT - stop"; else echo "temp config: no token"; fi
   rm -f "$NPM_CONFIG_USERCONFIG"
   unset NPM_CONFIG_USERCONFIG
   if grep -q '//registry.npmjs.org/:_authToken' ~/.npmrc 2>/dev/null; then echo "~/.npmrc HAS A TOKEN - check"; else echo "~/.npmrc: no token"; fi
   ```

   Stop if either check reports a token; revoke it under npmjs.com -> Access Tokens before continuing.
2. Immediately configure Trusted Publishing for `ifr-sdk` with all four bindings (see Blocking Release
   Gates) and, in the package settings, require two-factor authentication and disallow tokens.
3. Verify the bootstrap as in step 4 of the workflow release below; optionally create the marker tag
   `sdk-v<bootstrap version>` afterwards (it triggers nothing).

### Later releases (workflow)

1. Bump `apps/sdk/package.json` (and `dist`) to a new, unpublished version through a reviewed PR to `main`.
2. Present the exact release commit, version, package manifest and `npm pack --dry-run` output; obtain
   explicit approval for that release.
3. Dispatch `IFR SDK Publish` on `main` with input `version`; the owner verifies the run SHA and approves
   the `npm-release` deployment.
4. Verify the registry metadata, including `npm view ifr-sdk maintainers` (project alias only, no
   personal e-mail) and the provenance attestation, and install the immutable published version in a
   fresh consumer.
5. Record the package URL, integrity hash, CI run and verification result in `BRIDGE.md`.

If any verification differs from the reviewed candidate, stop and do not retry with modified metadata
under the same approval.
