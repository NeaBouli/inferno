# IFR Benefits Network — Frontend

Next.js 14 PWA for the IFR Benefits Network.

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Landing page |
| `/b/:businessId` | Merchant Console — start verification, show QR, approve/redeem |
| `/r/:sessionId` | Customer Flow — connect wallet, sign challenge, show result |

## Setup

```bash
cp .env.local.example .env.local
npm install
npm run dev        # → http://localhost:3000
```

Backend must be running on `localhost:3001` (API proxy via Next.js rewrites).

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
