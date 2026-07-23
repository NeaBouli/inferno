# IFR SDK npm Release Runbook

Status: **NOT PUBLISHED**

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

- [ ] Confirm the npm owner or organization and enable mandatory two-factor authentication.
- [ ] Decide whether the package stays `ifr-sdk` and verify registry ownership immediately
      before release.
- [ ] Add the approved repository `LICENSE` file and confirm the copyright holder. The current
      `package.json` says `MIT`, but no project license file exists; do not infer ownership.
- [ ] Select and document the release version and changelog.
- [ ] Confirm the generated tarball contains only the approved README, package metadata,
      JavaScript and type declarations.
- [ ] Run clean Node.js 20 and 22 CI against the exact release commit.
- [ ] Review the public README, security contact and supported Mainnet/API claims.
- [ ] Configure a least-privilege npm release method with 2FA or trusted publishing. Never
      commit a registry token.
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
README.md
dist/benefits.d.ts
dist/benefits.js
dist/index.d.ts
dist/index.js
package.json
```

An approved `LICENSE` becomes the only permitted seventh file once the license gate is complete.
The package-consumer test rejects all other unexpected source, test, environment or dependency
files.

## External Publication Boundary

The final registry publication is an external write and is intentionally not automated by the
current CI workflow. Before publication:

1. Present the exact release commit, version, package manifest and `npm pack --dry-run` output.
2. Obtain explicit approval for that release.
3. Publish from the approved protected environment.
4. Verify the registry metadata and install the immutable published version in a fresh consumer.
5. Record the package URL, integrity hash, CI run and verification result in `BRIDGE.md`.

If any verification differs from the reviewed candidate, stop and do not retry with modified
metadata under the same approval.
