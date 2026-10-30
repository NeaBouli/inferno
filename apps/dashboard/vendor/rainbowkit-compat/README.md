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

    python3 repack.py build --upstream /path/to/rainbowkit-2.2.11.tgz --directory /new/empty/output
    python3 repack.py verify --upstream /path/to/rainbowkit-2.2.11.tgz --directory /existing/output
    python3 test_repack.py --upstream /path/to/rainbowkit-2.2.11.tgz

The output consists of the deterministic owned tarball, provenance.json and
payload-hashes.json. Sorted PAX tar entries, normalized archive owners/times,
preserved file modes and gzip9/mtime0 avoid host path/time input. Provenance
records the Python/zlib implementation used; cross-toolchain bit equality
must not be inferred from one-machine reproduction.

## Integration is still open

No Dashboard package/lock/import change is made in the artifact-first stage.
The preferred future normal dependency is a local tarball with the existing
import key and explicit owned internal identity/provenance. npm placement,
lock metadata and Node/Vite import/export resolution for that arrangement
must be proved first; file-dependency alias behavior is not assumed.

After Root GO, first use an isolated zero-dependency fixture to prove the
normal local-tarball key/name semantics with the existing npm version,
including ESM entry and styles.css export resolution. Then qualify the actual
Dashboard lock/build under the coordinated install. If the normal file mapping
does not preserve imports, use the explicit owned dependency name and update
the three known import sites; never introduce a resolver trick or hand-edit a
lock to force it.

Actual absence of deepmerge, dependency/audit status, unchanged Zod contexts,
active wallet/mobile/ConnectorClient/nine-contract behavior and existing
responsive/modal/keyboard/state checks require separate execution and review.
No alert491 closure, clean Dashboard, wallet signature, transaction, provider
account action or production-readiness claim follows from payload equality.

The task boundary is in ARCHITECTURE.md and the scoped PlantUML sources.
Common project architecture maps and integration remain Root-owned.
