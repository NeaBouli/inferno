# Public web security headers

JUL-09 / CWA-10: this document maps checked-in serving policies. It is not a live
DNS, TLS or production-header attestation. Host configuration and deployments
require their separate release authorization.

## Surfaces and ownership

| Surface | Delivery | Policy owner |
| --- | --- | --- |
| `ifrunit.tech/` and `/wiki/` | Static `docs/` output on GitHub Pages; apex in `docs/CNAME` | Early HTML meta CSP and referrer policy; HTTP headers are controlled externally by Pages |
| `web3.ifrunit.tech` | Host-managed nginx/Traefik; release scripts ship `docs/` and the nginx include | `infra/web3/web3-security-headers.conf`, included in every relevant location |
| `shop.ifrunit.tech` and `/api/*` | Next standalone frontend and server-side Benefits API rewrite | `apps/benefits-network/frontend/next.config.js`, `headers()` on `/:path*` |
| `copilot-api.ifrunit.tech` | Compatibility hostname for `apps/data-api/Dockerfile`, port 3003 | `apps/data-api/server/security-headers.ts`, applied before CORS, parsing, routes and errors |

The JSON data API returns a service directory at `/` and a 410 tombstone at the
retired chat POST. It enforces `default-src 'none'; frame-ancestors 'none'`,
`X-Frame-Options: DENY`, `base-uri 'none'`, `object-src 'none'` and
`form-action 'none'`. No page embeds this service. Its public hostname is retained
for installed data consumers; migration to a neutral hostname is a later step.
See [retirement and production cutover](COPILOT_CHAT_RETIREMENT.md).

## Headers and resource permissions

Owned configurations retain HSTS `max-age=63072000`, `nosniff`, `no-referrer` and
Permissions-Policy restrictions on microphone, geolocation, payments and USB.
Web3 and Benefits preserve `includeSubDomains`; the data API remains host-scoped.
No configuration adds HSTS preload. Traefik owns TLS termination and redirects.

Web3 and Benefits deny framing with both X-Frame-Options and frame-ancestors.
Their `frame-src` permissions retain WalletConnect verification hosts and no
longer include the retired chat origin. Benefits keeps `camera=(self)` for QR
scanning and `worker-src 'self' blob:` for its bundled decoder.

Etherscan and RPC requests made by the data server are server-to-server traffic;
they do not require browser CSP permissions. The browser wallet, RPC, Coinbase,
Google/Reown font and seller-image allowances retain their existing scope.
No COOP/COEP change is made because Coinbase popup flows need their opener.

## Staged wallet policies

Web3's enforced policy retains the reviewed wallet wildcard hosts, with the
retired frame origin removed. Benefits' enforced baseline remains
`base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'`.
The narrower wallet resource policies remain staged as
`Content-Security-Policy-Report-Only`. This retirement does not promote them to
enforcement or claim completion of the physical wallet acceptance matrix.

Before promotion, reproduce injected-wallet, WalletConnect pair/cancel/reconnect,
Coinbase popup/relay, QR scanner, offline PWA and custom RPC/API flows. Inspect
report-only violations, resolve required origins narrowly, and obtain the normal
release authorization. No remote reporting endpoint is configured.

Multiple CSP headers and meta policies intersect. An upstream proxy must preserve
application headers. nginx locations defining their own `add_header` directives
must include the policy again; otherwise inheritance is lost. Traefik-generated
errors need proxy-level policy and are outside the Express/Next configuration.
Express preserves JSON error status codes, including 400 and 413, and applies the
same security headers to successes, retired routes, 404s and uncaught errors.

## Verification

Run `npm run test:web3-headers`, `npm run test:surface-routing`,
`npm run test:wiki-heads`, `npm run test:data-api-retirement` and the data API's
`npm test`. The header gate reads the actual nginx, Next and Express modules,
checks wallet resource origins and retains mutation checks for missing headers,
new RPC destinations, widened policies, early enforcement and weakened HSTS.
The API tests execute shipping middleware and handlers without a listener.

Before release, run Benefits CSP checks and `npm run preflight:benefits` and inspect
responsive screenshots. After authorized deployment, inspect HTTPS headers on
success/error/asset/API paths and repeat wallet, QR, cache and layout checks.
Offline evidence does not prove live TLS, proxy behavior, pairing or signatures.
