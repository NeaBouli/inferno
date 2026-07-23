# IFRp Commerce App - Master Architecture

Status: active implementation; M1/M2 core, M3 and the fail-closed M4 foundation are deployed, while M4 governance activation and M5 remain incremental.

## 1. Product Goal

Build an installable IFRp commerce app where a person can act as:

- `Customer`: create or connect an IFR wallet, hold ETH/IFR, swap ETH to IFR, lock IFR, and present a QR proof for discounts or access.
- `Seller`: register a business, configure products/services and discount rules, scan a customer QR proof, verify IFR lock/holding status, and grant the configured benefit.

The long-term product should work as both:

- native-style installable PWA from the browser;
- future App Store / Play Store wrapper if needed.

Potential public surfaces:

- `web3.ifrunit.tech`: wallet and direct protocol actions.
- `shop.ifrunit.tech`: seller/customer commerce web app and admin console.
- `ifrunit.tech`: main protocol/landing/wiki surface.

## 2. Existing Foundation

The repository already contains a useful base:

- `apps/benefits-network/backend`
  - businesses
  - verification sessions
  - QR session flow
  - wallet signature challenge
  - IFRLock on-chain check
  - redeem status
- `apps/benefits-network/frontend`
  - Next.js PWA shell
  - merchant route `/b/:businessId`
  - customer route `/r/:sessionId`
  - QR generation
- `apps/sdk`
  - exact 9-decimal IFR access helpers
  - Mainnet-only contract configuration
  - signer-neutral, one-time-challenge Benefits checkout client
  - local repository package; npm publication remains a separate release gate
- `docs/BUSINESS_ONBOARDING.md`
- `docs/PARTNER_INTEGRATION_SPEC.md`
- `PartnerVault`
  - partner rewards and lock-triggered reward accounting
- `BuilderRegistry`
  - verified builder registry
- `IFRLock`
  - simple refundable access lock
- `CommitmentVault`
  - advanced tranches, currently time-only safe path

The master architecture extends this base instead of replacing it.

## 3. User Roles

### Customer

Primary jobs:

1. Install/open app.
2. Create or connect an Ethereum wallet.
3. Get ETH.
4. Swap ETH to IFR.
5. Lock IFR in IFRLock or CommitmentVault.
6. Scan or open a seller-issued QR proof.
7. Filter available benefits by a seller-published service area and review history and lock status.

Customer app must be simple enough for non-crypto users:

- plain balances;
- clear lock status;
- direct "Get IFR" flow;
- no contract terminology unless expanded;
- no seed phrase shown casually;
- recovery/security guidance during wallet setup.

### Seller

Primary jobs:

1. Install/open app or `shop.ifrunit.tech`.
2. Create seller profile.
3. Add a public description and HTTPS website, choose up to eight categories, and optionally
   publish a broad city, region or `Online` service area without a street address.
4. Add products/services.
5. Configure discount/access rules.
6. Scan customer QR.
7. See verified result and apply discount.
8. Track scans, redemptions, and estimated reward eligibility.

Seller must not need crypto knowledge at point of sale.

## 4. Core Flows

### 4.1 Customer Onboarding

```text
Open app
  -> choose Customer
  -> create embedded wallet or connect external wallet
  -> show ETH and IFR balances
  -> prompt: buy/swap IFR if balance is low
  -> prompt: lock IFR for benefits
  -> show seller QR scanner
```

Wallet options:

- MVP: external wallet connection through WalletConnect / MetaMask / Coinbase / Trust.
- Current web fallback: injected EVM providers plus official mobile browser-launch links for
  MetaMask, Trust Wallet, OKX and Phantom. Customer, seller and checkout entry points verify that
  an announced injected connector has a real provider before selecting it, otherwise they fall
  back to Coinbase Wallet SDK and then configured WalletConnect. Users can also choose any exposed
  connector explicitly. A launch link is onboarding only and is not proof of connection;
  WalletConnect breadth remains configuration-gated.
- V1: embedded wallet using a battle-tested wallet provider.
- V2: account abstraction / gas sponsorship for selected actions.

Hard rule: the app must never custody or log private keys.

### 4.2 ETH -> IFR Swap

MVP:

- deep-link to Uniswap or existing Web3 buy flow;
- show IFR token address clearly;
- show risk/liquidity warning while pool is thin.

V1:

- embedded swap widget using a reputable DEX aggregator or Uniswap flow;
- route ETH -> IFR;
- slippage shown before transaction;
- no hidden fees.

### 4.3 Lock IFR

Two lock contexts:

- `IFRLock`: simple access lock, refundable, best for app benefits.
- `CommitmentVault`: advanced commitment tranches, time-only currently safe.

Customer UI should start with IFRLock:

```text
Choose benefit level
  -> app shows required IFR
  -> approve IFR if needed
  -> lock IFR
  -> QR proof becomes eligible
```

Do not expose CommitmentVault price-condition locks until a V2/PriceLockVault exists.

### 4.4 Customer QR Proof

The QR must not be a static wallet address or reusable eligibility credential. The recommended
flow uses an opaque, five-minute `https://shop.ifrunit.tech/p/:passId` customer pass. The QR contains
no wallet, signature, rule, lock balance, control token or internal session ID. A separate random
control token stays on the customer's originating browser tab, and only its SHA-256 hash is stored.

Two-phase verification:

1. Customer signs a one-time pass-creation challenge.
2. Seller scans the pass, selects an active rule and signs a one-time `passes:bind` challenge scoped
   to the exact pass and rule.
3. Backend atomically rechecks owner/operator access, claims the pass once and freezes the rule in a
   linked `Session`.
4. Customer reviews seller, product, discount and required IFRLock on the originating device and
   signs the exact linked session challenge.
5. Backend requires the signer to equal the pass-creation wallet, atomically binds the pending
   session to that wallet and checks IFRLock on-chain.
6. Seller redeems once.

The previous seller-issued `https://shop.ifrunit.tech/r/:sessionId` flow remains implemented as a
compatible fallback. The in-app `/scan` route decodes it locally and fails closed on foreign or
modified URLs. Public challenge/attest endpoints reject sessions created from a customer pass, so a
leaked linked session ID cannot bypass the customer's private confirmation path.

Compatible seller-QR verification:

1. Seller owner or active checkout operator signs a server-issued one-time `sessions:create` challenge bound to wallet, business and selected rule; the backend atomically consumes it while rechecking current access and creating the scan session.
2. Customer signs the session challenge.
3. Backend verifies signature.
4. Backend reads on-chain IFR balance/lock state.
5. Backend evaluates seller benefit policy.
6. Seller screen shows `APPROVED` or `REJECTED` and the selected benefit.
7. Seller redeems session once.

This prevents screenshots/replay from being enough.

All seller-side mutations use the same security boundary: request a random
server-issued challenge bound to wallet, action, business and exact target
resource, sign it, then submit the nonce once. Read-only seller actions stay
timestamp-signed without persisting a challenge row.

### 4.5 Seller Benefit Rules

The deployed seller rule model configures:

- category;
- product/service name;
- discount percent;
- fixed benefit text;
- minimum IFR locked in IFRLock;
- per-wallet daily/monthly redemption limits;
- redemption TTL;
- staff notes.

Example:

```text
Coffee shop
  Bronze: 1,000 locked IFR -> 5% discount
  Silver: 2,500 locked IFR -> 10% discount
  Gold: 5,000 locked IFR -> 15% discount
```

### 4.6 Seller Rewards From Partner Pool

The seller reward mechanism must be governance-safe.

Existing relevant contract:

- `PartnerVault.recordLockReward(partnerId, lockAmount, wallet)`

Recommended route:

1. Seller applies and is approved as a partner.
2. Governance registers seller/builder in BuilderRegistry and PartnerVault.
3. Backend becomes an authorized caller only after governance approval.
4. When a qualifying customer lock is verified for that seller, backend records reward once per `(wallet, partnerId)`.
5. Rewards vest through PartnerVault.
6. Seller claims vested IFR.

Do not automate PartnerVault rewards for unverified sellers.

## 5. System Architecture

```text
Customer PWA / App
  - wallet connect / embedded wallet
  - ETH/IFR balances
  - swap
  - lock IFR
  - QR proof

Seller PWA / App
  - seller onboarding
  - catalog/rules
  - scanner
  - redemption history
  - reward status

shop.ifrunit.tech
  - same app shell
  - seller dashboard
  - customer proof flow

Benefits API
  - business profiles
  - product categories
  - benefit rules
  - sessions and nonces
  - signature verification
  - on-chain reads
  - redemption audit log
  - optional PartnerVault reward writer

Ethereum Mainnet
  - IFR token
  - IFRLock
  - CommitmentVault
  - PartnerVault
  - BuilderRegistry
  - LendingVault later, not needed for first commerce MVP
```

## 6. Proposed Data Model

Extend the existing Benefits Network model.

### Seller

```text
id
ownerWallet
name
slug
logoUrl
website
description
status: draft | pending_review | active | suspended
categories[]
partnerId bytes32 optional
builderRegistryWallet optional
createdAt
updatedAt
```

### ProductOrService

```text
id
sellerId
title
description
category
active
basePrice optional
currency optional
createdAt
updatedAt
```

### BenefitRule

```text
id
sellerId
productId optional
label
discountBps
benefitText
minIFRHeld
minIFRLocked
lockSource: ifrlock | commitment_time_only | either
ttlSeconds
dailyWalletLimit
monthlyWalletLimit
active
createdAt
updatedAt
```

### VerificationSession

```text
id
sellerId
productId optional
benefitRuleId
nonce
expiresAt
status: PENDING | APPROVED | REJECTED | REDEEMED | EXPIRED
customerWallet
ifrLockedRaw
signature
reason
redeemedAt
createdAt
updatedAt
```

### RewardEvent

```text
id
sellerId
partnerId
customerWallet
lockAmountRaw
txHash optional
status: pending | submitted | confirmed | skipped | failed
reason
createdAt
updatedAt
```

## 7. API Surface

MVP endpoints:

```text
POST /api/sellers
GET  /api/sellers/:id
PATCH /api/sellers/:id

POST /api/sellers/:id/products
PATCH /api/products/:id

POST /api/sellers/:id/rules
PATCH /api/rules/:id

POST /api/sessions
GET  /api/sessions/:id
GET  /api/sessions/:id/challenge
POST /api/attest
POST /api/sessions/:id/redeem

GET /api/wallet/:address/status
GET /api/sellers/:id/rewards
```

Admin/governance endpoints must require strong auth and never be public.

## 8. App UX

### First Screen

```text
What do you want to do?

[Customer]
Use IFR benefits, lock tokens, show QR

[Seller]
Offer benefits, scan customers, manage products
```

Users can switch modes later.

### Customer Home

- wallet status;
- ETH balance;
- IFR balance;
- locked IFR;
- benefit tier;
- get/swap IFR;
- lock IFR;
- show QR;
- nearby/available sellers later.

### Seller Home

- scan customer;
- today's redemptions;
- active products/services;
- discount rules;
- seller reward status;
- staff mode.

### Seller Rule Builder

Use guided controls:

- category selector;
- product/service selector;
- discount slider;
- minimum IFR locked in IFRLock input;
- preview result.

## 9. Security Model

Critical rules:

- No private keys in backend.
- QR proofs expire quickly.
- Customer must sign every verification challenge.
- Redeem is one-time per session.
- Per-rule daily and monthly limits are enforced per customer wallet on UTC calendar boundaries.
- Limit values are frozen into each QR session; later rule edits cannot change an issued checkout.
- Concurrent redemption attempts serialize before counting usage, so a limit cannot be overrun by two counters.
- Rate limits per seller and wallet.
- Every seller mutation requires a resource-bound one-time authorization nonce; read-only seller actions remain stateless and timestamp-bound.
- Seller staff can scan/redeem through owner-managed checkout wallets but cannot change owner wallet, profile, rule, history, delegation or reward settings.
- Reward writes to PartnerVault only after seller is governance-approved.
- Admin actions must be audited.
- PII should be avoided. Wallet address and redemption history are enough for MVP.

Replay protection:

- nonce per session;
- expiration;
- signature bound to domain, seller, sessionId, and chainId; **canonical Shop domain implemented**
- redeemed sessions cannot be reused.

Suggested challenge message:

```text
IFRp Benefit Verification
Domain: shop.ifrunit.tech
Chain ID: 1
Seller: {sellerId}
Session: {sessionId}
Nonce: {nonce}
Expires: {expiresAt}
Wallet: {wallet}
```

## 10. Contracts And Governance

Use existing contracts for MVP:

- IFR token for balances.
- IFRLock for simple access lock.
- CommitmentVault for time-only lock status if needed.
- BuilderRegistry for verified sellers/builders.
- PartnerVault for partner rewards after governance approval.

Possible future contracts:

- `MerchantRegistry`: if seller registry needs to be on-chain.
- `BenefitPolicyRegistry`: if benefit rules must be public/on-chain.
- `RewardDistributor`: if PartnerVault authorized caller should be narrowed to a dedicated adapter.

MVP should keep benefit rules off-chain for speed and UX, while verification stays anchored in on-chain lock/balance state.

## 11. Deployment Plan

### Subdomain

Recommended:

- `shop.ifrunit.tech` for the commerce app.

Infrastructure options:

- reuse existing Hetzner + Traefik pattern;
- separate container:
  - `inferno-shop-frontend`
  - `inferno-shop-api`
- environment:
  - `SHOP_API_URL`
  - `MAINNET_RPC_URL`
  - `IFR_TOKEN_ADDRESS`
  - `IFRLOCK_ADDRESS`
  - `COMMITMENT_VAULT_ADDRESS`
  - `PARTNER_VAULT_ADDRESS`
  - `BUILDER_REGISTRY_ADDRESS`
  - `DATABASE_URL`
  - `ADMIN_SECRET`
  - `ALLOWED_ORIGINS=https://shop.ifrunit.tech,https://web3.ifrunit.tech`

### PWA

MVP should be installable:

- manifest;
- service worker;
- offline shell;
- network-first API calls;
- home-screen icon;
- iOS install instructions that do not pretend Safari exposes normal install prompts.

## 12. Milestones

### M0 - Architecture And Product Scope

- This document.
- Finalize domain decision.
- External-wallet MVP remains production baseline. Coinbase CDP EOA is selected only for the
  isolated Sepolia lab in `apps/benefits-wallet-prototype`; production provider selection remains
  gated by recovery, real-device, privacy/legal and independent-security evidence.
- Decide whether to extend `apps/benefits-network` or create `apps/commerce-app`.

### M1 - MVP Customer/Seller PWA

- role chooser;
- seller profile/rule CRUD;
- customer wallet connect;
- wallet status;
- IFRLock lock status;
- seller QR session;
- customer signature;
- `APPROVED` / `REJECTED` / one-time `REDEEMED` flow;
- deploy to `shop.ifrunit.tech`.

### M2 - Wallet And Swap UX

- add IFR token; **implemented with connector-bound EIP-747 metadata, configured-chain check and official icon**
- ETH/IFR balance; **implemented in the customer wallet panel**
- Uniswap deep-link or embedded swap widget; **deep-link implemented with visible thin-liquidity, price-impact and slippage warning; embedded swap remains deferred**
- lock IFR from customer app; **implemented as exact-amount approve, lock and full IFRLock unlock,
  with deterministic browser coverage for calldata, receipts and refreshed 9-decimal balances**
- QR proof after lock. **implemented as seller-issued, customer-signed, short-lived session proof,
  with an opt-in in-app camera scanner, local image decoding and manual link/session-ID fallback**

### M3 - Seller Catalog And Categories

- product/service CRUD; **implemented with owner-signed create/edit/soft-archive**
- public seller profile; **implemented with owner-signed description, HTTPS website and bounded categories, plus controlled admin reload for operator-created profiles**
- categories; **implemented for seller management, public catalogs and customer offer discovery**
- per-offer wallet eligibility; **implemented as a read-only, fail-closed IFRLock preview in offer
  discovery and public catalogs; checkout attestation remains authoritative**
- rule templates; **four one-tap seller templates implemented as review-before-save drafts; product binding remains explicit, with owner-signed publication for wallet-owned profiles and the controlled admin fallback otherwise**
- staff scanner mode; **implemented with owner-managed, expiring checkout operators and atomic role-audited redeem**
- redemption history. **implemented as owner-protected snapshot/cursor pages, metrics, receipts,
  incremental older checks and a browser-local masked full-history CSV; long-term retention policy
  remains separate**
- per-wallet redemption limits. **implemented per rule for UTC day/month with immutable session snapshots, atomic enforcement and audited denials**
- customer benefits history. **implemented as a wallet-signed, cross-device `My benefits` view
  with single-use challenge exchange, memory-only read access, signer-bound snapshot pagination
  and a separate local offline recent-proof list**

### M4 - Verified Seller Rewards

- governance approval workflow; **seller application and admin live-verification flow deployed fail-closed; no Mainnet seller is approved yet**
- BuilderRegistry/PartnerVault linkage; **runtime checks require aligned Governance owner/admin, active builder, active partner and matching beneficiary**
- authorized reward caller; **read-only authorization check implemented; no signer or automated transaction path enabled**
- reward event queue; **atomic redeem outbox plus idempotent reconciliation implemented; events remain blocked until caller authorization**
- PartnerVault record/claim visibility. **owner-only Seller UI reads accrued, vested and claimable state; no claim/write button**

Mainnet read-only evidence on 17.07.2026 at block 25,545,631 showed BuilderRegistry count `0`,
PartnerVault `totalAllocated = 0`, `totalRewarded = 0`, `totalClaimed = 0`, and no configured
reward caller in the Benefits backend. PartnerVault holds 40M IFR, but this is a governed pool,
not an active or promised seller payout. Governance registration, a dedicated authorized adapter
and production deployment remain required before any reward event may be submitted.

### M5 - Native Wrapper / Embedded Wallet

- evaluate Expo/Capacitor wrapper;
- embedded wallet provider; **Coinbase CDP EOA selected for the separate Sepolia-only lab in
  `apps/benefits-wallet-prototype`; fail-closed config, isolated export and source-level no-
  transaction boundary are implemented. External wallets remain the production baseline;
  provider login/export/recovery and the full real-device/security matrix remain unproven.**
- push notifications;
- biometric unlock;
- optional gas abstraction.

## 13. Main Risks

### Wallet UX Risk

Non-crypto users can get lost at seed phrases, gas, swaps, and signatures.

Mitigation:

- start external wallet MVP;
- later add embedded wallet only with mature provider and recovery model;
- clear copy and one-action screens.

### Fraud And Replay Risk

QR screenshots and repeated discounts can be abused.

Mitigation:

- short TTL sessions;
- signed challenge;
- server-side redemption;
- wallet and seller rate limits.

### Partner Reward Abuse

Sellers could fake scans or encourage meaningless lock loops.

Mitigation:

- rewards only for governance-approved sellers;
- one reward per wallet/partner;
- PartnerVault caps and vesting;
- manual audit for early partners.

### Liquidity / Swap Risk

Pool is still thin.

Mitigation:

- clear slippage warning;
- do not hide DEX/liquidity risk;
- avoid aggressive in-app swap defaults until pool is deeper.

## 14. Recommended Next Step

Start with a scoped MVP on top of `apps/benefits-network`:

1. Rename product surface to IFRp Commerce / Benefits App in docs only.
2. Add role chooser.
3. Add seller rule builder.
4. Add customer wallet status and IFRLock status.
5. Deploy preview under `shop.ifrunit.tech`.
6. Only after the MVP works, decide embedded wallet and PartnerVault automation.
