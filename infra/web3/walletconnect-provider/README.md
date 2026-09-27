# WalletConnect Provider Artifact (CWA-47)

Self-hosted, pinned, reproducible WalletConnect v2 provider bundle served
same-origin at `docs/assets/vendor/walletconnect-ethereum-provider-2.17.3.esm.js`.
It replaces the former runtime `import("https://esm.sh/@walletconnect/ethereum-provider@2.17.3")`
in `docs/web3-wallet-core.js` and `docs/assets/wallet-core.js` — no third-party
code executes in the signing/wallet path anymore.

## Provenance

| Input | Pin |
| --- | --- |
| Source package | `@walletconnect/ethereum-provider@2.17.3` (exact, npm registry) |
| Input integrity | `package-lock.json` in this directory (resolved tarball + `integrity` SHA-512) |
| Browser shims | `buffer@6.0.3`, `process@0.11.10` (exact) |
| Bundler | `esbuild@0.28.2` (exact, devDependency) |
| Build command | `npm ci && npm run build` in this directory |
| Output | `docs/assets/vendor/walletconnect-ethereum-provider-2.17.3.esm.js` |
| Output SHA-256 | `30273eb8eb78e88e29ecdb73606fa3e41e66a646a2b33f5c864014a065c709fc` |

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

`npm audit` on this directory reports moderate advisories inside the pinned
`@walletconnect/ethereum-provider@2.17.3` dependency tree
(`@stablelib/ed25519` signature malleability via `@walletconnect/relay-auth`,
`decode-uri-component` via an old `query-string`, plus transitive Low
findings). This is exactly the code the site already executed at runtime from
the CDN before this change; the advisories are unchanged runtime exposure,
now visible at build time. They are build-time-only dependencies — the shipped
surface is the committed artifact and its recorded SHA-256. A provider version
upgrade (`2.25.x` resolves the moderate chain) is a separate reviewed step
because it changes audited connector behavior; do not bump casually.

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
