# IFR Benefits Network App Architecture

Status: active implementation and production handover plan
Domain: `https://shop.ifrunit.tech`
Scope: customer and seller app for IFR locked-access benefits

## Product Goal

`shop.ifrunit.tech` is the commerce surface for Inferno Protocol. It must be understandable for a first-time customer and useful for a seller at checkout.

The app has two roles:

- Customer: connect wallet, see ETH/IFR status, lock IFR directly in the shop app, present a short-lived checkout pass or scan a compatible seller QR, approve the exact offer, receive benefit.
- Seller: create benefit rules, scan and bind a customer pass or create a compatible seller QR, verify locked IFR, redeem approved benefit once.

## Current Implemented Base

- Frontend: `apps/benefits-network/frontend`
- Backend: `apps/benefits-network/backend`
- Wallet stack: Wagmi v3 + Viem with injected, Coinbase and optional WalletConnect QR connectors
- Production wallet boundary: customers connect self-custodied external wallets. New-wallet
  guidance hands off to a trusted wallet app; the production Benefits app does not create,
  import, custody or store wallet keys.
- On-chain access sources: per-rule `IFRLock`, active non-unlocked `TIME_ONLY`
  `CommitmentVault` tranches, or either full threshold without cross-source addition, plus an
  optional free-wallet IFR balance threshold. The backend verifies selected vault token identity
  against the configured IFR token and pins all required reads to one block. Price-conditioned
  CommitmentVault tranches never qualify.
- Rule model: `BenefitRule`
- Session model: `Session` with optional `benefitRuleId` and additive one-to-one `CustomerPass`
- Recommended customer-presented QR flow:
  1. Customer signs a server-issued one-time `Create Checkout Pass` challenge.
  2. Backend atomically consumes it and returns an opaque, five-minute `/p/:passId` QR plus a random control token. Only the SHA-256 token hash is stored; wallet, token, signature and session ID are absent from the QR.
  3. Seller opens `/b/:businessId`, selects an active rule, scans/pastes the pass and signs a one-time `passes:bind` challenge bound to pass and rule.
  4. Backend atomically rechecks current owner/operator access, claims the unexpired pass, freezes the rule snapshot and creates one linked `Session`.
  5. Customer privately receives seller, product, discount, accepted lock source and optional
     free-wallet IFR details through the control token, then explicitly signs the exact session
     challenge.
  6. Backend requires the recovered signer to equal the wallet that created the pass and atomically binds the pending session to one wallet before the source-aware on-chain check.
  7. Seller sees approval and redeems once. Customer may cancel only while the pass is open or its linked checkout is still pending.
- Compatible seller-issued QR flow:
  1. Seller opens `/b/:businessId`.
  2. Seller selects active benefit rule.
  3. Frontend requests and signs a one-time `sessions:create` challenge bound to seller wallet, business and selected rule, then calls `POST /api/sessions` with the nonce.
  4. Customer scans the seller QR in `/scan`, selects a local QR image, pastes the proof link/session ID, or opens `/r/:sessionId` directly.
  5. Customer signs challenge.
  6. Backend checks the frozen lock source and, when configured, the free wallet IFR balance against the frozen
     selected-rule thresholds.
  7. Seller sees approval and redeems the session once.
- Pass QR copying is not authorization: a copied pass can at most be bound once. It cannot approve eligibility or redeem without the original customer wallet's second signature and a currently authorized seller signature.
- Public proof-link polling is deliberately minimal and non-cacheable: it never exposes the
  recovered customer address, exact lock amount or detailed rejection reason. The signing
  customer receives details in the direct attest response; seller operational details remain
  in owner-wallet-protected history.
- Customer proof history:
  - Customer proof pages save a redacted local browser history entry after session load/refresh.
  - Home shows the local section `Recent proofs on this device` for reopening checkout proofs.
  - Stored data is local-only and excludes private keys, seed phrases, signatures and full wallet inventories.
  - A separate `My benefits` account history uses a server-issued one-time wallet signature and a
    memory-only ten-minute read token to load the signer's verified sessions across devices.
  - Account history is snapshot/cursor-paginated, bounded to 50 rows per API call and excludes
    wallet addresses, signatures, nonces, audit logs, proof URLs and seller-only data.
- Help surface:
  - The IFR Copilot is available as an opt-in floating panel and loads only after the user opens it.
  - The assistant is read-only, cannot initiate wallet transactions and must never request a seed phrase or private key.

## UX Requirements

### Home / App Hub

- Explain that this is the IFR Benefits Network; `$IFRp` remains the social cashtag.
- Show customer and seller role selector.
- Show PWA install flow and mobile guidance.
- Describe offline support as a launcher shell for role choice and static guidance. API, wallet,
  chain, signature, checkout and redemption actions remain network-only and fail explicitly
  while offline. Direct seller/scanner links use a branded precached recovery page and never
  expose raw framework errors.
- Show wallet status for customers.
- Show seller rule manager for sellers.
- Show integration/code generator for shops.
- Link to Web3 terminal for lock/swap actions.
- Link to IFR Unit for protocol-level context.

### Customer Flow

- Connect as many wallets as practical through EIP-1193/EIP-6963 injection and WalletConnect.
- Use the same provider-aware connector policy in customer, seller and checkout surfaces: prefer
  a real injected provider, otherwise Coinbase Wallet SDK, then configured WalletConnect; retain
  an explicit connector chooser and readable failure guidance.
- Show wallet, IFR balance, ETH balance and locked IFR.
- Explain that signing a QR proof does not move tokens.
- Let a connected customer load only their own verified benefit history across devices with one
  explicit read-only signature; clear all account-history state on disconnect or wallet change.
- Keep the audited simple IFRLock approve, lock and unlock flow inside the shop app. Keep swaps as an explicit Uniswap handoff while the IFR pool remains thin.
- Keep camera access opt-in. Decode camera frames and selected images only in the browser, then
  accept only a canonical `https://shop.ifrunit.tech/r/:sessionId` proof. Foreign origins,
  insecure links, credentials, custom ports, query strings, fragments and invalid IDs fail closed.
- Keep paste/session-ID fallback available when camera permission or hardware is unavailable.
- QR session page must show seller, rule, product, optional reference price, discount, required
  locked IFR and any optional free-wallet IFR minimum before signing. Reference prices use exact minor units plus an allowlisted ISO currency,
  are frozen in the signed session snapshot and are never presented as an in-app payment.
- Customer-presented pass must show the exact bound seller/rule on the originating device and require a second explicit signature. Its control token stays out of URLs, QR payloads, logs and local storage; the first-party UI limits restoration to the same browser tab.
- Offer discovery and public seller catalogs show a wallet-local, read-only preview against each
  rule's exact lock source and optional wallet-balance thresholds. `minIFRHeld=0` disables the
  second gate without an additional token RPC read. `either` never combines partial amounts;
  only active `TIME_ONLY` commitments qualify. Disconnect, wrong-chain, loading and
  RPC/configuration failures fail closed; only the backend checkout attestation is authoritative.
- Customers can narrow discovery by a seller-published city, region or `Online` service area.
  This is an exact public-label filter, not customer geolocation: the app requests no customer GPS,
  coordinates, map permission or geocoding service. Seller-entered text is stored and public; the
  first-party UI requires explicit confirmation that it contains no private or street address.

### Seller Flow

- Seller can create and manage profiles, products, rules, operators and reward applications through owner-wallet authorization; every mutation uses a fresh resource-bound one-time challenge.
- Public seller identity includes a short description, canonical HTTPS website, up to eight
  categories and an optional broad service area such as a city, region or `Online`. Owners can
  reload and edit it with their wallet; controlled operator-created profiles can be reopened by
  Business ID with the user-entered admin fallback. Public catalog and offer discovery expose only
  sanitized profile fields and never expose the internal normalized filter key.
- Wallet-owned sellers choose one permanent lowercase public URL during profile creation, or claim
  it later with the dedicated one-time `business:slug` signature. Public catalog, scanner, QR,
  discovery and sitemap links prefer that slug. Existing Business-ID links remain valid, while old
  catalog IDs redirect permanently to the canonical `/s/:slug` URL. Slugs cannot be renamed,
  recycled, reserved-route names, or current CUID-shaped internal IDs.
- Seller can edit discount, category, product/service, required locked IFR, optional minimum IFR
  kept in the customer wallet and QR lifetime through the owner-wallet-signed PATCH flow without
  changing the active/paused state.
- Seller can attach or clear an optional reference price on a catalog item. Amount and currency
  are updated atomically, validated without floating point and remain informational.
- Seller can apply built-in welcome, standard, premium or event templates to the current draft; templates never publish automatically and preserve an explicit catalog binding.
- Seller can open `/b/:businessId` or the equivalent readable `/b/:slug` scanner.
- Scanner must list active rules, accept a canonical `/p/:passId` customer pass and bind the selected rule with a fresh seller signature. The existing seller-issued QR remains available for compatible integrations.
- Scanner must show customer approval/rejection and single-use redeem action.
- Owner can delegate expiring checkout-only access to staff wallets. Operators can verify their role and create/redeem QR sessions, but cannot manage profiles, rules, history or other operators.

### Developer / Integration Flow

- Generate seller scanner links.
- Generate basic HTML button/link snippet.
- Show API payload for rule-bound QR sessions.
- Generate a server-side JavaScript/POS session helper that returns the short-lived customer proof URL.
- Use the signer-neutral `IFRBenefitsClient` in the repository SDK for one-time challenge
  checkout integrations. The versioned tarball is installed with locked `npm ci` and tested
  for CommonJS, ESM named-import interoperability and TypeScript on Node.js 20 and 22;
  public npm publication remains gated by `docs/runbooks/IFR_SDK_NPM_RELEASE.md`, and
  platform-specific plugins remain future release work.

## IFR Wallet Strategy

Do not implement a raw private-key wallet stored in browser localStorage.

Current production connects self-custodied external wallets only. It may guide a new user to
create or import a wallet inside a trusted wallet app, but it does not create or import wallet
keys itself.

Accepted paths:

1. External wallet connectors first:
   - MetaMask, Rainbow, Trust Wallet, Coinbase Wallet, OKX, WalletConnect-compatible wallets.
   - Lowest security risk and fastest path.
2. Embedded wallet provider later:
   - The isolated `apps/benefits-wallet-prototype` lab now uses Coinbase CDP to create an
     exportable EOA on Ethereum Sepolia only. It has no transaction or IFR path and is not linked
     from production.
   - CDP is a prototype selection, not a production commitment. Production remains blocked until
     login, export, second-device recovery, lost-auth, outage, deletion, mobile isolation,
     privacy/legal and independent-security evidence is complete.
   - Privy, Web3Auth, Coinbase Embedded Wallet, Dynamic, or similar.
   - Must support export/recovery, clear custody model, passkey/social login, and no project-side custody.
3. Native IFR Wallet later:
   - Requires separate threat model, encrypted local storage, seed backup UX, biometric/passkey support, recovery warnings, transaction simulation, and external audit.

Rejected path:

- Generating a private key in the browser and storing it unencrypted or weakly encrypted.

## Production Wiring

Required deployment state:

- `shop.ifrunit.tech` serves the Next.js frontend, not the static placeholder.
- Benefits backend has HTTPS origin or reverse proxy under the shop domain.
- Backend `ALLOWED_ORIGINS` includes:
  - `https://shop.ifrunit.tech`
  - `https://web3.ifrunit.tech`
  - `https://ifrunit.tech`
- Frontend env:
  - `NEXT_PUBLIC_API_URL`
  - `NEXT_PUBLIC_CHAIN_ID=1`
  - `NEXT_PUBLIC_IFR_TOKEN_ADDRESS=0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
  - `NEXT_PUBLIC_IFRLOCK_ADDRESS=0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb`
  - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`

If `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is missing, the frontend must show a setup notice instead of using a fake WalletConnect project ID that produces failed external requests.

## Open Build Tickets

1. Benefits Network frontend is deployed at `shop.ifrunit.tech`. **Implemented and live; release `72a12526` passed production health, PWA, desktop and iPad smoke checks on 18 July 2026. Future deployments retain the capacity gate.**
2. Benefits backend is exposed under the shop HTTPS origin. **Implemented with health/readiness smoke coverage.**
3. Seller onboarding supports owner-wallet self-service creation with an anti-spam profile cap. **Implemented; invitation/review policy remains a future governance decision.**
4. Add QR history and audit view for sellers. **Implemented with owner-wallet-protected, snapshot-anchored cursor pagination, restore receipts, activity metrics, incremental older-session loading and a browser-local masked full-history CSV export. The API remains bounded to 50 rows per request, refreshes an expired read authorization when needed and creates no server-side export file. Retention/compliance policy remains future work.**
5. Customer benefit history. **Implemented as both a redacted local recent-proof list and a
   wallet-signed, cross-device `My benefits` history with one-time challenge exchange, memory-only
   read token and snapshot pagination. Physical wallet/device acceptance remains pending.**
6. Add embedded-wallet provider evaluation and decision record. **The decision record now selects
   Coinbase CDP EOA only for an isolated Sepolia lab. The lab compiles and enforces a source-level
   no-transaction/no-IFR boundary; external wallets remain the production baseline and all real
   login, export/recovery, native isolation, device, privacy and independent-security gates remain
   open.**
7. Add POS/plugin snippets to code generator. **Server-side JavaScript/POS helper and repository
   SDK `IFRBenefitsClient` are implemented. The packed artifact is installed with locked
   `npm ci` and tested for CommonJS, ESM named-import interoperability and TypeScript on
   Node.js 20/22. Public npm publication remains blocked by the explicit release checklist;
   platform-specific plugins remain future release work.**
8. Add mobile E2E checks for iPad Safari/Chrome and Android MetaMask browser. **Automated
   desktop/iPad/Android layout, unavailable-camera fallback, strict parser and fake-camera QR
   decoding are implemented. Physical Safari/Chrome/MetaMask acceptance remains pending.**
9. Checkout staff mode with owner-managed expiry/revocation and role-aware audit. **Implemented; live device acceptance remains pending.**
10. Seller product/service catalog and public customer benefit browsing. **Implemented with
    owner-signed soft-archive, cross-business rule protection, exact optional reference prices
    and immutable QR-session snapshots.
    A blocking composed test now builds the real frontend/backend, applies all migrations to a
    disposable SQLite database, seeds through signed seller APIs and verifies the public browser
    flow through the production Next.js API rewrite without Mainnet.**
11. Governance-gated seller reward foundation. **Deployed fail-closed: owner application, live BuilderRegistry/PartnerVault linkage checks, atomic redeem outbox and read-only vesting/claim status. Mainnet currently has no registered builders/partners; dedicated authorized submission remains disabled.**
12. Public seller identity and discovery metadata. **Implemented with owner-signed single-use
    updates, bounded categories, HTTPS-only websites, optional HTTPS seller logos, an optional
    privacy-preserving city/region/Online service-area filter, defensive legacy-data sanitization
    and controlled admin reload by Business ID. External logo images are never fetched by the
    backend; browsers suppress the Shop referrer and use a local seller-initial fallback.**
13. Customer-presented two-phase checkout pass. **Implemented with an additive migration,
    opaque short-lived QR, hashed tab control token, atomic one-seller binding, exact-offer customer
    confirmation, signer equality, cancel-before-approval and replay/race regression coverage.
    The backend migration, customer/seller UI and privacy-safe public projections are live in
    production. Automated browser coverage verifies create, bind, exact-offer confirm and one-time
    redeem; physical device/wallet acceptance remains pending.**
14. Stable public seller URLs. **Implemented with an additive nullable unique slug, exact
    owner-signed create/claim scope, immutable aliases, reserved-name and takeover protection,
    legacy Business-ID compatibility, canonical catalog redirects, slug-aware discovery/QR/backup
    paths and sitemap entries. Production deployment remains gated by tests, exact-head CI,
    rollback backup and device smoke.**

## Security Notes

- Never expose `ADMIN_SECRET` in public docs, Bridge, screenshots or client bundles.
- Seller admin secret must remain user-entered or be replaced by proper seller auth.
- QR sessions must remain short-lived and single-use.
- A QR must never be treated as wallet ownership or eligibility. Customer-presented passes require
  separate customer creation and exact-offer confirmation signatures; linked session challenge and
  attest endpoints reject the public legacy path.
- Every seller mutation must remain bound to a persisted random nonce, wallet, action, business and exact resource scope; read-only seller actions must not create challenge rows.
- Challenge text must include rule metadata so the user signs exactly what is being verified.
- Production logs must avoid storing full signatures unless required for audit and retention is defined.
- Shop and API responses suppress framework disclosure and enforce tested MIME, framing,
  referrer and browser-permission policies. The Shop also enforces low-risk CSP protection for
  base URLs, objects, framing and form targets. The broader script, style, image, connection,
  worker, frame and manifest policy remains Report-Only until production WalletConnect and the
  physical wallet/device matrix prove that Coinbase, WalletConnect, camera and PWA flows stay
  compatible; the blocking browser gate rejects observed policy violations and `unsafe-eval`.
