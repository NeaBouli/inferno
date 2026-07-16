# IFRp Shop Benefits App Architecture

Status: draft implementation plan
Domain: `https://shop.ifrunit.tech`
Scope: customer and seller app for IFR locked-access benefits

## Product Goal

`shop.ifrunit.tech` is the commerce surface for Inferno Protocol. It must be understandable for a first-time customer and useful for a seller at checkout.

The app has two roles:

- Customer: connect wallet, see ETH/IFR status, lock IFR through the Web3 terminal, scan or open seller QR sessions, sign proof, receive benefit.
- Seller: create benefit rules, open scanner, choose a rule, create short-lived QR sessions, verify locked IFR, redeem approved benefit once.

## Current Implemented Base

- Frontend: `apps/benefits-network/frontend`
- Backend: `apps/benefits-network/backend`
- Wallet stack: RainbowKit + Wagmi + WalletConnect
- On-chain access source: `IFRLock.lockedBalance` and backend `IFRLock.isLocked`
- Rule model: `BenefitRule`
- Session model: `Session` with optional `benefitRuleId`
- QR flow:
  1. Seller opens `/b/:businessId`.
  2. Seller selects active benefit rule.
  3. Frontend calls `POST /api/sessions` with `businessId` and optional `benefitRuleId`.
  4. Customer opens `/r/:sessionId`.
  5. Customer signs challenge.
  6. Backend checks IFRLock against the selected rule threshold.
  7. Seller sees approval and redeems the session once.
- Customer proof history:
  - Customer proof pages save a redacted local browser history entry after session load/refresh.
  - Home shows `Recent customer proofs` for reopening checkout proofs on the same device.
  - Stored data is local-only and excludes private keys, seed phrases, signatures and full wallet inventories.

## UX Requirements

### Home / App Hub

- Explain that this is the IFRp Shop / Benefits Network.
- Show customer and seller role selector.
- Show PWA install flow and mobile guidance.
- Show wallet status for customers.
- Show seller rule manager for sellers.
- Show integration/code generator for shops.
- Link to Web3 terminal for lock/swap actions.
- Link to IFR Project for protocol-level context.

### Customer Flow

- Connect as many wallets as practical through RainbowKit/WalletConnect.
- Show wallet, IFR balance, ETH balance and locked IFR.
- Explain that signing a QR proof does not move tokens.
- Keep the audited simple IFRLock approve, lock and unlock flow inside the shop app. Keep swaps as an explicit Uniswap handoff while the IFR pool remains thin.
- QR session page must show seller, rule, product, discount and required IFR before signing.

### Seller Flow

- Seller can create and manage rules through guarded admin API.
- Seller can edit discount, category, product/service, required IFR and QR lifetime through the owner-wallet-signed PATCH flow without changing the active/paused state.
- Seller can open `/b/:businessId` scanner.
- Scanner must list active rules and bind the selected rule to the next QR session.
- Scanner must show customer approval/rejection and single-use redeem action.

### Developer / Integration Flow

- Generate seller scanner links.
- Generate basic HTML button/link snippet.
- Show API payload for rule-bound QR sessions.
- Generate a server-side JavaScript/POS session helper that returns the short-lived customer proof URL. Packaged SDK/plugin examples remain future work.

## IFR Wallet Strategy

Do not implement a raw private-key wallet stored in browser localStorage.

Accepted paths:

1. WalletConnect/RainbowKit first:
   - MetaMask, Rainbow, Trust Wallet, Coinbase Wallet, OKX, WalletConnect-compatible wallets.
   - Lowest security risk and fastest path.
2. Embedded wallet provider later:
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

1. Replace static `shop.ifrunit.tech` placeholder with deployed Benefits Network frontend.
2. Deploy or expose Benefits backend with HTTPS and production env.
3. Add seller onboarding: create business from UI through a safer invitation/admin flow.
4. Add QR history and audit view for sellers. **Implemented for owner-wallet-protected recent sessions, restore receipts and activity metrics; export/retention policy remains future work.**
5. Customer saved proof history locally without storing private data server-side. **Implemented for redacted QR proof history; benefit wallet/device acceptance still pending.**
6. Add embedded-wallet provider evaluation and decision record.
7. Add POS/plugin snippets to code generator. **Server-side JavaScript/POS session helper implemented; packaged SDK and platform-specific plugins remain future work.**
8. Add mobile E2E checks for iPad Safari/Chrome and Android MetaMask browser.

## Security Notes

- Never expose `ADMIN_SECRET` in public docs, Bridge, screenshots or client bundles.
- Seller admin secret must remain user-entered or be replaced by proper seller auth.
- QR sessions must remain short-lived and single-use.
- Challenge text must include rule metadata so the user signs exactly what is being verified.
- Production logs must avoid storing full signatures unless required for audit and retention is defined.
