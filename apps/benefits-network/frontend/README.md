# IFR Benefits Network — Frontend

Next.js 14 PWA for the IFR Benefits Network.

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Customer/Seller role chooser, wallet status, seller rule manager |
| `/b/:businessId` | Merchant Console — select seller rule, start verification, show QR, approve/redeem |
| `/r/:sessionId` | Customer Flow — connect wallet, review selected benefit, sign challenge, show result |

## Setup

```bash
cp .env.local.example .env.local
npm install
npm run dev        # → http://localhost:3000
```

Backend must be running on `localhost:3001` (API proxy via Next.js rewrites).

## Environment

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_CHAIN_ID=1
NEXT_PUBLIC_IFR_TOKEN_ADDRESS=0x77e99917Eca8539c62F509ED1193ac36580A6e7B
NEXT_PUBLIC_IFRLOCK_ADDRESS=0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
```

The public shop defaults to Ethereum Mainnet. `NEXT_PUBLIC_CHAIN_ID=11155111` can still be used for Sepolia testing if matching testnet contract addresses are supplied.

`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is required for production wallet UX. Without it, the app shows a setup notice instead of firing failed WalletConnect requests.

## Tech Stack

- Next.js 14 (App Router)
- React 18 + TypeScript
- Tailwind CSS (IFR brand colors)
- wagmi v2 + viem (wallet connection)
- react-qr-code (QR generation)
- PWA (manifest.json + service worker)

## Seller Rules

The Seller mode panel can create wallet-owned seller profiles and persist
benefit rules with short-lived wallet signatures. The normal seller path
requires:

- Seller wallet connection
- Signed seller action message
- Business ID after profile creation
- Rule label, category, product/service, discount, required locked IFR, QR TTL

Saved active rules are visible in the seller scanner route. The scanner binds the
next QR session to the selected rule, and the customer verification screen shows
the rule-specific product, discount, and required IFR lock before signing.

Connected sellers can load the active seller profiles owned by their wallet and
the app remembers the last selected Business ID locally for reloads. This is only
a convenience cache; ownership is still enforced by the backend signature check.

The admin bearer secret is still available in the UI as an operator fallback for
controlled setup and recovery. Do not use the global admin secret as a public
seller credential.

## PWA

Installable on iOS and Android. Service worker caches static assets (cache-first)
and uses network-first for API calls.
