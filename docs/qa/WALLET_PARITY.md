# Wallet connection browser parity (JUL-11)

Run from the repository root with Node 22. This is an optional local check;
it is not part of required CI or the Benefits release preflight.

## Preparation and execution

```sh
npm ci
npm --prefix apps/benefits-network/frontend ci
npx playwright install chromium webkit
NEXT_TELEMETRY_DISABLED=1 \
NEXT_PUBLIC_CHAIN_ID=1 \
NEXT_PUBLIC_API_URL= \
NEXT_PUBLIC_ETHEREUM_RPC_URL=https://ethereum-rpc.publicnode.com \
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=1234567890abcdef1234567890abcdef \
  npm --prefix apps/benefits-network/frontend run build
npm run test:wallet-parity
```

The project ID above is a synthetic, syntactically valid fixture, not a live
Reown credential. Use this build only with this offline harness. The project ID
and chain are baked into Next.js client assets: changing the environment at
`next start` cannot enable WalletConnect in an already built frontend. An
existing integrated production build can also be tested, provided it targets
chain 1 and includes the WalletConnect connector. Missing WalletConnect fails
the test rather than skipping pairing coverage. No backend or real wallet is
required. The script starts and stops its own servers on unused loopback ports.

The Web3 server reproduces the release mapping documented in
`scripts/web3-release.cjs`: `/` serves `docs/web3/index.html`, other assets come
from `docs/`, and response headers come from
`infra/web3/web3-security-headers.conf`. This tests the Web3 app, not the apex
landing page and its separate wallet runtime. Benefits uses the actual
`.next` production build through `next start`, including its enforced and
report-only CSP headers. Neither CSP is removed or relaxed. Service workers
are blocked so each fresh context loads the current assets.

## Assertions and offline boundaries

The full matrix has 24 fresh contexts: Web3 and Benefits, Chromium and WebKit,
1440 x 1000 desktop and 390 x 844 mobile emulation, with three scenarios:

- No provider: open the wallet chooser and verify unavailable injected wallets
  are absent. Web3 offers WalletConnect; Benefits also offers Coinbase SDK.
- WalletConnect: announce distinct MetaMask, Phantom EVM and Coinbase providers
  using EIP-6963, plus legacy provider discovery. Require their wallet buttons
  and WalletConnect, select WalletConnect, and wait for a visible SDK QR code
  with a valid `wc:` v2 URI or Web3's visible mobile launch link containing one.
  The generic instructional text mentioning `wc:` does not satisfy the check.
- Injected connection: expose one EIP-1193 MetaMask mock with chain ID 1 and one
  synthetic account, select it, require an account-access request, and assert the
  account's shortened address and Disconnect control appear. The mock initially
  reports no authorized accounts, so automatic reconnection cannot pass this case.

For each surface, viewport and scenario, the complete sorted button labels,
including duplicates, must match between engines. This compares the same
provider environment across engines; the two products need not offer identical
connectors. Phantom is required when its synthetic EVM provider is present.
Unsupported-wallet badges and marketing text do not count as chooser options.

The harness keeps the actual application scripts, lazy SDK imports and QR
rendering. It routes public read RPC, Benefits readiness/discovery reads, modal
configuration, empty remote wallet listings, images and relay WebSockets to
local fixtures. Relay subscribe/publish acknowledgements let the real SDK
generate pairing material; no wallet approves the encrypted session proposal.
Unknown requests, unsupported RPC methods and unexpected WebSockets fail and
never reach upstream. Remote wallet catalog availability/order is not tested.

All console errors, unhandled page errors and `securitypolicyviolation` events
(including report-only events) fail, without an error allowlist. Monitoring
starts before app scripts and continues through a 1.5-second observation period
after success; this is not a long-duration telemetry test. Both enforced CSP
headers and Benefits' report-only header must be present. A browser launch or
server failure, missing engine, empty chooser, missing pairing output or missing
account UI produces a nonzero exit code. A partial run never counts as parity.

The structured report is written to `test-results/wallet-parity/report.json`
(gitignored), with case results, exact wallet choices and diagnostics. Pairing
URIs and relay authentication query parameters are redacted; QR images and full
pairing keys are not saved. Review failed-case diagnostics in this report.

To check the fixture boundaries without launching browsers:

```sh
node --check scripts/test-wallet-parity.mjs
npm run test:wallet-parity -- --self-test
```

This self-test verifies read-only RPC enforcement, relay acknowledgement
boundaries and fail-closed missing-option/engine checks. It is not evidence that
either integrated browser UI passed. The full test requires browser binaries
matching the pinned Playwright version and a host that permits child browser
processes and loopback servers. Sandbox launch failures must be reported as
blocked; do not mark the unexecuted matrix as passed.

## Remaining physical-device acceptance

The manual matrix remains
[`BENEFITS_DEVICE_WALLET_CHECKLIST.json`](BENEFITS_DEVICE_WALLET_CHECKLIST.json),
with recording instructions in the
[device wallet runbook](../runbooks/BENEFITS_DEVICE_WALLET_TEST_RUNBOOK.md).
This automated check does not mark any physical-device row as passed.

Real MetaMask, Phantom, Coinbase and other wallet apps/extensions, actual QR
scanning and pairing approval, origin allowlists/project credentials on Reown,
relay availability, deep links, universal links, mobile OS handoff, installed
PWAs, device camera permissions, signatures, transactions, chain switching,
session expiry/reconnect and customer-proof redemption remain outside this test.
The mobile viewport and user agent exercise responsive/mobile code paths; they
do not reproduce physical Safari, Android Chrome or an in-app wallet browser.

Complete the pending iOS/iPadOS and Android matrix rows with real device and
wallet versions and physical evidence. Repeat the Web3 connection/QR/handoff
steps on the same devices because the checklist primarily tracks Benefits.
