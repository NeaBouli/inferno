# IFR SDK

Repository SDK for exact 9-decimal IFR access checks and signer-neutral Benefits checkout
sessions. The package currently supports Ethereum Mainnet only.

## Availability

The SDK is not yet published to the npm registry. Publication is prepared: a release tag
`sdk-v<version>` on a reviewed `main` commit runs `.github/workflows/sdk-publish.yml`, which checks the
release gate, waits for owner approval, tests the package and publishes it with npm provenance from the
project npm account through npm Trusted Publishing. Until then, build and pack the versioned artifact
from the repository:

```bash
cd apps/sdk
npm ci
npm run build
npm pack --ignore-scripts
```

Add the resulting `.tgz` path to the consuming application's `package.json` and committed
lockfile, then use `npm ci`.

## Contract Addresses

`MAINNET_ADDRESSES` lists deployed contracts. `commitmentVault` is CommitmentVault V1: its
price-conditioned tranches can never unlock, so applications must not create new locks there;
existing time tranches stay unlockable through V1. `commitmentVaultV2` is CommitmentVault V2
(TIME_ONLY); it accepts new time locks once Governance proposal #17 (its fee exemption) has executed.
`lendingVault` is the retired LendingVault V1 with borrowing permanently disabled.

The tarball exports CommonJS with tested ESM named-import interoperability and supports Node.js
20 and 22. CI verifies the exact package contents, installs the locked tarball with `npm ci`, and
runs fresh CommonJS, ESM-import and TypeScript consumers.

The canonical REST API is:

```text
https://copilot-api.ifrunit.tech/api/ifr/check
```

## Benefit Tiers

`DEFAULT_TIERS` is the project's default preset and matches the Benefits network: IFR **locked in
IFRLock** only, Bronze 1,000 / Silver 2,500 / Gold 5,000 / Platinum 10,000.

```js
const { IFRClient, DEFAULT_TIERS, getBenefitTierFromRaw } = require("ifr-sdk");
const client = new IFRClient();
const tier = await client.getBenefitTier(wallet);            // default preset
const own = await client.getBenefitTier(wallet, [            // your own model
  { key: "fan", name: "Fan", minLocked: "100" },
  { key: "vip", name: "VIP", minLocked: "2000" },
]);
```

- The tiers are a **default preset and label set, not a rule**. In the Benefits network every partner
  sets its own thresholds, minimum held IFR, lock source (IFRLock, CommitmentVault time locks or
  either), discount and daily/monthly limits per benefit.
- Any project may verify IFR permissionlessly with its own rule, for example a hold-based check with
  its own discount, following the open verification profile `ifr-benefits-verify/1`.
- Discounts are independent of partner rewards. PartnerVault rewards follow Lane 4 model B and are
  available only to approved pilot partners; they are currently disabled.
- `getBenefitTier` reads IFRLock only and fails closed: a failed read throws instead of reporting 0.
- `TIER_THRESHOLDS`, `TIER_NAMES`, `getTier`, `getTierFromRaw` and the `tier` fields of `checkAccess` are
  the deprecated legacy hold+lock access tiers (balance + locked, 500 / 2,000 / 10,000). They remain
  for compatibility and are removed in 1.0.

## Read Errors

The SDK never turns a failed on-chain read into `0` or `false`. If a read fails, `checkAccess`, `getTier`,
`getBenefitTier`, `getLockedBalance` and `isBuilder` reject with `IFRReadError` (its `read` field names the
failed call, `cause` holds the original error). Treat it as "could not verify", not as "nothing locked" or
"not a builder".

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

Publication follows the release checklist in `docs/runbooks/IFR_SDK_NPM_RELEASE.md`.
