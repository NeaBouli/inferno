# IFR-owned RainbowKit compatibility candidate

This directory owns a local, immutable compatibility distribution of
RainbowKit2.2.11. It is not an upstream-supported RainbowKit release, a
published npm package, an accepted dependency fix or an application release.
The internal package identity is @ifr/rainbowkit-compat version2.2.11-ifr.1.
No ownership of an npm registry scope or publication is asserted.

The only package payload changes are the name, candidate version and normal
@vanilla-extract/css dependency from1.20.1 to exact1.21.3. No override,
patch-package, resolver hook, runtime wrapper or feature removal is used.
All other package.json bytes, all970 other files and every file mode remain
identical to the pinned upstream distribution. This includes MIT license,
runtime JS, CSS, types, exports, peers and original scripts.

## Reproduce and verify

Obtain the exact official tarball named in provenance.json, then verify its
pinned SHA512/SHA1 through repack.py before processing it. The recipe performs
bounded tar data reads; it never extracts files or executes package scripts.
It uses only the Python standard library. Publisher signatures are not
verified by this workflow; SRI binds the bytes to registry metadata.

    python3 repack.py build \
      --upstream /path/to/rainbowkit-2.2.11.tgz \
      --directory /new/empty/output
    python3 repack.py verify \
      --upstream /path/to/rainbowkit-2.2.11.tgz \
      --directory /existing/output
    python3 test_repack.py --upstream /path/to/rainbowkit-2.2.11.tgz

The output consists of the deterministic owned tarball, provenance.json and
payload-hashes.json. Sorted PAX tar entries, normalized archive owners/times,
preserved file modes and gzip9/mtime0 avoid host path/time input. Provenance
records the Python/zlib implementation used; cross-toolchain bit equality
must not be inferred from one-machine reproduction.

## Application integration candidate

The artifact checkpoint passed independently before Dashboard integration.
The normal dependency uses this local tarball with the existing import key
and explicit owned internal identity/provenance. An isolated npm 10.9.7
fixture proved ordinary file-key placement and all four exported paths.
The application manifest and generated lock now select this candidate;
actual installation, graph, build and behavior still require qualification.
Application imports and runtime implementation are unchanged.

The generated lock also selects Vite 6.4.5 through its normal same-major
range and decode-uri-component 0.5.1 through query-string 9.5.1's existing
range. All four existing overrides remain byte-identical. The older
WalletConnect Utils exact query-string 7.1.3 contract is still overridden by
the pre-existing query-string 9.5.1 selection; this work does not make that
whole SDK graph upstream-supported. CSS 1.21.3 normally brings deepmerge-ts
and modern-ahocorasick 3.3.0; no additional override is introduced.

From apps/dashboard, the owning qualification commands are:

    npm run test:owned-rainbowkit
    npm run test:dependencies
    npm run test:wallet-contracts
    npm run test:compat-preview
    npm run build

After an accepted build, npm run preview:compat serves only on
127.0.0.1:4178. The test-only bootstrap supplies synthetic EIP-1193 accounts
and ABI read data, blocks outbound SDK/RPC traffic and rejects signatures and
broadcasts. It does not change the built application bytes. Use the fixture
query for disconnected, connected, unsupported, owner, loading, error or long
data; wallet connection still goes through the actual UI and connector. No
WalletConnect relay/pairing, real provider, chain or device acceptance follows.

Actual absence of deepmerge, dependency/audit status, unchanged Zod contexts,
active wallet/mobile/ConnectorClient/nine-contract behavior and existing
responsive/modal/keyboard/state checks require separate execution and review.
No alert491 closure, clean Dashboard, wallet signature, transaction, provider
account action or production-readiness claim follows from payload equality.

The task boundary is in ARCHITECTURE.md and the scoped PlantUML sources.
Common project architecture maps and integration remain Root-owned.
