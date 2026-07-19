# IFR SDK

Repository SDK for exact 9-decimal IFR access checks and signer-neutral Benefits checkout
sessions. The package currently supports Ethereum Mainnet only.

## Availability

The SDK is not yet published to the npm registry. From the Inferno repository root:

```bash
npm install --install-links ./apps/sdk
```

The repository includes the generated package entrypoints and CI verifies that they match the
TypeScript source. `--install-links` makes npm install the folder as a packed dependency instead
of a symlink, so its runtime dependencies resolve correctly.

The canonical REST API is:

```text
https://copilot-api.ifrunit.tech/api/ifr/check
```

## Benefits Checkout

`IFRBenefitsClient.createCheckout()` requests a one-time `sessions:create` challenge bound to
the seller wallet, business and benefit rule. The caller supplies a wallet-native `signMessage`
callback; the SDK never accepts or stores private keys, seed phrases or persistent seller secrets.

## Verification

```bash
cd apps/sdk
npm ci
npm test
npm audit --audit-level=moderate
npm pack --dry-run
```
