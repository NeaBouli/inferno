# Benefits PWA and data minimization

Status: analysis and proposed design only, 2026-10-17. Source baseline:
`b47245143c0c95c29a55f31d38c81444bea6e39e`, `apps/benefits-network`.
No product changes, migration, retention operation, production inspection or deployment
are part of this document. References describe this checkout, not a verified live release
at `shop.ifrunit.tech`. The three T-231 briefs were historical inputs; their competing
instructions are not evidence that an implementation or production action was accepted.

The [Model B EXT-10 follow-up](#model-b-ext-10-local-follow-up) below records a later local
implementation prerequisite requested on 2026-10-17. It is not evidence of deployment or of
acceptance of a broader customer-identifier exception.

**Recommendation:** continue the existing single, role-aware PWA at
`https://shop.ifrunit.tech`. Customer and seller modes, installation assets and an offline
launcher already exist. Concentrate on verification, explicit retention and accurate
disclosures. Do not introduce a native app or another platform.

**Data boundary:** the current customer proof path processes the wallet and signature
in the request and stores the checkout outcome. It still persists merchant checkout
records, checkout capabilities, seller identities and audit data, and the browser stores
signed customer receipts. This is not zero customer data or anonymity.

Throughout this document, **[PRIVACY REVIEW]** marks a proposal requiring legal/privacy
review before adoption or public promises. Durations below are proposed operational
targets, not approved legal periods. **[OWNER DECISION]** marks a product, economics or
authorization trade-off that this analysis does not resolve.

## 1. Existing capabilities and routes

### Pages and customer flows

All paths in this table are relative to `https://shop.ifrunit.tech`. Page files live
under `apps/benefits-network/frontend/src/app/`.

| Route | Existing capability | Source |
| --- | --- | --- |
| `/`, `/?mode=customer`, `/?mode=seller` | Customer/seller selection; remembers the role locally and honors role-specific anchors. Customer wallet tools, public offer discovery, customer pass, local history and seller workspace share one page. | [page.tsx](../apps/benefits-network/frontend/src/app/page.tsx), [AppShell.tsx](../apps/benefits-network/frontend/src/components/AppShell.tsx) |
| `/s/[businessId]` | Public seller profile, catalog and offers; resolves IDs/slugs and redirects an ID to its claimed slug. Server profile fetch has a 300-second revalidation interval. | [seller page](../apps/benefits-network/frontend/src/app/s/[businessId]/page.tsx), [SellerCatalogClient.tsx](../apps/benefits-network/frontend/src/app/s/[businessId]/SellerCatalogClient.tsx) |
| `/scan` | Customer camera/paste scanner for compatible seller checkout links. | [CustomerQrScannerClient.tsx](../apps/benefits-network/frontend/src/app/scan/CustomerQrScannerClient.tsx), [customerProofLink.ts](../apps/benefits-network/frontend/src/lib/customerProofLink.ts) |
| `/r/[sessionId]` | Customer reads a seller-created checkout, connects a wallet, signs the exact checkout proof and sees the result. | [CustomerSessionClient.tsx](../apps/benefits-network/frontend/src/app/r/[sessionId]/CustomerSessionClient.tsx) |
| `/p/[passId]` | Handoff of an opaque customer-presented pass to the seller; selects the business and opens its checkout console. The originating customer tab retains control. | [CustomerPassHandoff.tsx](../apps/benefits-network/frontend/src/app/p/[passId]/CustomerPassHandoff.tsx), [CustomerCheckoutPass.tsx](../apps/benefits-network/frontend/src/components/CustomerCheckoutPass.tsx) |
| `/b/[businessId]` | Seller checkout console: owner/operator authorization, rule selection, scan/paste a customer pass or display a seller QR, and poll checkout outcome. | [BusinessConsoleClient.tsx](../apps/benefits-network/frontend/src/app/b/[businessId]/BusinessConsoleClient.tsx), [SellerCustomerPassScanner.tsx](../apps/benefits-network/frontend/src/components/SellerCustomerPassScanner.tsx) |
| `/guide`, `/privacy`, `/support` | Usage guidance, technical data disclosure/local clearing controls and self-service diagnostics. Copilot is embedded only after opening it. | [guide](../apps/benefits-network/frontend/src/app/guide/page.tsx), [privacy](../apps/benefits-network/frontend/src/app/privacy/page.tsx), [SupportDiagnostics.tsx](../apps/benefits-network/frontend/src/components/SupportDiagnostics.tsx), [CopilotWidget.tsx](../apps/benefits-network/frontend/src/components/CopilotWidget.tsx) |

`/b/`, `/p/`, `/r/` and `/api/` are excluded in
[robots.ts](../apps/benefits-network/frontend/src/app/robots.ts); the three private page
wrappers also set noindex. These are indexing instructions, not access controls.

### Wallet, proof and redemption

- [wagmi.ts](../apps/benefits-network/frontend/src/lib/wagmi.ts) configures injected
  Ethereum wallets, a Phantom injected connector, Coinbase Wallet and conditional
  WalletConnect. WalletConnect requires a valid 32-hex-character project ID; it is not
  always enabled. Coinbase and WalletConnect initialization is deferred until selected,
  with their configured telemetry switches disabled. Connector availability is not proof
  of successful installation or wallet handoff on every device.
- [WalletConnectControl.tsx](../apps/benefits-network/frontend/src/components/WalletConnectControl.tsx)
  and [WalletStatus.tsx](../apps/benefits-network/frontend/src/components/WalletStatus.tsx)
  implement connection/reconnection, chain recovery, ETH/IFR/IFRLock reads, approve,
  lock/unlock and token display helpers. Transactions are distinct from a checkout's
  off-chain signature. The app uses an external wallet; these components do not create
  or store seed phrases/private keys.
- The wallet's Bronze/Silver/Gold/Platinum guide is **1,000/2,500/5,000/10,000 IFR** in
  IFRLock. It is illustrative, not a global benefit entitlement. Seller rule templates
  include other thresholds, including 500 IFR. The checkout's seller snapshot controls
  eligibility, not the guide label.
- [ifrLockService.ts](../apps/benefits-network/backend/src/services/ifrLockService.ts)
  supports `ifrlock`, `commitment_time_only` and `either`, plus an independent
  `minIFRHeld` balance condition. Default rules use IFRLock. `either` requires one source
  independently to meet the full threshold; partial IFRLock and commitment amounts are
  not combined. Configured CommitmentVault V1/V2 active TIME_ONLY tranches form the
  commitment source. This describes source behavior, not verification of live contracts.
  Preserve bigint/base-unit arithmetic and IFR's nine-decimal conversion.
- [customerPassService.ts](../apps/benefits-network/backend/src/services/customerPassService.ts)
  creates a wallet-free pass with a random ID, random control token and initial five-minute
  validity. The database stores SHA-256 of the random token. Seller-authorized binding
  creates a session and changes pass expiry to the session expiry. The customer obtains
  a wallet-bound challenge and confirms; cancellation is also supported.
- [sessionService.ts](../apps/benefits-network/backend/src/services/sessionService.ts)
  reconstructs proof version 2 from the claimed wallet, purpose, deployment audience,
  chain, shop, session, nonce, expiry and immutable terms/digest. It verifies exact signer
  equality and fresh canonical eligibility. In one SQLite transaction it rechecks seller
  authority, expiry, state and terms, evaluates known seller-wallet self-redemption and
  conditionally changes `PENDING` to `REDEEMED`. Failed signature/eligibility/RPC checks
  before commit do not consume the checkout. A retry after success cannot redeem again.
- There is **no separate current seller redemption step**. In
  [sessions.ts](../apps/benefits-network/backend/src/routes/sessions.ts),
  `POST /api/sessions/:id/redeem` returns 410. Customer proof redemption uses
  `POST /api/attest`, or `POST /api/passes/:id/confirm` for a bound pass. Challenge
  wallets travel in POST bodies; private responses use `no-store`. The legacy customer
  history challenge/authorization/read endpoints return 410 in
  [customer.ts](../apps/benefits-network/backend/src/routes/customer.ts).
- [customerHistory.ts](../apps/benefits-network/frontend/src/lib/customerHistory.ts)
  keeps at most 12 local receipts containing signed text, full wallet and signature.
  Signature verification proves consent to signed terms, not independent evidence of a
  completed sale, backend approval or receipt status/time. Local status is not a signed
  server attestation; current authoritative status requires an online session check.

### Seller configuration and its limits

[SellerRuleBuilder.tsx](../apps/benefits-network/frontend/src/components/SellerRuleBuilder.tsx),
[SellerCatalogManager.tsx](../apps/benefits-network/frontend/src/components/SellerCatalogManager.tsx)
and [seller.ts](../apps/benefits-network/backend/src/routes/seller.ts) provide:

- Owner-wallet profile creation/selection, description, website/logo, service area,
  categories, slug, deactivation/reactivation and public storefront links.
- Product creation/editing/deactivation with category, description and optional integer
  minor-unit price/currency; benefit rules with label/product, discount percentage,
  required lock, minimum held IFR, lock source and TTL. Quick templates are editable
  drafts, not subscription plans.
- Staff-wallet operators with labels, revocation and optional expiry; checkout sharing
  kit; paginated session history, status summaries and client-generated CSV export via
  [sellerSessionExport.ts](../apps/benefits-network/frontend/src/lib/sellerSessionExport.ts).
- Seller reward application/disable, distinct reward-wallet proof and read-only status
  through [SellerRewardStatus.tsx](../apps/benefits-network/frontend/src/components/SellerRewardStatus.tsx).
  Governance verification is an admin action, not seller self-approval.

Seller “sign-in” is signed action authorization, not a conventional persisted login
session. [sellerAuth.ts](../apps/benefits-network/backend/src/services/sellerAuth.ts)
binds domain, chain, action, business, scope and a nonce with a ten-minute validity;
mutations consume a server challenge. Read access is separately scoped and checked.
Admin bearer authentication exists separately in
[auth.ts](../apps/benefits-network/backend/src/middleware/auth.ts).

**Caps and plans must not be overstated:** current seller schemas accept customer daily
and monthly limits only as zero; old nonzero rules/snapshots refuse checkout. The
database still has those fields. Infrastructure caps include five active and 25 total
persisted profiles per owner by default, and ten active operators per business. These
are platform guardrails, not seller-configurable plans. See
[config.ts](../apps/benefits-network/backend/src/config.ts),
[sellerLimits.ts](../apps/benefits-network/backend/src/services/sellerLimits.ts) and
`createSessionSnapshot` in `sessionService.ts`. No subscription/plan model or billing
flow is present in the current Prisma schema or these seller routes.

Reward budgets exist in operator-configured
[modelBPolicy.ts](../apps/benefits-network/backend/src/services/modelBPolicy.ts), not
as a seller plan editor. Model B is default-off; even when configured,
[modelBSettlement.ts](../apps/benefits-network/backend/src/services/modelBSettlement.ts)
adds the customer-deduplication blocker for legacy events without EXT-10 evidence or when
the dedicated dedup configuration is absent, leaving those exports diagnostic/non-payable.
Do not equate a verified seller link, checkout, export or proposed budget with a payout.

## 2. PWA recommendation and actual remaining work

Use one install identity, one origin and one service worker. Keep customer proof/benefit
use and owner/operator configuration as role-specific views of the existing routes.
Role selection is a preference; backend authorization remains the permission boundary.
Use ordinary deep links for checkout and return from wallets; do not create separate
customer/seller installs or persist customer identity to remember a role.

| Item | Code evidence today | Concrete bounded follow-up |
| --- | --- | --- |
| Manifest identity/scope | [public/manifest.json](../apps/benefits-network/frontend/public/manifest.json) already has `id`, `start_url` and `scope` all `/`, `display: standalone` and portrait orientation. [layout.tsx](../apps/benefits-network/frontend/src/app/layout.tsx) links it and sets the shop canonical origin/Apple app metadata. | **P1, S:** assert stable identity/scope and same-origin deep-link coverage in existing PWA checks. Preserve the ID to avoid duplicate installs. Review portrait-only orientation with tablet sellers before changing it. No missing manifest fields need recreating. |
| Icons | Manifest points to `ifr-token-192-v11.png`, `ifr-token-512-v11.png` (`purpose: any`) and `ifr-token-512-maskable-v1.png` (`purpose: maskable`). Local PNG dimensions match 192/512/512. Layout uses 64px/favicon and 180px Apple icons in `public/icons/`. Older icon versions also remain. | **P2, S:** inspect mask cropping/safe area on target devices and assert asset existence/dimensions/purpose. Retire old assets only after proving that no released worker/client references them. A maskable file already exists. |
| Install screenshots | Manifest references `public/screenshots/pwa-home-narrow-v1.png` (780x1688) and `pwa-home-wide-v1.png` (2880x1620), with narrow/wide form factors and labels. Files and dimensions match locally. | **P3, S:** compare captures with the accepted current UI; refresh only if stale. Use dummy seller/proof states and no wallet, capability or customer identifiers in images. **[PRIVACY REVIEW]** |
| Install UI/state | `InstallCard` in [page.tsx](../apps/benefits-network/frontend/src/app/page.tsx) handles `beforeinstallprompt`, `appinstalled`, standalone detection and browser-menu guidance. It supplies Safari/iOS instructions and keeps Android 9 or older in browser mode. | **P4, M:** record real-device install, standalone relaunch and wallet-return tests for customer and seller flows; include denied prompts, restricted storage and browser fallback. Existing instructions are not new evidence of device compatibility. |
| Service worker/update | [sw.js](../apps/benefits-network/frontend/public/sw.js) uses cache `ifr-benefits-v25`; layout registers `/sw.js?v=25` with `updateViaCache: none`. Install precaches the root/static assets; activation deletes older Benefits caches. A guarded controller-change reload exists. | **P5, S:** verify update/relaunch preserves no stale checkout action, versioned assets match the deployed build and fresh installs receive the intended worker. Reuse [test-benefits-service-worker.js](../scripts/test-benefits-service-worker.js). |
| Offline behavior | Root navigation is network-first with a five-second timeout and cached-root fallback; other navigation failures use [offline.html](../apps/benefits-network/frontend/public/offline.html). Same-origin API fetch failures return 503 JSON and are not cached. Other runtime caching is restricted to same-origin static assets. There is no redemption queue/background sync. | **P6, M:** extend existing [offline-shell checks](../scripts/test-benefits-offline-shell.js) for offline deep links, failed RPC, expired QR, reconnect and long-open tabs. Never authorize from cached balances or queue signatures/redemptions. A cached root shell does not guarantee that every lazy route, history verifier or wallet flow opens offline. |
| Optional plans/caps | Rule editing and guardrail caps exist; customer-level limits and seller billing plans do not. | **P7, M for specification only:** define whether any new cap is global per offer/shop or customer-specific. The latter conflicts with the current no-customer-identifier boundary. Keep optional plans out of implementation until their purpose/data/authorization are approved. **[OWNER DECISION] [PRIVACY REVIEW]** |

Installation assets and registration in source establish an existing PWA implementation.
This analysis did not verify HTTPS response headers, the deployed manifest/worker, browser
install eligibility, mask appearance or device behavior on the public host.

## 3. Persisted and person-linkable data today

### Database inventory and current retention

The authoritative model inventory is
[backend/prisma/schema.prisma](../apps/benefits-network/backend/prisma/schema.prisma).
“No automatic expiry” below means no deletion policy is implemented for that table in
the inspected app/retention paths; it is not a claim about an inspected production DB.
Authentication/QR expiry rejects use, but does not itself erase a row.

| Table/model | Persisted identity, linkage or content | Writers and retention today |
| --- | --- | --- |
| `Business` | Raw `ownerAddress`; `id`, `slug`, `name`, `description`, `website`, `logoUrl`, `serviceArea`, `serviceAreaKey`, `categoriesJson`, configuration and `createdAt`. Free text/URLs can identify a sole trader or contain personal details. | `routes/seller.ts`, [routes/admin.ts](../apps/benefits-network/backend/src/routes/admin.ts). Deactivation sets inactive; it does not erase ownership/profile. No automatic expiry. Public discovery exposes selected profile fields, not the owner field: [businesses.ts](../apps/benefits-network/backend/src/routes/businesses.ts). |
| `Product` | `businessId`, `name`, `category`, `description`, price/currency and timestamps; seller-linked content, potentially personal if entered. | Seller catalog routes; deletion deactivates product/linked rules. No automatic expiry. |
| `BenefitRule` | `businessId`, `productId`, `label`, `category`, `productName`, thresholds, source, discount, TTL, legacy limit fields, timestamps. Seller linkage and checkout context. | Seller/admin rule routes; delete deactivates. No automatic expiry. |
| `CheckoutOperator` | Raw `walletAddress`, `businessId`, optional human `label`, `active`, `expiresAt`, timestamps. Staff identity/work assignment. | Seller operator upsert/revoke routes. Revocation changes `active`; expiry prevents checkout authorization. Neither deletes the row. No automatic expiry. |
| `Session` | Raw **seller** `confirmedByWallet`, `confirmedByRole`, `confirmedByOperatorId`; `id`, `businessId`, `benefitRuleId`, `customerPassId`, `nonce`, all `benefit*` terms/version snapshots including price/currency/thresholds; `status`, `reason`, `verifiedLockSource`, `selfRedemption`, `proofVersion`, `attestAttempts`, `createdAt`, `updatedAt`, `expiresAt`, `redeemedAt`. Timed purchase context and outcomes can be linkable without a stored customer wallet. | `createSessionSnapshot`, `commitCheckoutRedemption`, pass cancellation/expiry. No customer wallet/signature/text/balance/block column in current schema. All sessions are protected from the current retention CLI; no automatic expiry/deletion. |
| `CustomerPass` | Random `id`, SHA-256 `controlHash`, `status`, `expiresAt`, `boundAt`, `cancelledAt`, timestamps; optional reverse session relation. Fresh checkout capability, not a stable wallet identifier. | `customerPassService.ts`. Initial five-minute TTL; bound pass uses checkout TTL. Manual retention may delete only **unlinked**, expired `OPEN`, `CANCELLED` or `EXPIRED` rows. Linked passes, including expired ones, are protected. No guaranteed maximum. |
| `SellerRewardLink` | Raw `builderWallet`, `rewardWallet`, `businessId`, `partnerId`, `rewardWalletConfirmedAt`, status, `requestedAt`, `verifiedAt`, `lastCheckedAt`, `verificationBlock`, `governanceReference`, `reason`, timestamps. Seller identity and public-chain linkage. | Seller reward routes and admin verification/revoke. Disabled/revoked links remain. No automatic expiry. Verification block here concerns seller configuration, not a persisted customer eligibility read. |
| `RewardEvent` | `businessId`, unique `sessionId`, `partnerId`, `chainId`, `status`, `reason`, optional `txHash`, timestamps; the EXT-10 local follow-up adds nullable `rewardPeriod` and scoped HMAC `rewardDedupKey`. Checkout/reward linkage; a transaction hash can lead to public identities. No raw customer-wallet or customer lock-amount column. | `commitCheckoutRedemption` creates `SETTLEMENT_PENDING` only with verified pilot proof and configured dedup; duplicate checkouts get `SKIPPED_DUPLICATE`, other candidates remain non-payable `BLOCKED_POLICY`. No legacy backfill. `txHash` remains in schema and the historical migration, but the current checkout insert does not populate it. Retention protects **all statuses**; no automatic expiry. |
| `AuditLog` | `sessionId`, `type`, serialized JSON `payload`, `ts`. Current `SESSION_CREATED`/`CUSTOMER_PASS_BOUND` payloads persist seller `createdBy.walletAddress`, role/operator and checkout links. `REDEEMED` persists seller `actorWallet`, role/operator, confirmation and time. `ATTEST_OK` stores proof version, rule/min-held requirement, lock source and self-redemption boolean, not actual customer amounts. | `sessionService.ts`. Historical `REDEEM_DENIED_LIMIT.actorWallet` is also an allowed seller leaf in the migration verifier. Retention protects all session audit rows; no automatic expiry. |
| `AdminAuditLog` | Action/method/route template, target type/ID, status/time, `actorDigest`, `clientDigest`. [adminAudit.ts](../apps/benefits-network/backend/src/services/adminAudit.ts) hashes fixed `admin-actor:primary` and **unsalted** `admin-client:<IP>` with SHA-256. The fixed actor is not individual operator attribution; IP digest is still correlatable/guessable. CLI pruning uses fixed local-operator/client digests instead. | `recordAdminAudit` on admin operations; retention writes its own aggregate action. Manual pruning uses `createdAt < cutoff`; no scheduler or fixed maximum. |
| `SellerAuthorizationChallenge` | Random `nonce`, `action`, `businessId`, `scope`, `expiresAt`, `consumedAt`, `createdAt`. No wallet/hash/signature column. A `passes:bind` scope contains pass/rule references and is checkout-linkable. | [sellerAuthorizationChallenge.ts](../apps/benefits-network/backend/src/services/sellerAuthorizationChallenge.ts). Ten-minute auth validity; issuing a challenge opportunistically removes up to 100 expired rows. Manual pruning also deletes `expiresAt < cutoff`. Low traffic/outages leave rows longer. |
| `_prisma_migrations` (Prisma-managed) | Migration name/checksum, timestamps, step count and failure `logs`; no application customer field, but diagnostic text needs inspection/redaction controls. | Prisma migration tooling, not ordinary request handlers. Current [migration verifier](../apps/benefits-network/backend/scripts/verify-owner-b-migration.cjs) inventories it. No expiry policy; preserve migration identity/history rather than deleting ledger rows. |

The current allowlisted raw wallet storage locations in
`verify-owner-b-migration.cjs` are exactly `Business.ownerAddress`,
`CheckoutOperator.walletAddress`, `SellerRewardLink.builderWallet`,
`SellerRewardLink.rewardWallet`, `Session.confirmedByWallet` and the seller audit leaves
listed above. This is a source allowlist, not a scan result for live data. Free-text fields
remain an input path for unintended personal details; absent dedicated email/name fields
does not prove their absence from content.

### Stores outside the application tables

| Store/path | Data and retention evidenced by code |
| --- | --- |
| Public rate-limit memory/optional Redis | [rateLimiter.ts](../apps/benefits-network/backend/src/middleware/rateLimiter.ts) keys counters by raw IPv4, normalized IPv6 /64, or pass ID plus SHA-256 of the Authorization header. Windows are one minute for discovery, ten minutes for legacy redeem and one hour for the other configured public/admin/pass limiters. [rateLimitInfrastructure.ts](../apps/benefits-network/backend/src/services/rateLimitInfrastructure.ts) selects in-memory or namespaced Redis storage; these are not SQLite rows. Redis expiry follows limiter windows; actual Redis persistence/backups are not specified here. |
| Authenticated seller limiter | [authenticatedRateLimiter.ts](../apps/benefits-network/backend/src/services/authenticatedRateLimiter.ts) stores the **raw normalized seller wallet** in memory or the Redis key `ifr-benefits:seller-wallet:seller:<wallet>`, with a one-hour counting window. Redis sets PEXPIRE. The bounded in-memory map removes expired entries on reuse/capacity pressure, not a strict wall-clock deletion deadline. |
| Operator runtime configuration | `config.ts` reads optional reward-caller address and Model-B policy JSON containing partner/business IDs and governance references; values may be persisted in operator-managed configuration and copied with the Compose env file by the migration template. No customer account index is configured here. Configuration-copy retention is not enforced by the app; credentials remain protected configuration, never public audit output. |
| Application stdout/stderr | [index.ts](../apps/benefits-network/backend/src/index.ts) logs fixed startup information and arbitrary unhandled `err.message`; config and Redis startup/runtime errors also log diagnostics. There is no general access/body logger in this Express setup. Customer eligibility RPC errors are replaced with fixed text before propagation in `attest`; there is no universal personal-data scrubber for every other error path. Docker/log collector retention/rotation is not set in the [example Compose](../apps/benefits-network/docker-compose.production.example.yml). Exact content/retention in production is unverified. |
| Proxy/access/host logs | Paths can contain pass/session IDs; older clients can still send a `walletAddress` query to seller `/auth-message`, where it is ignored by the handler. Ignoring it does not remove it from ingress logs. [benefits-edge-log-check.py](../scripts/ops/benefits-edge-log-check.py) explicitly limits its proof to one configuration/bounded sample, excluding historical rotations, other ingress and file logs. This analysis did not run it. No repository-enforced end-to-end log retention was established. |
| SQLite files, journals, backups and exports | The [owner-B migration SQL](../apps/benefits-network/backend/prisma/migrations/20261006120000_owner_b_customer_session_privacy/migration.sql) drops legacy customer-history/access/challenge tables and removes customer columns from passes/sessions/rewards and seller challenges. It scrubs specified audit customer keys/free text, neutralizes old reasons and expires in-flight checkout state. Older copies may retain raw wallets, amounts, blocks, access tokens and old audit content. SQL removal alone does not establish physical erasure or backup deletion. The migration template retains protected backups pending owner acceptance; no automatic backup deadline is implemented there. Seller CSV and admin settlement exports can be saved by recipients; app-side deletion cannot erase their copies. |
| Browser storage | `customerHistory.ts` persists up to 12 receipts in `ifr.shop.customerProofHistory.v1`, including full signed wallet/text/signature, checkout terms/status/time, without an age TTL. `CustomerCheckoutPass.tsx` stores pass ID, raw control token, expiry and full wallet in `ifr.shop.activeCustomerPass` sessionStorage. Home/seller/console components also retain role, last business and session references. These are device persistence, not backend customer accounts. |
| Browser/Next caches | `sw.js` caches public shell/static assets and evicts prior Benefits cache versions on activation; no time TTL. Next's public seller-page fetch cache has a 300-second revalidation setting. [LocalDataControls.tsx](../apps/benefits-network/frontend/src/components/LocalDataControls.tsx) clears `ifr.shop.*` local/session keys and `ifr-benefits-*` caches; it excludes wallet-provider storage and differently named service-worker reload keys. Wagmi/connector-managed connection storage is separate from those app-prefix controls. |

[retention.ts](../apps/benefits-network/backend/src/services/retention.ts) implements
`phase-one-expired-auth-artifacts`. Its CLI
[retentionCli.ts](../apps/benefits-network/backend/src/retentionCli.ts) requires an explicit
age of 1–3,650 days and explicit confirmation to apply. Batches default to 1,000 per
eligible table, capped at 10,000. The admin report counts eligibility; it does not delete.
No scheduler is wired in the inspected application/Compose files. This is neither an
automatic 30-day policy nor the historical HMAC proposal's 35-day policy.

## Model B EXT-10 local follow-up

The 2026-10-17 seller-reward task explicitly permits a “hash or minimal key” for one eligible
wallet/partner/period. The local implementation treats that as a narrow exception for Model B;
the zero-identifier baseline above still applies outside this feature. No production migration,
activation or new live-data collection is implied. Review acceptance of the exception before enabling it.

- Only an exact-offer, proof-v2, seller-confirmed, non-self `REDEEMED` checkout at a configured,
  verified post-activation pilot may store `RewardEvent.rewardDedupKey` and `rewardPeriod`.
  A dedicated secret derives an independent HMAC key and rotation tag per chain/vault/partner/UTC
  month. No raw customer wallet, plain address hash, customer signature or balance is persisted.
- One eligible checkout stores one scoped pseudonym; duplicate checkouts store only the period and
  a duplicate outcome. The same wallet has unrelated HMACs in different months and partners. These
  values remain pseudonymous personal data, especially if the secret or request context is available.
  They must not be described as erased identity, anonymous data or customer history.
- Keys never enter API DTOs, seller session CSVs, aggregate exports or proposal ledgers. The export
  contains counts and reconciliation commitments only; small partner/month totals can still reveal
  business activity. The backend secret is dedicated protected configuration and never signer material.
- The additive migration leaves existing event fields null. Missing configuration, key changes within
  an already populated month and legacy events without dedup evidence fail closed for settlement.
  Historical customer data cannot be reconstructed or backfilled.
- Existing retention protects all reward events, so this prerequisite adds **no automatic deletion**.
  Do not remove keys while checkouts or reconciliation for that month remain admissible; doing so
  could award the wallet again. A reviewed post-settlement retention and key-destruction procedure,
  including SQLite journals/backups, remains an activation item. No retention job runs in this task.

## 4. Proposed minimization and retention design

### Keep the customer boundary; reduce other linkage

1. Keep customer wallet, recovered identity, signature, signed text, actual balances and
   verification block confined to proof request processing. Never add a persistent raw
   address, address hash/HMAC, customer nullifier, payment hash or cross-checkout ID as
   a substitute outside the narrowly scoped [EXT-10 follow-up](#model-b-ext-10-local-follow-up).
   A deterministic address hash is pseudonymization, not deletion; the HMAC exception changes
   the owner boundary and needs acceptance before activation. **[OWNER DECISION] [PRIVACY REVIEW]**
2. Keep hashing random pass secrets: their high-entropy control token is a different
   object from a wallet identifier. Shorten the lifetime of the stored hash after the
   checkout closes. Do not truncate a control hash, nonce, signature or wallet used for
   exact authorization; collisions/ambiguity would weaken security.
3. Retain active seller/operator/reward addresses where ownership, RPC verification and
   exact signer comparison need them. Display redacted labels where full addresses are
   unnecessary. Public catalog DTOs should continue excluding private seller identities.
   After obligations close, remove duplicate seller addresses from session/audit detail
   together under a reviewed policy. Hashing those duplicates would still allow
   linkage and may break settlement checks. **[PRIVACY REVIEW]**
4. Replace arbitrary diagnostic text with approved error codes at storage/log boundaries;
   allowlist audit keys. Never log request/response bodies, authorization/signature headers,
   raw RPC calldata, control tokens or URLs/queries carrying identifiers. For public
   metrics use aggregate counts and coarse time buckets without session/pass/wallet IDs;
   suppress small groups rather than assuming that aggregating makes them anonymous.
   **[PRIVACY REVIEW]**
5. For necessary IP abuse controls, keep exact keys only for the enforced window in
   volatile storage/TTL Redis. Consider a scoped, frequently rotated keyed digest for
   the short admin-IP correlation window, or remove `clientDigest` if no documented
   investigative purpose needs it. This is infrastructure/seller metadata, not a new
   customer wallet identifier. Keep authentication secrets out of the digest. Do not
   treat truncating an IP or unsalted hashing as guaranteed anonymization; validate
   shared-network/IPv6 abuse impacts first. **[PRIVACY REVIEW]**
6. Offer a local-receipt age limit and clear/export choice; proposed default 30 days plus
   the existing 12-item cap. Clear active pass data after terminal status/expiry; never
   upload receipts for synchronization by default. Explain that the stored signed text
   contains the full wallet even though its label is redacted. **[PRIVACY REVIEW]**

### Proposed schedule per table and store

Every row is **[PRIVACY REVIEW]**. All durations are elapsed UTC time. Use an hourly,
bounded, idempotent sweep with backlog metrics and an alert if a due row is over 24 hours
late; the target deletion bound is the stated period plus at most 24 hours of sweep lag
under normal operation. Outages are reported exceptions, not silently renewed retention.
Add closure/deactivation/resolution timestamps where current fields cannot express the
start of a retention period. `updatedAt` is not a reliable substitute.

| Table/store | Proposed retention and minimization | Required constraint/exception |
| --- | --- | --- |
| `Business` | Keep published profile and exact owner while active. At closure, unpublish immediately; remove optional profile/free text 90 days after closure and obligation resolution. | Current “total persisted profiles per owner” cap includes inactive rows. Erasing ownership would reset it. **[OWNER DECISION]:** approve a minimal seller-only quota record and its lifetime/key policy, or change the cap contract before erasure. Do not silently reset quotas or claim a hard owner-address deadline until resolved. |
| `Product` | Keep active catalog; delete inactive catalog detail 90 days after deactivation, when referenced checkout records/obligations no longer need it. | Check foreign keys, public cache invalidation and seller edit expectations; immutable checkout snapshots must remain valid during their own period. |
| `BenefitRule` | Keep active rules; remove inactive detail 90 days after deactivation and closure of references/obligations. | Preserve referenced snapshots and refuse unsupported nonzero customer limits; deleting a rule must not alter an already signed checkout. |
| `CheckoutOperator` | Revoke access immediately. Remove human label after 30 days; delete wallet/row 90 days after revocation/expiry and resolution of dependent obligations. | Current self-redemption check includes **all** operator wallets, even inactive ones; hard deletion loses that coverage. Seller reopening/reconciliation also uses identities. Policy must explicitly preserve a justified seller-only control record or accept the changed coverage before deletion. **[OWNER DECISION]** |
| `Session` | Delete non-redeemed terminal/expired checkouts seven days after `max(expiresAt, terminalAt)`. For redeemed checkouts, keep required terms/seller confirmation for 45 days after `redeemedAt`; then delete detail and relations together. | A session with unresolved reward/reconciliation/dispute dependencies is on explicit hold. If a late resolution needs a short evidence window, delete after `max(redeemedAt + 45 days, resolvedAt + 7 days)`; no age-only deletion of an obligation. Preserve online status semantics until expiry/deletion is publicly explained. |
| `CustomerPass` | Delete unlinked closed/expired passes within 24 hours of expiry/cancellation. For linked passes, retire the control hash within 24 hours after session terminal status/expiry; remove the pass/link after seven days if no dependency needs it. | Requires schema/read-flow work: `controlHash` is currently mandatory and controlled lookup is used to obtain checkout status. Define a safe short-lived terminal-status view and detach the FK before deletion; no reusable customer token or reactivation. |
| `SellerRewardLink` | Keep exact identities while active or obligated. Remove optional reason/reference text 90 days after disabled/revoked and resolved; erase link/wallets when no quota, reconciliation or other approved purpose requires them. | Do not remove beneficiary binding or governance evidence for open events. Separate app erasure from public-chain records, which this backend cannot erase. |
| `RewardEvent` | Keep unsettled/unknown statuses on hold. For explicitly resolved terminal events, retain required linkage for 45 days after resolution, then delete with related session/audit detail when all retention conditions are met. | The historical owner-B cutover accepts only `CONFIRMED` as terminal. Current `BLOCKED_POLICY`, `SETTLEMENT_PENDING` or unknown status is **not** automatically terminal. Define any new non-payable cancellation/resolution policy explicitly; do not delete blocked events simply because they aged. **[OWNER DECISION]** |
| `AuditLog` | Non-redeemed checkout logs follow the seven-day session period. Redeemed confirmation/terms evidence follows the 45-day session/event dependency period, then delete rather than retain address hashes. | Settlement currently parses seller `actorWallet`/role/operator from `REDEEMED` JSON. Do not prune/scrub those fields before dependent reconciliation is resolved and verified. |
| `AdminAuditLog` | Keep action/status/target/time for 90 days, then delete. Remove or limit IP-derived correlation to seven days; retain a real individual actor identifier only if a reviewed access model requires it. | Static bearer/fixed actor digest cannot provide individual accountability. The present mandatory string column/creation path needs a compatible update to support removing IP digest. |
| `SellerAuthorizationChallenge` | Keep unexpired nonce for replay protection; remove expired rows within 24 hours, consumed or not. | Preserve atomic single-use consumption; deleting a consumed row must never make its signed nonce valid again. This can extend the existing bounded cleanup/CLI rather than add another challenge store. |
| `_prisma_migrations` | Keep migration name/checksum/application history for the database lifetime. Remove unnecessary error detail within seven days after failure resolution. | Preserve Prisma recovery semantics; review support for scrubbing `logs` separately. Never put wallet/proof data into migration SQL or diagnostic evidence. |
| Rate-limit memory/Redis | Physically expire/delete keys within their one-minute/ten-minute/one-hour windows plus a short bounded sweep interval. Do not include ephemeral keys in backups; verify Redis configuration if enabled. | Current custom memory limiter needs proactive cleanup to meet physical deletion, not just reset semantics. Keep fail-closed Redis readiness and abuse isolation. |
| Application/proxy logs | Default seven days of redacted operational logs; approved incident extracts up to 30 days with named owner/deadline. Prefer route templates without query/pass/session values. | Requires actual host/proxy/collector policy and verification. Do not assert that no infrastructure receives the address. |
| Backups/SQLite copies/exports | Proposed normal backup maximum 30 days. Migration backup acceptance target 48 hours and maximum seven days after cutover, or stop/obtain a documented extension before that maximum. Delete temporary copies and controlled exports after purpose completes, default seven days. | Verify restore/reconciliation first; never destroy the only required recovery evidence. Restrict and inventory legacy copies. A backup can extend visibility beyond live-table deletion by its remaining lifetime; explain that explicitly and reapply deletion after restore. Recipient copies need separate handling. **[OWNER DECISION]** |
| Browser history/pass/static caches | Proposed receipt default 30 days/12 items with user clear/export; pass secrets removed on terminal/expiry and on next startup. Keep static caches until release replacement/user clearing, without private responses. | Browser storage can survive tab restoration/backups and cannot enforce a deadline while never reopened. User/provider/OS storage policies are separate. State this limitation rather than promise remote device erasure. |

Holds need a named owner, purpose, affected records, review date and deletion trigger;
review at least every 30 days and escalate unresolved cases. A hold is a documented
exception, not a claim of an unconditional maximum. Define storage budgets and overdue
alerts so exceptional reward rows cannot silently grow forever.

### Constraints that minimization must preserve

- **Single checkout replay prevention needs durable checkout state.** A fresh random
  session/pass ID is still a stored, linkable checkout reference. Preserve exact
  audience/chain/shop/session/nonce/terms/expiry binding, atomic conditional consume,
  current seller permission and immutable snapshot. No RAM-only replay list or offline
  redemption fallback. Deleting old rows is safe only when a request for a missing/expired
  session fails closed and can never reconstruct or reopen it.
- **No hosted customer identity means no hosted per-customer limits or lifetime reward
  deduplication.** Maintain rejection of nonzero customer-limit configurations. Merchant
  systems may have their own approved records; relocating a customer list to an IFR
  export/settlement service would still violate the intended boundary.
- **Self-redemption coverage is bounded.** The request compares the current customer
  signer with stored owner, operator, builder and reward wallets. It cannot discover
  every other wallet controlled by that seller. Minimizing the seller-control list
  changes this protection and must be an explicit policy decision.
- **Model B remains diagnostic.** A seller opening a checkout and a customer signing
  terms do not establish a paid, non-refunded genuine sale. Keep the dedup blocker in
  place; specify seller evidence, cancellations/refunds, cross-period duplicate-sale
  prevention and independent reconciliation before considering a reward-policy change.
  A wallet transfer or merchant budget alone does not establish a sale.
- **Settlement is not age-based closure.** `modelBSettlement.ts` groups calendar months
  and constrains pricing evidence to a settlement block no later than 72 hours after
  period end. A 31-day month plus that window already exceeds 30 days for early-month
  records; unresolved obligations can last longer. The proposed 45-day detail target is
  an engineering margin, not authorization to close/delete events at day 45 or hour 72.
- **Keep exact arithmetic and evidence pairing.** Do not round IFR values through
  JavaScript `number`, truncate auth identities, delete audit confirmation required by
  settlement, reset seller lifetime quotas, or restore old images against new schemas.

### Migration and rollout plan

Use [BENEFITS_MIGRATION_TEMPLATE.md](BENEFITS_MIGRATION_TEMPLATE.md) and a reviewed,
migration-specific copy of
[scripts/ops/benefits-migration-template.sh](../scripts/ops/benefits-migration-template.sh)
**once the template is on main**. It exists in this source checkout, but was absent from
the local `main` tree when inspected; that is not evidence about remote integration.
The skeleton refuses application until its migration/invariant hooks are implemented.
This plan authorizes no hook execution, DB access, purge or production cutover.

1. **Resolve policy before DDL.** Approve the schedule, hold/terminal-status definitions,
   seller quota/self-control retention and backup window; complete privacy review. Name
   owner/operator/reviewer, exact release/images, writers/jobs, invariants, capacity,
   maintenance window and action-specific approval. **[OWNER DECISION] [PRIVACY REVIEW]**
2. **Inventory safely.** On synthetic fixtures first, derive per-table aggregate counts,
   oldest ages, relation dependencies and state distributions. Plan a separately approved
   production inventory of database/WAL/journal, logs, backup generations and exports;
   never print rows, wallets, signatures or secrets. Confirm migration history rather
   than inferring deployed state from the schema or public privacy page.
3. **Design compatibility and guards.** Add necessary lifecycle timestamps, explicit
   terminal/hold semantics and nullable/retired capability handling before scheduled
   deletion. Enumerate every reader and FK dependency. Unknown/open reward states refuse
   affected migration/deletion; never reclassify obligations to make a cutover pass.
   Preserve the existing owner-B address allowlist and update its verifier deliberately
   for any schema change. No customer wallet fingerprint or customer HMAC key is proposed;
   an optional admin-IP digest redesign would need separate scoped review and approval.
4. **Rehearse copy migration and failure.** Use dummy populated databases for expiration,
   dependent pass/session/event/audit pruning, invalid/unknown states, replay after
   restart, parallel consume, lost response, RPC failure and late-stage rollback.
   Verify exact retained/deleted counts, integrity, foreign keys, migration history and
   absence of disallowed addresses/calldata/signatures. Reuse the existing owner-B
   migration fixture/verifier as evidence tooling; do not rerun its historical DDL on an
   already upgraded schema.
5. **Prepare the reviewed template hooks.** Implement `check`, `prepare`, `migrate` and
   `before`/`after`/`online` invariants in a migration-specific artifact. Pin source and
   images, prove all writers quiesce, and rehearse protected backup/restore. Template
   `plan` is read-only and cannot certify hook behavior. Its default raw-file backup
   refuses SQLite sidecars; a WAL-aware strategy needs separate review.
6. **Separate approved maintenance cutover.** Follow the template sequence: exact-head
   checks and lock, verified source/config/image backup, prepare images, stop every
   writer, verify SQLite backup hashes/integrity/counts, migrate transactionally, perform
   reviewed checkpoint/VACUUM/privacy checks, then restart pinned images and check health,
   readiness and negative legacy endpoints before reopening. Normal deploy is not a
   schema-migration mechanism.
7. **Roll back as a pair, with a privacy consequence.** Rehearse both prior image plus
   restored prior DB and forward recovery after erasure. A prior backup can reintroduce
   deleted data and old tokens; isolate writers, maintain the outage and invalidate
   capabilities/reapply deletions before accepting traffic as appropriate. Do not promise
   reversible erasure after all old copies expire. Record that trade-off and the owner
   decision before cutover; never automatically revive a rejected checkout.
8. **Acceptance, scheduled enforcement and evidence.** Keep only aggregate reports and
   protected backup references; confirm the acceptance deadline and separately authorized
   backup disposal. Enable the bounded retention job only after reviewed dry-run counts,
   dependency checks and an alert/incident procedure exist. On every restore, reapply
   the current retention boundary before serving. Publish only verified implemented
   guarantees; do not publish proposed deadlines as current facts.

### Public third-party exposure and privacy review

These are data-flow implications of code configuration, not claims about provider
policies, retention, legal roles or a packet capture. All disclosures below require
**[PRIVACY REVIEW]** and validation against the actual deployment before publication.

| Recipient/path | What the implementation requires or can expose | Public explanation needed |
| --- | --- | --- |
| Hosting/proxy/backend | Receives client IP/network metadata and checkout paths/IDs. Backend receives full wallet/signature in proof bodies and seller auth in headers/body. | “Processed transiently” is different from “never received.” State what request logging is disabled, what metadata persists and for how long, after verification. |
| Browser RPC | `wagmi.ts` uses a configured HTTPS RPC or publicnode defaults for Ethereum reads. Wallet/contract reads carry the queried address and network metadata to that endpoint. | Explain queried wallet/address-bearing RPC calls, direct browser IP visibility and provider-specific policy. Do not claim an injected wallet makes all reads local. |
| Backend RPC | `ifrLockService.ts` sends address-bearing eligibility calls to configured `RPC_URL`; reward checks also send seller/partner queries. | Provider sees queried wallets, contract calls, times and the backend egress IP. It is not necessarily sent the customer's browser IP by this code. Hashing local records would not hide the address needed for `eth_call`. |
| Wallet app/provider | Receives accounts, requested chain/signatures and transaction requests; manages its own connection/storage. | Explain local/injected versus selected SDK/remote connector paths, custody boundary and how users disconnect in their wallet. Backend erasure does not clear wallet records. |
| WalletConnect/Coinbase services | Selected connectors can contact provider infrastructure. WalletConnect uses relay/session transport if configured; metadata names the shop. Telemetry opt-outs/deferred startup in `wagmi.ts` reduce optional calls but do not remove operational network processing. | Disclose relay/service participation and connection metadata exposure. Do not assert that the relay reads encrypted signature payloads or that encryption removes metadata. Verify actual providers/SDK behavior separately before more precise promises. |
| Public chain/external resources | Optional approve/lock/unlock transactions are public. Copilot iframe loads on open; external swap links open on action. Seller-controlled logo URLs and website links can also contact external hosts; [BusinessLogo.tsx](../apps/benefits-network/frontend/src/components/BusinessLogo.tsx) renders the configured image. | Separate off-chain proof from public transactions. Explain external-resource requests and optional help/links; `no-referrer` reduces referrer disclosure, not IP exposure. Copilot conversation retention is outside this Benefits backend inventory and needs its own review. |

The existing [privacy page source](../apps/benefits-network/frontend/src/app/privacy/page.tsx)
already describes many of these boundaries, but is not independent runtime evidence.
Its broad statement that rate limiting is never keyed by a wallet needs a **customer vs
seller** qualifier: authenticated seller counters do use wallet keys. Its “never in URLs”
wording also needs the legacy seller-query/ingress caveat. Date-specific migration and
backup claims require operational evidence before reuse.

Privacy review must determine the applicable legal framework, controller/processor roles,
purpose/legal basis per data class, appropriate durations, incident/hold handling, user
rights/request verification without a new customer index, support contact, notices and
third-party/transfer disclosures. An absence of a server customer account cannot establish
compliance or anonymity. These questions remain open; this document makes no legal finding.

## 5. Ordered implementation backlog

Estimates cover a bounded task plus focused verification: **S** up to one developer day,
**M** two to four days, **L** five or more days or a multi-party release. They are planning
estimates, not authorization. Reuse existing tests and review artifacts; no duplicate
platform, broad audit or native app is implied.

| Order | Task and concrete completion condition | Effort | Dependency/review |
| --- | --- | --- | --- |
| 1 | Decide retention periods, terminal obligations/holds, seller quota/control-history policy, backup acceptance and whether optional caps/plans are needed. Record unresolved customer-dedup economics separately. | M | **[OWNER DECISION] [PRIVACY REVIEW]**; precedes data behavior changes. |
| 2 | Complete a deployment-specific metadata/log/backup/third-party inventory using aggregate-only evidence; verify current schema/release, RPC paths and optional Redis/connector configuration. | M | Separate read-only operational authorization where required; no private evidence in issues. **[PRIVACY REVIEW]** |
| 3 | P1–P3: verify manifest ID/scope, real dimensions/mask rendering and current sanitized screenshots; add only missing focused assertions to the existing PWA checks. | S each | No reimplementation of present assets. UI evidence if assets change. **[PRIVACY REVIEW]** for captures. |
| 4 | P4–P6: verify install/standalone/wallet-return/update/offline failure flows on supported phone/tablet/desktop paths, preserving online-only authorization. | M | Existing device checklist, service-worker/offline tests; actual device evidence before a compatibility claim. |
| 5 | Implement allowlisted log/error output, remove identifier-bearing ingress queries/paths from logs, bound logs and optional limiter storage, and clarify seller-wallet counter disclosure. | M | Inventory and purpose approval; preserve rate-limit behavior/readiness. **[PRIVACY REVIEW]** |
| 6 | Implement browser receipt age/clear/export choices and active-pass cleanup; explain local full-wallet proof content and limits of offline consent verification. | M | No hosted sync or new customer identifier. Focused local storage and expired historical-consent tests. **[PRIVACY REVIEW]** |
| 7 | Design/implement per-table lifecycle timestamps, dependency-aware retention reports, terminal-state allowlists, capability retirement and guarded pruning on dummy databases. | L | Approved schedule and seller cap/self-redemption decisions; preserve unresolved obligations. Targeted database/auth review. **[PRIVACY REVIEW]** |
| 8 | Add bounded scheduled sweeps, lag/backlog alerts, hold review and restore-time reapplication; prove no revival/replay and no accidental deletion of settlement evidence. | M | Task 7; test outages, retries and maximum sweep lag. No claimed hard deadline without enforcement. |
| 9 | Integrate the migration template on main; produce the reviewed migration-specific script, paired-image/data restore rehearsal and sanitized invariant evidence. | L | Tasks 1, 2, 7, 8; independent migration review and exact-head checks. No production execution in this task. |
| 10 | Update public privacy/help text from verified behavior, name the privacy support path and publish approved retention/third-party/user-control disclosures. | M | **[PRIVACY REVIEW]**; do not present proposed deadlines as implemented. |
| 11 | Separately authorize and execute migration/release and acceptance/backup expiry, with post-cutover smoke, cache/worker identity and retention monitoring evidence. | L | Owner action-specific GO, capacity, rollback readiness, exact-head CI and full applicable Benefits release gates. |
| 12 | P7: specify optional shop/offer caps or plans only if still needed. Keep customer-specific limits and payable Model B blocked until a compatible explicit policy exists. | M specification; L implementation if approved | **[OWNER DECISION] [PRIVACY REVIEW]**; separate economics/payment authorization. |

## 6. Verification boundary for this document

The inventory was derived from source, schema, migration SQL and asset metadata. Local
PNG dimensions were checked; no browser/device screenshot review, live-chain read,
packet capture, production log/DB/backup inspection or migration was performed.

Documentation verification uses the pinned policy in
[docs-validator.yml](../.github/workflows/docs-validator.yml):
`node scripts/check-markdownlint-baseline.cjs --write-baseline`, followed by a comparison
of issue counts/fingerprints and the baseline check. Because that runner scans only
Git-indexed Markdown, this uncommitted document also needs direct linting or inclusion
through a temporary index; an unchanged tracked-only scan does not lint a new file.
Adding this clean document should increase only `filesScanned`, with all historical
findings unchanged. Product release/browser checks are future task evidence, not results
claimed by this analysis.
