# WalletConnect Provider Artifact (CWA-47)

Self-hosted, pinned, reproducible WalletConnect v2 provider bundle served
same-origin at `docs/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js`.
It replaces the former runtime `import("https://esm.sh/@walletconnect/ethereum-provider@2.17.3")`
in `docs/web3-wallet-core.js` and `docs/assets/wallet-core.js` — no third-party
code executes in the signing/wallet path anymore.

## Provenance

| Input | Pin |
| --- | --- |
| Source package | `@walletconnect/ethereum-provider@2.25.0` (exact, npm registry) |
| Input integrity | `package-lock.json` in this directory (resolved tarball + `integrity` SHA-512) |
| Browser shims | `buffer@6.0.3`, `process@0.11.10` (exact) |
| Bundler | `esbuild@0.28.2` (exact, devDependency) |
| Build command | `npm ci && npm run build` in this directory |
| Output | `docs/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js` |
| Output SHA-256 | `77843c24c6c5aa5b4f743af3f2dd3a9d94e16b15bb8c5ff1bba58db2b14cd63e` |

The build (`build.mjs`) bundles `entry.mjs` into a single minified ES module,
defines `process.env.NODE_ENV="production"` and injects `shims.mjs` for the
`Buffer`/`process`/`global` identifiers that parts of the WalletConnect
dependency tree reference unconditionally. Only browser code paths execute;
the shims exist so module evaluation never hits a bare `process`/`Buffer`
reference (the failure mode that broke earlier UMD attempts). Untagged
template literals are transpiled (`supported.template-literal=false`) and the
extracted legal comments are re-inlined with trailing whitespace stripped, so
the generated artifact also passes `git diff --check`; the build fails on any
trailing-whitespace, missing-banner or syntax invariant violation.

## Regression checks

- `npm run test:web3-wallet-runtime` (root) verifies the artifact SHA-256, the
  absence of remote executable imports in every browser-executable docs file,
  the service-worker precache entry and the locked build inputs, and unit-tests
  the CWA-48 unavailable-state semantics of `docs/assets/ifr-state.js`.
- `npm run test:web3-headers` enforces that the web3 host CSP `script-src`
  carries no third-party host.
- `npm run test:wallet-connect` / `npm run test:web3-write` (Playwright) cover
  deterministic same-origin provider loading and the wallet flows.

## Known advisories

`npm audit` reports zero known vulnerabilities for the pinned
`@walletconnect/ethereum-provider@2.25.0` build graph. This upgrade removes the
former `lodash`, `decode-uri-component`, `@stablelib/ed25519` and `elliptic`
paths from the provider lockfile. Dependencies remain build inputs; the browser
executes only the committed same-origin artifact with its recorded SHA-256.
Future provider upgrades still require the complete wallet regression gate.

## Updating the artifact

1. Bump `@walletconnect/ethereum-provider` here to the exact reviewed version
   (and esbuild/shims only when required), then `npm install` to refresh
   `package-lock.json`. Review the upstream changelog and the lockfile diff.
2. Rename the output file in `build.mjs` and the references in
   `docs/web3-wallet-core.js`, `docs/assets/wallet-core.js`,
   `docs/web3-sw.js`, `scripts/check-web3-wallet-runtime.cjs` and the
   Playwright suites to the new versioned name.
3. `npm ci && npm run build`; record the new SHA-256 in this README, in
   `scripts/check-web3-wallet-runtime.cjs` and in
   `tests/browser/web3-write.spec.js`.
4. Run `npm run test:web3-wallet-runtime`, `npm run test:web3-headers`,
   `npm run test:browser-ethers6`, `npm run test:wallet-connect` and
   `npm run test:web3-write` before integrating.
