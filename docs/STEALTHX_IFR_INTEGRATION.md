# StealthX x IFR Integration Spec

## Current Model

StealthX uses IFR as a holder discount signal for its product checkout flow.
Eligible users verify their wallet in the browser and receive a 50% Stripe
checkout discount for StealthX products.

The previous in-app lock-gating design was removed by the StealthX partner for
technical reasons. Current apps do not require an in-app WalletConnect flow and
do not unlock features directly from an IFR lock state.

## Public Product Scope

| Product | Public status | IFR benefit |
|---|---|---|
| SecureCall | Live StealthX product | 50% checkout discount for eligible IFR holders |
| SecureChat | Live StealthX product | 50% checkout discount for eligible IFR holders |
| Chameleon | StealthX product / builder candidate | 50% checkout discount for eligible IFR holders |

Public references:
- `https://stealthx.tech/`
- `https://stealthx.tech/wiki/ifr-unlock.html`
- `https://stealthx.tech/terms.html`
- `https://securechat.stealthx.tech/`
- `https://chameleon.stealthx.tech/`

## Technical Approach

The StealthX verification flow is read-only:

1. User opens the StealthX browser checkout or IFR unlock page.
2. User connects a wallet for verification.
3. StealthX reads the wallet's IFR balance on Ethereum Mainnet.
4. If the wallet meets the product threshold, StealthX applies a 50% Stripe
   checkout discount.
5. Product activation continues through the normal Stripe/license/activation
   code flow.

No IFR is transferred, burned, staked, or locked by StealthX. StealthX does not
take custody of user tokens and does not need admin keys for IFR contracts.

## Balance Check Example

```js
const ifr = new ethers.Contract(
  "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
  ["function balanceOf(address) view returns (uint256)"],
  provider
);

const balance = await ifr.balanceOf(userWallet);
const eligible = balance.gte(ethers.utils.parseUnits(requiredIFR, 9));
```

## Contract Addresses

| Contract | Mainnet |
|---|---|
| IFR Token | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` |
| Uniswap V2 Pool | `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0` |
| IFRLock | `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` |
| CommitmentVault | `0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3` |

`IFRLock` and `CommitmentVault` remain part of the IFR protocol, but they are
not required for the current StealthX checkout discount flow.

## Threshold Notes

StealthX owns the product thresholds and checkout rules. Public pages currently
describe 50% checkout discounts for eligible holders. SecureChat public copy
shows multiple product-specific thresholds; if those pages disagree, the
StealthX public checkout page is the operational source of truth.

## Advantages

- No in-app wallet dependency.
- No IFR custody.
- Read-only on-chain verification.
- Easy Stripe checkout integration.
- Users keep IFR in their wallet.
- IFR demand is tied to visible product utility.

## Next Steps

- [ ] Keep IFR docs aligned with StealthX public checkout rules.
- [ ] Resolve any public threshold inconsistencies on StealthX pages.
- [ ] Register the relevant StealthX/Chameleon builder entry in IFR
      BuilderRegistry through Governance, if the team wants on-chain builder
      registry visibility.
- [ ] Announce the current model as "IFR holder discount", not "IFR lock
      unlock", unless StealthX reintroduces lock-gating later.
