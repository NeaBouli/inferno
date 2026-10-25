# Benefits frontend — bounded Zod 4.6.7 compatibility

Date: 2026-10-25
Scope: this repository's current Benefits frontend and connector configuration.

## What this is

A project-owned npm `overrides` entry resolves every `zod` in this
frontend's dependency tree to exactly `4.6.7`:

- `@base-org/account` 2.4.0 (optional) → `@coinbase/cdp-sdk` 1.53.0 declared `zod ^3.25.76`
- `@coinbase/cdp-sdk` 1.53.0 → nested `abitype` 1.0.6 (peer `zod ^3 >=3.22.0`, optional)
- `@reown/appkit-wallet` 1.8.19 pinned `zod` exactly `3.22.4` (nested copy removed by the override)

This is a bounded application contract, **not** an upstream-supported migration. The
root Hardhat graph is out of scope and untouched by this change.

## What was verified (and how to re-run)

```
npm ci
npm run test:zod-compat   # scripts/test-zod-wallet-schema.mjs
```

The test, against the actually installed packages:

1. Statically inspects the import closure of
   `@coinbase/cdp-sdk/_esm/policies/evmSchema.js` (imports exactly `zod` and
   `abitype/zod`) and `@reown/appkit-wallet` `dist/esm/src/W3mFrameSchema.js`
   (imports exactly `zod` and `./W3mFrameConstants.js`; constants file has no
   imports) and asserts no `fetch`/XHR/WebSocket/`eval`/dynamic-import/require
   constructs **before** importing anything. No SDK client entry module,
   window, iframe, or network client is loaded.
2. Asserts both consumers resolve `zod` into the root `node_modules/zod`
   4.6.7 tree, that the nested `zod` 3.22.4 under `@reown/appkit-wallet` is
   gone, and that the nested `abitype` stays 1.0.6.
3. CDP: `SignEvmTypedDataFieldCriterionSchema` accepts a tiny valid
   `evmTypedDataField` criterion; rejects `Message[0].name = 123` without
   throwing, with an issue path of `['types','types','Message',0,'name']`;
   rejects a malformed array element (missing `type`) at
   `['types','types','Message',0,'type']`. Errors are read via the plain
   `error.issues` array only.
4. Reown: `W3mFrameSchema.frameEvent.safeParse` accepts a tiny valid
   `@w3m-frame/SWITCH_NETWORK_ERROR` event; a malformed payload is rejected
   without throwing, surfaced as a single `invalid_union` issue (Zod 4 nests
   per-variant errors instead of v3 `unionErrors`). Vendor code only consumes
   the success flag and `error.message`, which remains a plain string — this
   shape difference does not affect the vendor usage. A direct non-union
   schema (`AppUpdateEmailRequest`) rejects `email = 123` at the exact path
   `['email']`, and the two-argument `z.record` form
   (`AppSyncThemeRequest.themeVariables`) accepts valid input under 4.6.7.

The regression command uses the actual installed schema modules rather than
copies. Source inspection of `@reown/appkit-wallet` 1.8.19 found zod
usage confined to `W3mFrameSchema.js` (+ type re-exports): `z.object`,
`z.string().email()`, `z.optional`, two-arg `z.record`, `z.literal`, `z.array`,
`.or()`, `.nullable()`, `safeParse`, `error.message` — all supported by the
Zod 4.6.7 classic root export. No concrete v3-only API assumption was found.

## Limits — what this does NOT prove

- A confirmed CDP policy-API compatibility limit remains: Zod4 skips own
  enumerable `__proto__` record entries, while CDP 1.53.0 policy create/update
  methods discard the parsed result and forward the original policy body.
  That policy API must not be treated as qualified by these schema probes.
  No source-backed path from the current Benefits wallet connector to those
  policy methods has been established; browser bundle qualification must
  establish the application boundary separately.
- Reown frame receive uses parsed data. Its app-event receive path forwards
  the original payload even after a parse failure; that behavior predates this
  override and is not claimed fixed here.

- No SDK client creation, wallet/session lifecycle, signing, or network
  transaction was run. Real W02 SDK lifecycle verification is explicitly out
  of scope here and remains a separate gate.
- No bundle/browser reachability proof for the schema modules; parent handles
  browser/visual qualification and CI if this candidate is accepted.
- `zod` 4.6.7 is forced onto packages that declare v3 ranges; if any runtime
  behavior outside the tested schema paths requires v3, that is a gap to
  report, not to silently accept.

## Application bundle boundary

`npm run test:zod-compat -- --bundle` additionally inspects every production
client JavaScript chunk. It rejects the exact CDP policy endpoint literal
`/v2/policy-engine/policies` and the unique `evmTypedDataField` discriminator,
so introducing that unqualified policy feature requires an explicit review.
CI runs this after both the normal build and the configured WalletConnect
telemetry build. These are semantic source markers, not minified identifier
names. This bounds this application build; it is not a universal proof about
arbitrary encodings, all SDK APIs or future builds.

## Deterministic rollback

Revert the candidate commit to restore the manifest and lockfile together,
then run `npm ci`. The previous dependency advisories return with that graph.
