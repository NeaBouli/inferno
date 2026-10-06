# Changelog

## [Unreleased] — 2026-10-06 — Benefits PWA cache release v25 and light offline page (T-284)

### Fixed

- `fix:` Benefits service worker: cache release `ifr-benefits-v24` -> `ifr-benefits-v25`
  and registration `/sw.js?v=25`. The manifest (cache-first in the SW) changed its theme
  to `#F5F1E8` without a cache bump, so PWAs installed earlier kept the old manifest; the
  new release replaces it and activation deletes v21-v24. Cache strategy unchanged
  (network-first navigations, cache-first hashed Next assets, `/api/` never cached).
- `fix:` `offline.html` (precached deep-link fallback): the old dark card is replaced by the
  light shop design — the `.shop-shell` tokens from `globals.css` (`--shop-paper` #f5f1e8,
  panel, ink, muted, border, ember), `color-scheme: light`, theme-color `#F5F1E8`. The page
  stays static and self-contained: no scripts, `<link>`, `@import`, `url()` or other origins;
  its only asset (the 192 icon) is precached. Typography uses fixed px sizes (12/16/34 px,
  nothing scales with the viewport) and zero letter-spacing on all text.
- `fix:` Shop wallet chooser and the fixed Copilot launcher: the "Connect with" box, which
  holds the connector buttons and the WalletConnect hint, ended 1 px left of the launcher at
  820 px and narrower and ran 9 px under it from 821 px (tablet portrait 834 px, 1024 px). A
  right margin (16 px up to 820 px, 26 px above) keeps a 17 px gap at 375, 768, 819, 820,
  821, 834 and 1024 px.

### Tests

- `test:` `scripts/test-benefits-service-worker.js`: v25 pins (v24 is now stale; v26 is the
  simulated next release) and an offline-fallback contract — theme matches the manifest,
  light scheme, tokens equal the `globals.css` `.shop-shell` tokens, no retired dark colours,
  no scripts/stylesheets/remote references, every local asset precached, and fixed px/rem
  font sizes with zero letter-spacing (no vw/clamp sizes).
- `test:` `scripts/test-benefits-offline-shell.js`: v25 cache and the rendered fallback uses
  the light tokens (body, card, heading colour, theme-color).
- `test:` `scripts/test-benefits-wallet-telemetry.js` (WalletConnect build): at 375, 768, 819,
  820, 821, 834, 1024 and 1440 px the hint text stays left of the launcher band, the
  "Connect with" box keeps at least 12 px gap and there is no horizontal overflow.
- `chore:` `scripts/smoke-benefits-network.js` expects the v25 service worker after release.

## [Unreleased] — 2026-10-06 — IFR SDK npm publish path (T-288)

### Added

- `docs:` `docs/SDK_RELEASE.md`: plain-language one-time owner setup for publishing `ifr-sdk`
  (public MIT package, provenance, no long-lived npm token): GitHub environment `npm-release`
  (required reviewer, branch `main` only, no secrets), npm account preparation, the single manual
  `0.3.0` bootstrap, and the npm Trusted Publisher binding (`NeaBouli/inferno`, `sdk-publish.yml`,
  `npm-release`) with "require 2FA and disallow tokens".
- `ci:` `IFR SDK CI` now shows the exact tarball listing and runs `npm publish --dry-run` on every
  PR touching `apps/sdk` (no registry write; the file allowlist stays enforced by `test:package`).

### Fixed

- `docs:` SDK release runbook: the bootstrap command now uses `npm publish --access public
  --provenance=false`. With `publishConfig.provenance: true`, a local `npm publish` stops with
  `EUSAGE Automatic provenance generation not supported`, so the documented bootstrap would have
  failed. Records the owner decision of 2026-10-06.
- `docs:` Bootstrap token handling stated truthfully: `npm login` writes a session token into the
  npm user config; local bootstrap authentication is distinct from the CI path, which has no
  `NPM_TOKEN`. The first-version `--provenance=false` publish is a separately approved exception whose
  action-time approval names version, commit SHA, the seven-file package and the missing provenance.
- `feat:` `scripts/sdk-bootstrap-publish.sh`: fail-closed one-time bootstrap. Binds the run to the
  approved version and SHA, uses a private temporary `NPM_CONFIG_USERCONFIG` (no other npm config is
  read or changed), runs the package checks, `npm login --auth-type=web`, publishes only if
  `npm whoami` is `ifr-protocol`, keeps the publish exit status, and runs `npm logout` on every exit
  after a login. The temp config is deleted only after a successful logout and a verified clean file;
  otherwise HOLD (non-zero) and the file is kept for revocation under npmjs.com Access Tokens.
- `test:` `scripts/test-sdk-bootstrap-publish.cjs` (dummy npm, throwaway HOME/TMPDIR, run in
  `IFR SDK CI`): success, approval mismatch, failing `git status`/`rev-parse`, dirty tree, mktemp failure, failed package check, failed login
  (with and without a written credential), wrong account, publish failure, interruption, logout
  failure, credential left after logout, unreadable and missing config.

## [Unreleased] — 2026-10-06 — Web3 narrow hero in degraded wallet state (T-285)

### Fixed

- `fix:` Web3 (`docs/web3/index.html`): at 305 and 320 px, in the state "wallet
  connected, chain reads unavailable", the nowrap wallet note "Connected · status
  unavailable" widened the single hero column to 333 px. Hero copy was clipped on
  the right and the hero buttons reached into the Copilot launcher band. Below
  401 px, status notes now wrap at word boundaries and the value column keeps its
  natural width first, so "Unavailable" never breaks mid-word. Normal connected and
  public views are pixel-identical; the hero is unchanged at 375 px and wider.
- `test:` Regression test in `tests/browser/web3-write.spec.js` (305/320/375/390/1440,
  EIP-1193 mock wallet, read RPC on the wrong chain): no horizontal overflow, no
  clipped hero text (ancestor clipping considered), hero buttons left of the launcher.

## [Unreleased] — 2026-10-06 — Benefits dependency advisories (T-282)

### Security

- `security:` Benefits backend: `proxy-addr` 2.0.7 -> 2.0.8 (via `express`
  4.22.2, lockfile-only, inside express' `~2.0.7` range) for GHSA-jqcg-44mw-7w3h
  (critical library rating: IP spoofing via IPv4-mapped / zero-prefix IPv6 trust
  subnets). The backend trusts only the named ranges `loopback`, `linklocal`,
  `uniquelocal`; tests show `req.ip` resolves identically on 2.0.7 and 2.0.8 for
  that configuration (spoofed `X-Forwarded-For` from untrusted IPv4, IPv4-mapped
  and IPv6 peers is ignored). Exploitability of the live setup is not confirmed.
- `security:` Benefits frontend: `source-map-js` 1.2.1 -> 1.2.2 (via `postcss`,
  lockfile-only) for GHSA-68fv-2mgg-jv7q (high, event-loop DoS via indexed
  source-map offsets).
- `security:` Benefits frontend: `postcss-selector-parser` 6.1.4 -> 7.1.6 via an
  exact `overrides` pin (Tailwind 3.4 asks for `^6.1.2`; no patched 6.x exists) for
  GHSA-rj75-hqrm-r3gf (moderate, dev-only build tooling). The PostCSS/Tailwind
  output (CSS and source map) is byte-identical before and after.
- `security:` Benefits backend (dev-only): `sprintf-js` (GHSA-hp3w-g68c-fv3c, no
  patched release) removed from the tree by a scoped override
  `@istanbuljs/load-nyc-config` -> `js-yaml` 4.3.2 (argparse 2, no sprintf-js);
  no new advisory exception.
- `security:` Same advisory wave outside Benefits (all fail-closed CI audit gates):
  - root (dev tooling): `compression` 1.8.1 -> 1.8.2 (GHSA-vc2v-76pw-4v95, scoped
    override under `serve`), `smol-toml` 1.7.2 -> 1.9.0 (GHSA-r4xh-jqrq-34v2, under
    `markdownlint-cli`), `katex` 0.16.47 -> 0.18.2 (GHSA-238p-pmpm-9mq7, under
    `micromark-extension-math`).
  - AI Copilot: `proxy-addr` 2.0.8 (prod, lockfile-only; trusts the same named
    ranges as Benefits), dev `source-map-js` 1.2.2 and `postcss-selector-parser`
    7.1.6 (exact override; CSS + source map byte-identical).
  - Creator Gateway: `proxy-addr` 2.0.8 (prod, lockfile-only; `trust proxy` not
    enabled), dev `sprintf-js` removed via the same scoped `js-yaml` 4.3.2 override;
    dependency baseline pins updated.

### Tests

- Benefits backend `tests/rateLimiter.test.ts`: `req.ip` and the rate-limit key
  behind the production trust-proxy setting (now one exported
  `TRUSTED_PROXY_SUBNETS` constant) for untrusted IPv4 / IPv4-mapped / IPv6 peers
  with spoofed `X-Forwarded-For`, trusted Traefik/frontend hops, and an advisory
  canary that fails on `proxy-addr` 2.0.7.

## [Unreleased] — 2026-10-05 — Benefits wallet telemetry (T-280)

### Security / Privacy

- Benefits frontend (`shop.ifrunit.tech`) no longer contacts wallet SDK
  telemetry hosts on page load. Root cause: Wagmi reconnect-on-mount (and the
  WalletConnect connector's `setup()`) called `getProvider()` on every
  connector, which created the Coinbase Wallet SDK (analytics POSTs to
  `cca-lite.coinbase.com/amp` and `/metrics`) and the WalletConnect/AppKit
  provider (mandatory `INITIALIZE` analytics to `pulse.walletconnect.org`,
  plus `api.web3modal.org`) before any wallet was chosen.
- `src/lib/deferredWalletConnector.mjs` keeps the Coinbase Wallet and
  WalletConnect connectors dormant until the visitor picks them (or they are
  Wagmi's recent connector, so existing sessions still restore).
- Coinbase Wallet SDK `preference.telemetry: false` and WalletConnect Core
  `telemetryEnabled: false` stay off after a wallet is chosen too.
- A confirmed disconnect (in the app or in the wallet) and a failed session restore clear
  the connector's session marker and Wagmi's `recentConnectorId`, so a
  returning visitor who disconnected loads no wallet SDK until choosing again;
  a visitor who is still connected restores as before.

### Changed

- `manifest.json` `theme_color` aligned with the head `theme-color`
  (`#F5F1E8`, the paper page background); previously `#B0481E`.

### Tests

- `scripts/test-benefits-wallet-telemetry.js` (`npm run
  test:benefits-wallet-telemetry`, in the Benefits CI browser job): no wallet
  telemetry request before a wallet is chosen: hard assertions on every route
  at 375/1440, plus returning visitors (disconnected: no SDK load; still
  connected: restore runs, no telemetry). A page only counts when it is proven
  to work (HTTP OK, hydrated, route headings visible, no page error or error
  boundary, network idle); `test:benefits-wallet-telemetry-gate` proves the
  gate fails on late telemetry, broken/empty/unhydrated pages and invalid
  durations.
- Frontend `test:wallet-selection` adds `test-wallet-telemetry-config.mjs`;
  `test:discoverability` asserts manifest/head theme-color parity.

## [Unreleased] — 2026-03-08

### Added
- `contracts/bootstrap/BootstrapVaultV2.sol` — balanceOf check replaces
  transferFrom(ifrSource); Constructor 10→9 params; IERC20 interface cleaned
- `contracts/bootstrap/BootstrapVaultV3.sol` — V2 + permissionless refund()
  after 30-day grace period; CEI pattern; Refunded event
- `test/BootstrapVaultV2.test.js` — 23 tests, ifrSource-free suite
- `test/BootstrapVaultV3.test.js` — 27 tests, includes 4 refund() scenarios
- `scripts/deploy-bootstrap-vault-v2.js` — Sepolia deploy, 9 constructor params
- `scripts/deploy-bootstrap-mainnet-v2.js` — Mainnet deploy, 9 params + Alchemy patch
- `scripts/propose-feeexempt-vesting.js` — Governance proposal: setFeeExempt(Vesting, true)
- `scripts/propose-feeexempt-burnreserve.js` — Governance proposal: setFeeExempt(BurnReserve, true)

### Changed
- `docs/SECURITY_AUDIT_SKYWALKER.md` — Finding G + W14 marked RESOLVED in V2 (6537c11b)

### Security
- BootstrapVault V1 (0xA820...) superseded — do not deploy; finalise() was broken
- feeExempt gap closed: Vesting + BurnReserve proposals prepared (pending execution)
- Architecture audit complete: 0 CRITICAL in production contracts, 11 WARN (all low-risk)

### Commits
- `6537c11b` feat: BootstrapVaultV2
- `abd7c84e` scripts: V2 deploy scripts
- `a0718388` docs: SECURITY_AUDIT_CLAUDE G+W14 resolved
- `5dcf935f` test: BootstrapVaultV2 23 tests
- `f33b38ee` scripts: feeExempt Vesting+BurnReserve
- `c7d12a08` feat: BootstrapVaultV3 refund
- `8f113bf0` test: BootstrapVaultV3 27 tests
