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

## [Unreleased] — 2026-10-06 — Points vouchers match FeeRouterV1 and follow the on-chain fee (T-289)

### Fixed

- `fix:` Points backend (`apps/points-backend`): vouchers were signed with the EIP-712 primary
  type `Voucher`, while FeeRouterV1 hashes `DiscountVoucher(address user,uint16 discountBps,uint32
  maxUses,uint64 expiry,uint256 nonce)`. Every issued voucher therefore failed on-chain with
  "Invalid voucher signature". The format now lives in the dependency-free
  `src/services/voucher-eip712.ts` and uses `DiscountVoucher`.
- `fix:` For every issuance the backend reads `FeeRouterV1.protocolFeeBps` fresh over the chain-pinned
  RPC (no success cache; concurrent requests share one in-flight read) and signs `min(discountBps, maxDiscountBps, protocolFeeBps)`,
  so a future fee change cannot produce vouchers that revert with "Discount exceeds fee". An
  unreadable, out-of-range or wrong-chain fee read, or a fee of 0, fails closed with HTTP 503 before
  any points are deducted. Per-wallet and global daily caps are unchanged. Residual (documented):
  already signed vouchers are immutable and a later fee reduction can invalidate them.
- `security:` With `CHAIN_ID=1` the points backend refuses to start unless `FEE_ROUTER_ADDRESS` is the
  canonical FeeRouterV1 `0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a` (case-insensitive); production
  startup also requires router bytecode and a matching `eip712Domain()`. CI proves a production image
  with the Sepolia router refuses to start.
- `docs:` Points README, `DEPLOY.md`, `docs/RAILWAY_ENV.md` and the tokenomics wiki state that a
  voucher waives the FeeRouter protocol (swap) fee up to the current on-chain fee (currently 5 bps,
  0.05%) and never the IFR transfer fee or burn. The deploy docs listed the Sepolia FeeRouter
  (`0x4992…9aa4`) as the mainnet value; they now name `0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a`.
- `security:` A failed fee read logs only a constant category (`rpc_error:timeout|network|rate_limited|bad_response|unknown`,
  `fee_error:not_configured|wrong_chain|out_of_range`) and no wallet; raw error text, URLs and keys never reach the log.

### Tests

- `test/PointsVoucherParity.test.js` (Hardhat, real FeeRouterV1 at 5 bps): a backend-format voucher
  at the configured discount is accepted and the fee is waived; 15 bps reverts with "Discount
  exceeds fee"; after `setFeeBps(3)` the capped voucher is accepted and an uncapped 5 bps one
  reverts; a 0 bps fee yields no discount.
- Points unit tests: discount cap, fee cache and failure handling, and route checks that an
  unreadable or zero fee issues no voucher and deducts no points; failures carrying API-key,
  credential-URL, address and free-text sentinels log exactly the constant category.

Release: needs a points-backend release via the Codex gate.

## [Unreleased] — 2026-10-06 — Web3/Wiki polish and Copilot SDK version (T-287, T-269, T-276)

### Fixed

- `fix:` Web3 (`docs/web3/index.html`, T-287): on phones (680 px and narrower, measured at
  305/320/375 px) the hero body text, the full-width access-panel buttons and the panel
  footnote scrolled under the fixed Copilot launcher in every wallet state. The hero copy
  now gets the same 60 px right clearance as the hero buttons and wallet labels; the panel
  buttons and footnote get 40 px (the panel already sits 35 px inside the viewport edge).
  Below 401 px the panel button labels may wrap, so "Loans (borrowing closed)" no longer
  widens the hero column (keeps the T-285 guarantee). Heading, eyebrow and status-card notes
  are unchanged.
- `fix:` Wiki wallet guide (`docs/wiki/wallet-guide.html`, T-269): a 42-character address in
  `<code>` (LP token) widened the single-column card track by 5 px at 375 px, and at 320 px
  the nowrap "Staged Governance" badge did the same. Card `<code>` values now wrap anywhere
  and card heads wrap the badge under the name.
- `fix:` Wiki LendingVault (`docs/wiki/lending-vault.html`, T-276): the page-load market read
  and the connect-triggered read could overlap and interleave their writes to the shared
  borrow-offer list (duplicate or reordered options, 4 instead of 2). Each load now takes a
  request token, collects offers locally and renders only if it is still the newest load.
- `fix:` Copilot dev prompt (`apps/ai-copilot/src/context/system-prompts.ts`) and
  `docs/llms.txt`: the IFR SDK is stated as v0.3.0 (the `apps/sdk` manifest version)
  instead of the stale v0.2 / v0.2.0.

### Tests

- `test:` `tests/browser/web3-write.spec.js`: T-287 fab-clearance at 305/320/375 in the
  connected and degraded (read RPC on the wrong chain) states — hero copy and footnote text
  boxes and all panel buttons end left of the launcher band, no horizontal overflow.
  `tests/browser/fab-clearance.spec.js`: the same check for the disconnected page.
- `test:` `tests/browser/wiki-shell.spec.js`: wallet-guide cards stay inside their grid and
  `main` has no horizontal overflow at 320/375/390.
- `test:` `tests/browser/lending-retired.spec.js`: with delayed `getOffer` reads, overlapping
  market loads render offers #0 and #1 exactly once.
- `test:` `apps/ai-copilot/scripts/test-copilot-correctness.ts`: no prompt, the knowledge
  object or `docs/llms.txt` may state "SDK v0.2"; every "SDK vX.Y" mention must match the
  manifest version.

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
