# IFR Benefits Network — Frontend

Next.js 14 PWA for the IFR Benefits Network.

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Customer/Seller role chooser, wallet status, seller rule preview |
| `/b/:businessId` | Merchant Console — start verification, show QR, approve/redeem |
| `/r/:sessionId` | Customer Flow — connect wallet, sign challenge, show result |

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

`NEXT_PUBLIC_CHAIN_ID=11155111` can still be used for Sepolia testing if matching testnet contract addresses are supplied.

## Tech Stack

- Next.js 14 (App Router)
- React 18 + TypeScript
- Tailwind CSS (IFR brand colors)
- wagmi v2 + viem (wallet connection)
- react-qr-code (QR generation)
- PWA (manifest.json + service worker)

## PWA

Installable on iOS and Android. Service worker caches static assets (cache-first)
and uses network-first for API calls.
