# Changelog

## [Unreleased] — 2026-10-06 — Dependency advisories (T-282)

### Security

- `security:` Benefits backend, AI Copilot and Creator Gateway: `proxy-addr`
  2.0.7 -> 2.0.8 (via `express` 4.22.2, lockfile-only, within express' `~2.0.7`
  range) for GHSA-jqcg-44mw-7w3h (critical, IP spoofing via IPv4-mapped / zero-prefix
  IPv6 trust subnets). The Benefits backend and AI Copilot trust only the named
  ranges `loopback`, `linklocal`, `uniquelocal`; tests show these resolve `req.ip`
  identically on 2.0.7 and 2.0.8 (spoofed `X-Forwarded-For` from untrusted IPv4,
  IPv4-mapped and IPv6 peers is ignored), so the advisory precondition is not met by
  that configuration. Creator Gateway does not enable `trust proxy`.
- `security:` Benefits frontend: `source-map-js` 1.2.1 -> 1.2.2 (via `postcss`,
  lockfile-only) for GHSA-68fv-2mgg-jv7q (high, event-loop DoS via indexed
  source-map offsets). AI Copilot (dev) updated the same way.
- `security:` Benefits frontend and AI Copilot: `postcss-selector-parser` 6.1.4 ->
  7.1.6 via an exact `overrides` pin (Tailwind 3.4 asks for `^6.1.2`; no patched
  6.x exists) for GHSA-rj75-hqrm-r3gf (moderate, dev-only build tooling). The
  PostCSS/Tailwind output (CSS and source map) is byte-identical before and after.
- Dev-advisory gate: reviewed exception for GHSA-hp3w-g68c-fv3c (`sprintf-js`
  <= 1.1.3, no patched release; dev-only via jest coverage tooling, review by
  2026-11-06).

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
