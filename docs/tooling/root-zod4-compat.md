# Root Zod4 compatibility adapter (Hardhat tooling)

Status: project-owned compatibility adapter for this repository's JavaScript
root Hardhat toolchain. This is **not** a supported upstream Zod4 migration.
No TypeScript compatibility is claimed: the installed helper's public source
and declarations (`dist/src/index.d.ts`, `ZodTypeDef`/`ZodEffects` generics)
remain Zod3-specific and are left byte-identical to the original package.
`zod/v3` routing is not used.

## Boundary

Exactly one hop, traced in `docs/architecture/MAP.md` section 15:

```
package.json -> root postinstall adapter -> installed helper -> Hardhat validation
```

1. `package.json::overrides.zod` pins a single hoisted `zod@4.6.7` for every
   root dependent (`hardhat@3.20.0`, `@nomicfoundation/hardhat-zod-utils@3.0.5`).
2. `package.json::scripts.postinstall` runs
   `scripts/apply-hardhat-zod4-compat.cjs`.
3. The adapter patches exactly one file:
   `node_modules/@nomicfoundation/hardhat-zod-utils/dist/src/index.js`.
4. Hardhat's network config validation
   (`hardhat/dist/src/internal/builtin-plugins/network-manager/type-validation.js::validateNetworkUserConfig`)
   calls the patched `validateUserConfigZodType`.

## What the patch changes

Two Zod4 API adaptations plus one fail-closed guard; nothing else:

- `result.error.errors` -> `result.error.issues` (the only form in Zod4;
  paths/messages unchanged).
- `z.never({ errorMap: () => ({ message }) })` -> `z.never({ message })`
  (Zod4 silently ignores the legacy `errorMap` parameter; the `message`
  parameter preserves the custom message under Zod4 and Zod3).
- New fail-closed guard: any own string-keyed `__proto__` property
  anywhere in the input is rejected with a path error before `safeParse`.
  Zod4 skips own enumerable `__proto__` record entries, so
  `JSON.parse('{"networks":{"__proto__":{"type":"http","url":123}}}')` would
  otherwise pass with zero errors and reach Hardhat resolution unchecked.
  The traversal is cycle-safe, reads descriptors only (getters are never
  invoked), and reports array indices as numbers. Config objects must be
  plain objects (including null-prototype objects) or arrays with data
  properties; accessors and custom prototypes are rejected explicitly.
  Non-enumerable properties are inspected too: Zod reads known object fields
  directly, so an enumeration-only guard would leave hidden fields unchecked.
  Functions remain opaque values for plugin hooks. These restrictions avoid
  validating one representation and resolving another. Reserved keys are
  intentionally unsupported; malformed records are not recovered.

## Adapter verification contract

`scripts/apply-hardhat-zod4-compat.cjs` runs on every lifecycle-enabled
install and:

- requires the installed helper to be exactly `3.0.5` and zod exactly
  `4.6.7`;
- accepts only the exact original compiled bytes (SHA-256
  `8e10e6327da319ea5491bad7fe686fa0653cfc6db270457743eaca800a84c04e`) or the
  exact patched bytes (idempotent re-runs);
- validates every precondition (versions, hashes, realpath containment inside
  `node_modules`, regular-file target) **before** any write;
- rejects unexpected versions or hashes and writes nothing;
- rejects a symlinked `node_modules` directory;
- skips production-only installs when Hardhat, its helper and Zod are all
  absent; the runtime compatibility test still requires the full dev graph;
- uses no network, no shell, no environment secrets; it changes no vendor
  metadata, no audit configuration, and no zod sources.

## Intentional behavior change: safe-integer chain IDs

Zod4 `.int()` rejects integers above `2**53 - 1` that Zod3 accepted. This
project adopts the safe-integer config contract intentionally: chain IDs must
be safe integers. Project chains are 31337, 11155111 and 1, and
`Number.MAX_SAFE_INTEGER` (9007199254740991) remains valid; `2**53` is
rejected with the path `networks.<name>.chainId`.

## Verification

- `npm run test:hardhat-zod4-compat` — node:test regression gate covering the
  installed helper/network validator (valid, invalid, `__proto__`, nested
  `__proto__`, custom messages, undefined, chain IDs), adapter idempotence,
  fail-closed rejection fixtures (changed helper version, changed zod
  version, tampered source) with no-write guarantees, and the read-only
  typings non-claim.
- `npm run test:hardhat-config`, `npm run test:mocha-serializer`,
  `npx --no-install hardhat compile`, `npm run test:hardhat-runtime`,
  `npm run test:contracts:all` — existing root gates, unchanged.

## `--ignore-scripts` consumers

CI jobs that install with `npm ci --ignore-scripts` skip the postinstall
adapter. Inspected steps (`.github/workflows/docs-validator.yml`,
`security-audit.yml`, `mythril-analysis.yml`): none of them invokes Hardhat
after the skipped install — they run markdown lint, advisory/audit baselines,
Slither and Mythril policy checks only, so no real Hardhat invocation
bypasses the postinstall adapter there. They remain audit/doc-only and are
unchanged by this task.
