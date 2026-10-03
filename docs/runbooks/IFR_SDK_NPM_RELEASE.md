# IFR SDK npm Release Runbook

Status: **NOT PUBLISHED**; publication approved by the project (2026-10-03, Lane 7), prepared via a
tag-triggered workflow

Package: `ifr-sdk`

Current repository version: `0.2.0`

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
- [ ] Create the environment `npm-release` with a required reviewer (the owner), `Prevent
      self-review` off (see Roles), and a deployment policy of selected tags `sdk-v*` only. No
      registry token is stored in GitHub: publication uses npm Trusted Publishing.
- [ ] Configure npm Trusted Publishing for `ifr-sdk` on npmjs.com: GitHub Actions, repository
      `NeaBouli/inferno`, workflow `sdk-publish.yml`, environment `npm-release`.
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

The final registry publication is an external write. `.github/workflows/sdk-publish.yml` is fail closed:

1. **Gate job** (`scripts/sdk-release-gate.cjs`, before any build or approval): the tag must equal
   `sdk-v<apps/sdk/package.json version>`; the tagged commit must be on protected `main` (identical to or
   an ancestor of `main`); every required main check (`Hardhat contracts and tooling`, `Secret Detection`,
   `Dependency Audit`, `Solidity Static Analysis`, `Security Summary`) must have succeeded on that exact
   commit; and `npm-release` must exist with a required reviewer and a tag-only `sdk-v*` deployment
   policy. A missing or unprotected environment, a version-matching tag on an unreviewed commit, a red or
   missing check, or any API error stops the run. Tests: `scripts/test-sdk-release-gate.cjs`.
2. **Publish job** (environment `npm-release`, owner approval): re-runs audit, tests and the package check,
   then `npm publish --provenance --access public` through npm Trusted Publishing (OIDC). No `NPM_TOKEN`
   exists; if no trusted publisher is configured, npm rejects the publish.

### Roles

Codex pushes the release tag `sdk-v<version>` on the reviewed `main` commit; the owner approves the
`npm-release` run. Both act through the same project GitHub account today, so `Prevent self-review` must
stay **off**: this is an intentional, documented owner self-approval exception, not a copied production
setting. The approval click itself is always the owner's.

### First publication (bootstrap)

npm Trusted Publishing is configured per package; if npmjs.com does not allow configuring it before
`ifr-sdk` exists, the first version needs a one-time bootstrap:

1. The owner publishes `0.2.0` once, locally, from the exact reviewed `main` commit, signed in as
   `ifr-protocol` with 2FA and the project alias e-mail (`npm publish --access public` in `apps/sdk`
   after `npm ci && npm test && npm run test:package`). No token is created for this.
2. Immediately configure Trusted Publishing for `ifr-sdk` (see Blocking Release Gates) and, in the
   package settings, require two-factor authentication and disallow tokens.
3. All later versions go only through the workflow above.

Until either path is set up, the workflow cannot publish (fail closed).

### Release steps

1. Present the exact release commit, version, package manifest and `npm pack --dry-run` output.
2. Obtain explicit approval for that release.
3. Codex pushes the tag `sdk-v<version>`; the owner approves the `npm-release` run.
4. Verify the registry metadata, including `npm view ifr-sdk maintainers` (project alias only, no
   personal e-mail), and install the immutable published version in a fresh consumer.
5. Record the package URL, integrity hash, CI run and verification result in `BRIDGE.md`.

If any verification differs from the reviewed candidate, stop and do not retry with modified
metadata under the same approval.
