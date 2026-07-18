# IFR Benefits Network — Frontend

Next.js 14 PWA for the IFR Benefits Network.

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Customer/Seller role chooser, wallet status, seller rule manager |
| `/guide` | Customer, seller and developer operating guide for the live shop flow, including session history |
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

`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` enables the full WalletConnect/RainbowKit modal for compatible mobile wallets. Without it, the app intentionally falls back to browser-injected Ethereum wallets such as MetaMask and Coinbase Wallet instead of blocking the customer proof flow. On iOS/iPadOS and Android, the fallback also exposes official HTTPS wallet-browser launch links for MetaMask, Trust Wallet, OKX and Phantom. Coinbase and Rainbow remain on the injected-provider or Copy/Share path until the WalletConnect project is configured.

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

## Tech Stack

- Next.js 14 (App Router)
- React 18 + TypeScript
- Tailwind CSS (IFR brand colors)
- wagmi v2 + viem (wallet connection)
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

Saved active rules are visible in the seller scanner route. The scanner binds the
next QR session to the selected rule, and the customer verification screen shows
the rule-specific product, discount, and required IFR lock before signing.

Connected sellers can load the active seller profiles owned by their wallet and
the app remembers the last selected Business ID locally for reloads. This is only
a convenience cache; ownership is still enforced by the backend signature check.

Connected sellers can also load recent session history for the selected Business
ID. This uses the same seller wallet signature model and shows checkout status,
verified customer wallet, locked amount, rejection reason, redeem time and the
rule/default benefit attached to each QR session.

The admin bearer secret is still available in the UI as an operator fallback for
controlled setup and recovery. Do not use the global admin secret as a public
seller credential.

## PWA

Installable on iOS and Android. Service worker caches static assets (cache-first)
and uses network-first for API calls.

## Live Smoke

Run the repo-level read-only smoke before and after public Shop deploys:

```bash
npm run smoke:benefits
BENEFITS_BASE_URL=http://localhost:3000 npm run smoke:benefits
SCREENSHOT_DIR=/Users/gio/Desktop npm run smoke:benefits
```

The smoke checks `shop.ifrunit.tech` by default: API health/readiness, PWA
manifest, PWA icons, service worker, server-issued seller auth challenge,
desktop landing, iPad landing, public system-readiness UI, guide page,
wallet-entry fallback and the seller scanner shell.
It does not create sellers, rules, QR sessions or wallet transactions.

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
