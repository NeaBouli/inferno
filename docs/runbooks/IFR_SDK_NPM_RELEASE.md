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

- [ ] Create the project npm organization (project e-mail, never a personal account) and enable
      mandatory two-factor authentication.
- [x] Package name stays `ifr-sdk` (unclaimed on the registry on 2026-10-03); verify again
      immediately before release.
- [x] License: MIT, `Inferno Protocol contributors` (repository `LICENSE`, shipped as
      `apps/sdk/LICENSE`).
- [ ] Select and document the release version and changelog.
- [ ] Confirm the generated tarball contains only the approved README, package metadata,
      JavaScript and type declarations.
- [ ] Run clean Node.js 20 and 22 CI against the exact release commit.
- [ ] Review the public README, security contact and supported Mainnet/API claims.
- [ ] Add the npm automation token as repository secret `NPM_TOKEN` and create the protected
      environment `npm-release` (required reviewer: owner). Never commit a registry token.
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

The final registry publication is an external write. `.github/workflows/sdk-publish.yml` runs only
for an owner-pushed tag `sdk-v<version>` matching `apps/sdk/package.json`, waits for approval in the
protected `npm-release` environment and publishes with npm provenance. Before pushing the tag:

1. Present the exact release commit, version, package manifest and `npm pack --dry-run` output.
2. Obtain explicit approval for that release.
3. Push the tag `sdk-v<version>` and approve the `npm-release` environment run.
4. Verify the registry metadata and install the immutable published version in a fresh consumer.
5. Record the package URL, integrity hash, CI run and verification result in `BRIDGE.md`.

If any verification differs from the reviewed candidate, stop and do not retry with modified
metadata under the same approval.
