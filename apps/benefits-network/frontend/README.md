# IFR Benefits Network — Frontend

Next.js 15 PWA for the IFR Benefits Network.

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Customer/Seller role chooser, wallet status, seller rule manager |
| `/guide` | Customer, seller and developer operating guide for the live shop flow, including session history |
| `/b/:businessId` | Seller Console — scan/paste customer pass, bind selected rule, or create compatible seller QR; redeem once |
| `/p/:passId` | Privacy-minimal seller handoff for a customer-presented checkout pass |
| `/r/:sessionId` | Customer Flow — connect wallet, review selected benefit, sign challenge, show result |
| `/scan` | Customer QR entry — opt-in camera, local image scan or manual proof link/session ID |

## Setup

```bash
cp .env.local.example .env.local
npm ci
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

`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` enables the Wagmi WalletConnect QR connector for compatible mobile wallets. Without it, the app intentionally falls back to browser-injected Ethereum wallets such as MetaMask and Coinbase Wallet instead of blocking the customer proof flow. On iOS/iPadOS and Android, the fallback also exposes official HTTPS wallet-browser launch links for MetaMask, Trust Wallet, OKX and Phantom. Coinbase and Rainbow remain on the injected-provider or Copy/Share path until the WalletConnect project is configured.

Wallet launch targets are always reduced to an HTTPS path on
`https://shop.ifrunit.tech`; foreign origins and query strings are discarded
before a wallet link is generated.

The landing page includes a public `System readiness` card. It checks `/api/ready`,
confirms Ethereum Mainnet (`chainId: 1`) and exposes whether WalletConnect was
configured at build time. It does not expose secrets or server internals.

The customer wallet panel includes a `Recommended next step` block for the
approve/lock path. It derives the next action from connection state, configured
contracts, entered IFR amount, unlocked IFR balance and allowance, then guides
the user toward Buy IFR, Approve or Lock. Tier chips are buttons that set common
lock amounts for seller benefit rules.

The recommended checkout path is customer-presented and two-phase. A connected customer signs a
one-time pass-creation message and displays an opaque `/p/:passId` QR. The seller scans or pastes it,
selects an active rule and signs a fresh pass/rule-bound authorization. The customer then reviews
the exact seller, product, discount and IFRLock threshold on the originating device and signs the
confirmation. The QR contains no wallet or reusable eligibility proof. Its random control token is
kept only in the same browser tab (`sessionStorage` for refresh recovery), never in the URL or
durable `localStorage`; only its SHA-256 hash is stored by the backend.

Public offer discovery can be filtered by a seller-published city, region or `Online` service
area. The exact seller-entered text is stored and public, so the app requires an explicit
confirmation that it contains only a broad area and no private or street address. Customers are
never asked for GPS access. Profiles without a service area remain discoverable through `All areas`.

`My benefits` combines two deliberately separate histories. The redacted recent-proof list stays
local to the current browser for offline checkout recovery. A connected customer can additionally
sign one read-only message to load their verified benefit history across devices. The resulting
ten-minute access token remains in React memory only; it is cleared on disconnect or account
change, and older pages stay bound to the original wallet and snapshot.

`Add IFR to wallet` uses the active Wagmi connector first and never falls back
to a different injected wallet while a connector is active. It requests the
configured chain, then submits the EIP-747 token metadata with the canonical
IFR address, 9 decimals and official HTTPS icon. Wallets without automatic
asset import can use the displayed contract address. Every Buy IFR path keeps
the Uniswap price-impact and user-controlled slippage warning visible.

## Tech Stack

- Next.js 15 (App Router)
- React 18 + TypeScript
- Tailwind CSS (IFR brand colors)
- Wagmi v3 + Viem (injected, Coinbase and optional WalletConnect QR connectors)
- react-qr-code (QR generation)
- PWA (manifest.json + service worker)

## Seller Rules

The Seller mode panel can create wallet-owned seller profiles and persist
benefit rules with server-issued, short-lived wallet signatures. The normal seller path
requires:

- Seller wallet connection
- Signed seller action message
- Business ID after profile creation
- Rule label, category, product/service, discount, required locked IFR, QR TTL

Saved active rules are visible in the seller scanner route. The scanner binds a customer-presented
pass to the selected rule through an opt-in camera, local QR-image parser or paste fallback. The
compatible seller-issued QR path remains available. Both flows freeze the rule-specific product,
discount and required IFR lock before the customer signs.

Connected sellers can load the active seller profiles owned by their wallet and
the app remembers the last selected Business ID locally for reloads. This is only
a convenience cache; ownership is still enforced by the backend signature check.

Connected sellers can page through session history for the selected Business ID.
This uses the same seller wallet signature model and shows checkout status, masked
verified customer wallet, locked amount, rejection reason, redeem time and the
rule/default benefit attached to each QR session. Full CSV export fetches bounded
pages of 50 and creates a masked file only in the browser.

The admin bearer secret is still available in the UI as an operator fallback for
controlled setup and recovery. Do not use the global admin secret as a public
seller credential.

## PWA

Installable on iOS and Android. During service-worker installation, the current
root app shell and its versioned Next.js JavaScript/CSS assets are cached so the
installed role chooser remains usable offline. Same-origin static assets remain
cache-first. API, wallet, checkout and redemption requests stay network-only and
return an explicit offline error instead of serving cached transaction state.

## Live Smoke

Run the repo-level read-only smoke before and after public Shop deploys:

```bash
npm run smoke:benefits
BENEFITS_BASE_URL=http://localhost:3000 npm run smoke:benefits
SCREENSHOT_DIR=/Users/gio/Desktop npm run smoke:benefits
```

The smoke checks `shop.ifrunit.tech` by default: API health/readiness, PWA
manifest, PWA icons, service worker, the stateless read-only seller auth message,
desktop landing, iPad landing, public system-readiness UI, guide page,
wallet-entry fallback and the seller scanner shell.
It does not create sellers, rules, QR sessions or wallet transactions.
Mutating seller actions use separate server-issued, resource-bound one-time
challenges and are covered by backend route tests and the opt-in seller wallet smoke.

## Production Deploy

Use the repo-level deploy helper for `shop.ifrunit.tech`:

```bash
scripts/deploy-benefits-network.sh frontend
```

`frontend` is the default and rebuilds only `inferno-benefits-frontend` with
`docker compose --no-deps`, so UI-only changes do not unnecessarily rebuild the
backend image. The helper syncs `apps/benefits-network/`, checks server disk
space, prunes Docker builder cache when the configured free-space floor is
breached, and prints container/disk status after deploy.

For capacity-only checks, run:

```bash
scripts/deploy-benefits-network.sh capacity
```

The helper keeps `MIN_FREE_GB=4` as the warning floor, `ABORT_FREE_GB=2` as
the emergency hard floor and `DEPLOY_ABORT_FREE_GB=4` as the default hard floor
before any container rebuild. When free space drops below the warning floor, it
prunes safe Docker caches only: builder cache, stopped containers and dangling
images. It does not prune volumes. If free space stays below the deploy floor
after safe pruning, the deploy exits before rebuilding containers.

For the full capacity decision process and latest known large Docker consumers,
see `docs/BENEFITS_CAPACITY_RUNBOOK.md`.

Use `scripts/deploy-benefits-network.sh backend` when backend code, Prisma
schema/migrations or backend dependencies changed. Use `all` only when both
sides need an intentional rebuild.
