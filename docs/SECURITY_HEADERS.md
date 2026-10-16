# Public web security headers

JUL-09 / CWA-10: repository serving-policy map and bounded hardening. This map
describes checked-in delivery paths, not a live DNS, TLS or production-header
attestation. Changes require the normal release process to reach the public sites.

## Surfaces and header ownership

| Surface | Delivery path and repository evidence | Policy owner |
| --- | --- | --- |
| `https://ifrunit.tech/` and `/wiki/` | GitHub Pages publishes `docs/`; `docs/CNAME` names the apex. `docs/index.html` and `docs/wiki/*.html` are static documents. See `WEB3_SITE_RELEASE.md` for the Pages/container distinction. Pages configuration is external; there is no Pages deployment workflow in this repository. | HTML can set an early meta CSP and a referrer meta policy. GitHub Pages controls HTTP response headers. |
| `https://web3.ifrunit.tech/` | Traefik terminates HTTPS in front of the external `web3-site` nginx container. `scripts/deploy-web3-site.sh` and `scripts/web3-release.cjs` ship the `docs/` tree, root discovery files and `.nginx/web3-security-headers.conf`. The host nginx config must include `/usr/share/nginx/html/.nginx/web3-security-headers.conf`; the deploy script fails if it does not. | `infra/web3/web3-security-headers.conf` sets response headers with `always`. The container Dockerfile, Traefik router and enclosing nginx config are host-managed, not under `apps/` in this repository. |
| `https://shop.ifrunit.tech/` (IFR Benefits) | Traefik fronts the Next.js standalone frontend built by `apps/benefits-network/frontend/Dockerfile`. The production Compose example defines the frontend/backend services; live routing is external. `/api/*` is rewritten server-side to the Benefits backend. | `apps/benefits-network/frontend/next.config.js`, `headers()` on `/:path*`, sets headers for frontend responses and the API rewrite. Backend-only internal URLs do not belong in the browser CSP. |
| `https://copilot-api.ifrunit.tech/` and `/api/*` | Traefik fronts `apps/ai-copilot/Dockerfile`, which runs `tsx server/index.ts`. Express serves the inline chat document at `/` and the JSON API. Pages, Web3 and Benefits embed that chat in cross-origin iframes. | `apps/ai-copilot/server/security-headers.ts`, applied before CORS, JSON parsing and routes in `server/index.ts`. |
| Optional Copilot Vite SPA | `apps/ai-copilot/vercel.json` builds `dist/` and rewrites `/api/*` to the Copilot API. This is a separate delivery option, not the Express chat document. `server/Dockerfile` is an older alternative and is not used by the root Copilot Dockerfile. | The Vercel configuration sets the same baseline headers and embedding allowlist; its bundled scripts need only `script-src 'self'`. No current hostname is inferred for this optional deployment. |

An upstream proxy must preserve these headers. Multiple CSP headers and meta
policies intersect; a permissive proxy policy cannot relax a restrictive app
policy. nginx drops inherited `add_header` directives when a nested location
defines its own: include the file again in such a location. Responses generated
by Traefik itself require proxy-level headers and are outside the app configs.

## Owned-server policies

All owned configurations set an enforced CSP, HSTS `max-age=63072000` (two years),
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a
Permissions-Policy disabling microphone, geolocation, payments and USB. Web3
also disables camera and Bluetooth. Benefits retains `camera=(self)` because
its customer/seller QR scanners use `getUserMedia`; its decoder uses a bundled
blob worker, so the staged policy retains `worker-src 'self' blob:`.

Web3 and Benefits preserve their existing HSTS value
`max-age=63072000; includeSubDomains` from `origin/main`; this change does not
weaken their subdomain coverage. Copilot HSTS remains host-scoped. No owned
configuration adds `preload`. Browsers honor HSTS only over HTTPS; Traefik owns
TLS termination and HTTP-to-HTTPS routing.

Web3 and Benefits deny framing using both `X-Frame-Options: DENY` and CSP
`frame-ancestors 'none'`. Copilot must instead accept its exact HTTPS parents:
the apex, `www.ifrunit.tech`, `web3.ifrunit.tech`, `shop.ifrunit.tech`, and the
documented GitHub Pages origin `neabouli.github.io`, plus its own origin.
Copilot deliberately omits X-Frame-Options: neither DENY nor SAMEORIGIN can
express this cross-origin iframe contract. Its browser connects only to its
own API. Anthropic, Etherscan and RPC requests made by the Node server are
server-to-server traffic and do not need browser CSP permissions.
Express uses small JSON fallbacks for unknown routes and uncaught errors;
parser error statuses such as 400/413 are preserved without exposing error
details. This prevents Express's default finalhandler from replacing the CSP
on those responses and dropping the embedding directive.

The strict production policies staged for Web3/Benefits and enforced for
Copilot allow no `unsafe-eval`, arbitrary connection schemes, wildcard hosts
or third-party scripts. Web3's enforced baseline still permits its existing
WalletConnect/Web3Modal wildcard hosts; Benefits' enforced baseline does not
restrict scripts or connections. Inline scripts remain allowed in the strict
policies on Web3 (inline initialization and handlers), Benefits (App Router hydration and
JSON-LD), and the Express chat (inline script and handlers). Inline styles
support the existing documents and wallet modal components. This retains an
inline-injection residual; nonce/hash migration is separate work.

The only eval exception is **Benefits development mode**
(`NODE_ENV=development`). Next 15's
`next/dist/build/webpack/config/blocks/base.js` selects its
`eval-source-map-dev-tool-plugin.js`, which emits `eval()`-wrapped modules.
Existing wallet browser harnesses run `next dev`. Its script directive
therefore adds `unsafe-eval` only to the report-only policy in that mode.
Production and unspecified environments exclude it from the staged policy;
the enforced baseline is identical in all modes. The static gate checks both
branches. Development servers must not be used as public production servers.

Benefits replaces its old report-only policy with the strict candidate;
broad report-only connection permissions `https:`/`wss:` are removed.
`img-src https:` remains necessary because `BusinessLogo.tsx`
accepts arbitrary HTTPS seller-logo URLs; it grants no script or connection
permission. No COOP/COEP restriction is added: Coinbase's smart-wallet popup
uses `postMessage` and must retain its opener relationship.

## Staged rollout and exact enforcement step

**Current stage:** Web3 and Benefits keep `Content-Security-Policy` exactly
equal to their respective `origin/main` baselines (reviewed at `5e7d7154`).
Benefits enforces only `base-uri 'self'; object-src 'none'; frame-ancestors
'none'; form-action 'self'`. Web3 retains its existing full policy, including
the wallet wildcard hosts. The new strict policies are sent only as
`Content-Security-Policy-Report-Only`; Benefits' previous report-only value is
replaced. Report-only violations can be inspected in browser developer tools;
no remote reporting endpoint is configured.

**Enforcement gate:** complete and pass the JUL-11 real-wallet device matrix,
including WalletConnect pairing/cancel/reconnect and Coinbase SDK popup/relay
flows. Use `docs/runbooks/BENEFITS_DEVICE_WALLET_TEST_RUNBOOK.md` and
`docs/qa/BENEFITS_DEVICE_WALLET_CHECKLIST.json` for device evidence and also
exercise Web3's WalletConnect flow on real devices. Offline checks and emulated
wallets do not satisfy JUL-11. Resolve candidate-policy violations required by
those flows before promotion; strict enforcement remains deferred until then.

After JUL-11 passes, make the following explicit follow-up change:

1. In `apps/benefits-network/frontend/next.config.js`, change only the enforced
   header entry to
   `{ key: 'Content-Security-Policy', value: contentSecurityPolicyReportOnly }`.
   Retain the report-only entry with that same value.
2. In `infra/web3/web3-security-headers.conf`, replace only the quoted value of
   `add_header Content-Security-Policy` with the exact quoted value of
   `add_header Content-Security-Policy-Report-Only`. Keep both entries and
   their `always` qualifiers.
3. Update the frozen-baseline assertions in `scripts/test-web3-headers.cjs`
   and `scripts/test-security-headers.cjs` to require enforced/report-only
   equality with the validated strict policies. Preserve HSTS
   `max-age=63072000; includeSubDomains` on both surfaces. Run the focused
   header/wallet checks and the Benefits release preflight; then use the
   separately authorized deployment process and repeat the real-wallet smoke
   checks against the served production policies.

## Wallet resource evidence

| Resource | Allowed destinations | Evidence |
| --- | --- | --- |
| Web3/Mainnet reads | `https://ethereum-rpc.publicnode.com`, `https://eth.drpc.org`, `https://1rpc.io` | `RPC_URLS` in `docs/web3-wallet-core.js` and `docs/assets/wallet-core.js`; `/eth` on 1rpc is covered by its origin. |
| Benefits reads | `https://ethereum-rpc.publicnode.com`, `https://ethereum-sepolia-rpc.publicnode.com`, configured HTTPS RPC origin | `apps/benefits-network/frontend/src/lib/wagmi.ts`. The public RPC build variable contributes only its URL origin to CSP, never its credentials/path/query. |
| Optional external Benefits API | Configured `NEXT_PUBLIC_API_URL` HTTPS origin | `frontend/src/lib/api.ts`; the default uses the same-origin API rewrite. Changing build-time RPC/API destinations requires rebuilding the frontend and its headers. |
| WalletConnect relay | `https://relay.walletconnect.org`, `wss://relay.walletconnect.org` | Pinned provider Core relayer constant. HTTPS covers relay transport fallback. |
| WalletConnect RPC and modal/explorer | `https://rpc.walletconnect.org`, `https://api.web3modal.org` | Pinned provider `BLOCKCHAIN_API_RPC_URL` and `W3M_API_URL`; wallet catalog/icons use the modal API origin. |
| WalletConnect verification | `https://verify.walletconnect.com`, `https://verify.walletconnect.org` in connect/frame directives | Pinned Core Verify constants include both origins and the `/v3` path. |
| Wallet modal fonts/images | `https://fonts.reown.com`; Web3 also retains Google Fonts stylesheet/font origins, its own IFR icon origin and the modal API image origin | Vendored provider font table; Web3 HTML and wallet metadata icons. Benefits uses the same Reown font origin. |
| Coinbase (Benefits) | `https://www.walletlink.org`, `wss://www.walletlink.org`, `https://rpc.wallet.coinbase.com` | Coinbase Wallet SDK 4.3.6 `dist/core/constants.js`, `WalletLinkHTTP.js`, and `WalletLinkWebSocket.js` (HTTPS relay URL is converted to WSS). `keys.coinbase.com/connect` opens a top-level popup, so it does not need frame/connect permission on the parent document. |

Web3 loads the committed, self-contained
`docs/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js`. Benefits
pins Ethereum Provider 2.23.10, AppKit Common 1.8.19 and Coinbase Wallet SDK
4.3.6 in its lockfile. The SDK paths above were inspected read-only in locally
installed packages with matching SDK versions; no remote documentation or
live endpoint was consulted. The static gate pins those versions for review
on upgrades and extracts relay/RPC/verify/modal origins from the committed
provider rather than relying solely on a duplicate hardcoded list.

Deep links to MetaMask, Trust Wallet, Coinbase, OKX and Phantom, plus external
Uniswap/explorer links, are navigations, not browser fetches: they do not need
`connect-src`. Optional email/social-login origins (`secure.walletconnect.org`),
push notifications (`echo.walletconnect.com`), and telemetry
(`pulse.walletconnect.org`, Coinbase CCA) are not wallet-flow permissions.
Benefits disables SDK telemetry explicitly; Web3's strict candidate excludes
optional telemetry, although its enforced baseline still permits matching
wildcard destinations. Adding such features requires a new source review.

## Accepted GitHub Pages residual

The apex, all 40 current Wiki documents and the Pages `/web3/` copy set an early
meta CSP with `base-uri 'self'; object-src 'none'; form-action 'self'`, followed
by `<meta name="referrer" content="no-referrer">`, before resource tags.
These documents contain no base/object/embed elements or external form actions;
the static gate verifies that condition. This additive policy deliberately
leaves existing scripts, styles, RPC calls and embedded chat unrestricted by
meta CSP, avoiding an unverified shared resource allowlist across legacy pages.
The Web3 container copy additionally receives its full response-header policy.

**Accepted residual for this patch:** GitHub Pages offers no repository-controlled
response-header configuration. HSTS, X-Frame-Options, `frame-ancestors`, nosniff
and Permissions-Policy cannot be implemented via these meta tags. Pages may set
some platform headers itself, but this patch makes no guarantee about them.
The meta CSP does not provide complete script/connect restriction or framing
protection, and only applies after the browser parses it. Other static HTML
outside these entrypoints is not covered by this meta-policy change. JUL-09 /
CWA-10 must retain this explicit hosting residual rather than claim all
public responses are fully hardened.

Full header control requires either a Cloudflare proxy with reviewed response
header rules in front of Pages, or routing the apex/Wiki through Traefik to a
controlled static server. Both options require separate DNS/TLS configuration,
reviewed resource policies, cached-response checks and wallet/chat smoke tests.
No proxy, DNS, certificate, Pages configuration or deployment is changed here.

## Verification and release limits

`npm run test:web3-headers` runs the existing nginx contract and
`scripts/test-security-headers.cjs` in Docs Validator CI. Its triggers cover the
serving configs and wallet source/lockfile. The offline aggregate checks required
headers, exact enforced baselines, preserved HSTS subdomain coverage, staged
production eval/wildcard exclusions, custom RPC/API origins, both verify
frames, camera/blob-worker compatibility, Copilot embedding, all Pages meta
policies, and mutation cases for missing headers/new RPCs/broadened policies,
premature enforcement and weakened HSTS.
Copilot CI's existing `test:surface-ui` script also runs an in-process Express
test of the shipping header/error middleware on 200, 400, 404, 413 and 500
responses, without opening a network listener.

Before release, run the focused wallet/RPC, routing, Wiki-head, Copilot and
Benefits CSP checks plus `npm run preflight:benefits`. After an authorized
deployment, inspect actual HTTPS headers on successful/error/asset/API paths,
verify nginx location inheritance, and exercise injected wallets, WalletConnect
pair/cancel/reconnect, Coinbase popup/relay, QR scanning and embedded Copilot.
Offline static evidence cannot establish live TLS, pairing, signatures or proxy
behavior; it must not be reported as that evidence.
