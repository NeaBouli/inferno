# IFR SDK

Repository SDK for exact 9-decimal IFR access checks and signer-neutral Benefits checkout
sessions. The package currently supports Ethereum Mainnet only.

## Availability

The SDK is not yet published to the npm registry. Repository consumers build and pack the
versioned artifact first:

```bash
cd apps/sdk
npm ci
npm run build
npm pack --ignore-scripts
```

Add the resulting `.tgz` path to the consuming application's `package.json` and committed
lockfile, then use `npm ci`. Do not treat the repository package as a registry release.

The tarball exports CommonJS with tested ESM named-import interoperability and supports Node.js
20 and 22. CI verifies the exact package contents, installs the locked tarball with `npm ci`, and
runs fresh CommonJS, ESM-import and TypeScript consumers.

The canonical REST API is:

```text
https://copilot-api.ifrunit.tech/api/ifr/check
```

## Benefits Checkout

`IFRBenefitsClient.createCheckout()` requests a one-time `sessions:create` challenge bound to
the seller wallet, business and benefit rule, then creates the session.
`IFRBenefitsClient.getCheckoutStatus(sessionId)` polls `GET /api/sessions/:id` and fail-closed
validates the public status response (`PENDING`, `APPROVED`, `REJECTED`, `REDEEMED`, `EXPIRED`).
`IFRBenefitsClient.redeemCheckout({ sessionId, walletAddress, signMessage })` requests a fresh
one-time `sessions:redeem` challenge bound to the session ID and posts the signed redemption to
`POST /api/sessions/:id/redeem`; it resolves only after the API confirms `REDEEMED`.

Both signed flows validate action, business, wallet, scope, timestamp, nonce and the exact
challenge message before any signature is requested. The caller supplies a wallet-native `signMessage`
callback; the SDK never accepts or stores private keys, seed phrases or persistent seller secrets.

## Verification

```bash
cd apps/sdk
npm ci
npm test
npm run test:package
npm audit --audit-level=moderate
npm pack --dry-run
```

Publication remains blocked until the release checklist in
`docs/runbooks/IFR_SDK_NPM_RELEASE.md` is complete.
