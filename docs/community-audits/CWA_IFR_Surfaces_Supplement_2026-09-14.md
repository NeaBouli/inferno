# IFR Protocol — Surfaces Supplement: creator-gateway, Telegram bot, Benefits backend, SDK, dashboards

**Auditor:** Collateral Web3 Open Audits
**Client:** NeaBouli / Inferno Protocol (ifrunit.tech)
**Date:** 2026-09-14
**Baseline:** repo `NeaBouli/inferno` @ `eb538a355001b042b343bfb19221af2407a96e63`
**Companion documents:** `CWA_IFR_Protocol_Audit_2026-09-14.md` (CWA-01…24),
`CWA_IFR_Contracts_Deep_Audit_2026-09-14.md` (CWA-25…27)
**Method note:** this supplement is a **static source review** of the listed applications at the
pinned commit (AI-assisted analysis inside the CWA audit pipeline, with an independent review
pass over every security-relevant file — see §5 for the reviewed/skipped list). No dynamic
testing, no requests against live deployments beyond public GETs; deployment status of
creator-gateway was not observable from public surfaces and must be checked before relying on
the exploitability statements.

This document completes the full-scope audit: the first report explicitly left the app's
business logic beyond the three API backends unreviewed. This supplement closes that gap.

---

## 1. Executive summary

The remaining surfaces split into three quality tiers. The **Benefits backend** is in good
shape — redemption atomicity, IDOR protection, challenge single-use, and fail-closed rate
limiting are all implemented correctly; findings there are Low. The **Telegram bot** has one
coherent Medium cluster around wallet verification (entropy, bearer-code exposure, missing
wallet uniqueness, deanonymizing status endpoint) plus Low hygiene items. **creator-gateway**
contains the two most serious findings of this supplement: both the legacy `/auth/wallet`
endpoint and the Google OAuth flow issue JWTs whose `walletAddress` claim is fully
attacker-chosen — a complete bypass of the "lock ≥ 1,000 IFR" entitlement gate, as-coded.

**New findings: 2 High · 5 Medium · 8 Low · 3 Informational (CWA-28 … CWA-45)**

## 2. Findings

### High

#### [CWA-28] creator-gateway: unauthenticated JWT minting via legacy `/auth/wallet` — full entitlement bypass
- **Severity:** High · **Likelihood:** high if the service is publicly deployed (not confirmed) · **Status:** Open — works as-coded
- **Component:** `apps/creator-gateway/src/routes/auth.ts:112-133`, consumed by `routes/access.ts:8-21` → `services/entitlement.ts:33-36`
- **Description:** `POST /auth/wallet` accepts any well-formed address — no signature, no
  nonce, only `ethers.getAddress` format validation — and returns a 24h JWT with that
  `walletAddress`. `/access/check` then evaluates the on-chain lock status **of the claimed
  wallet**. Any wallet with ≥ 1,000 IFR locked (public data) yields `granted: true` for the
  attacker. The endpoint is live by default and merely marked deprecated via an `X-Deprecated`
  response header.
- **Impact:** complete bypass of the protocol's central product mechanic (lock-to-access) for
  everything behind this gateway. Not a fund-theft path — hence High, not Critical.
- **Recommendation:** disable `/auth/wallet` outright (remove the route, not just the header).
  If a legacy transition window is truly needed, gate it behind an env flag that defaults off.

#### [CWA-29] creator-gateway: Google OAuth flow binds an arbitrary wallet into the JWT
- **Severity:** High · **Likelihood:** high if deployed · **Status:** Open — works as-coded
- **Component:** `apps/creator-gateway/src/routes/auth.ts:27-64`
- **Description:** `/auth/google?wallet=<address>` carries the wallet in the OAuth `state`
  parameter with no proof of ownership; the callback validates only the address format and
  issues a JWT containing `walletAddress: <victim>` alongside the attacker's Google tokens.
  Equivalent impact to CWA-28 through the "supported" path. Additionally there is no OAuth
  `state` CSRF nonce (login-CSRF class).
- **Recommendation:** bind the wallet only after a SIWE-verified session exists: OAuth
  establishes the Google identity, SIWE proves the wallet, and the JWT is minted only for the
  pair. Add a random `state` nonce stored server-side.

### Medium

#### [CWA-30] creator-gateway: SIWE verification omits domain binding (third instance of this class)
- **Severity:** Medium · **Likelihood:** medium (needs victim signature on a phishing site) · **Status:** Open
- **Component:** `apps/creator-gateway/src/routes/auth.ts:84` — `siweMessage.verify({ signature })`
  without `{ domain }`; nonce store is correct (server-side, single-use, `:87-91`), chainId is
  checked (`:94`).
- **Description:** same bug class as CWA-04 (points-backend) but a different codebase and
  deployment: a SIWE message signed for any other domain is accepted, so a harvested phishing
  signature becomes a JWT for the victim's wallet.
- **Recommendation:** pass `{ domain: <expected> }` to `verify()`. Fix all three instances
  (CWA-04, CWA-30, and check any future SIWE consumer) in one sweep — this class propagates by
  copy-paste.

#### [CWA-31] Telegram verify: nonce from `Math.random` (~31 bits) and no rate limit on `/api/verify`
- **Severity:** Medium · **Likelihood:** low-medium · **Status:** Open — works as-coded
- **Component:** `apps/telegram/telegram-bot/src/services/verificationStore.js:117-119`,
  `index.js:212-269`
- **Description:** the verify nonce is `'IFR-' + Math.random().toString(36).substr(2,6) + timestamp`
  (~2³¹ random space, predictable `Math.random` state, predictable timestamp), TTL 10 minutes,
  and the verify API has **no per-IP/per-nonce attempt limit**. A guessed nonce lets an attacker
  bind their wallet to someone else's Telegram identity. The cryptographic check itself is
  correct (EIP-191 `verifyMessage` against the claimed wallet, single-use, TTL'd).
- **Recommendation:** CSPRNG nonce (`crypto.randomBytes`, ≥128 bits), per-IP + per-nonce attempt
  counters, exponential backoff on failures.

#### [CWA-32] Telegram verify: code is a first-come bearer token, often posted publicly; victim lockout
- **Severity:** Medium · **Likelihood:** medium · **Status:** Open — works as-coded
- **Component:** `apps/telegram/telegram-bot/src/commands/verify.js:28-44` (`ctx.reply` in
  whatever chat invoked `/verify`), `index.js:235` (first submission wins),
  `verify.js:17-26` ("Already verified" short-circuit, no unbind path)
- **Description:** a `/verify` invoked in the public group exposes the code to everyone; whoever
  submits it first binds *their* wallet to the victim's Telegram ID, and the victim can never
  complete verification afterwards (no unbind/re-verify flow).
- **Recommendation:** answer `/verify` only in DM (delete the group invocation), treat the code
  as a secret, add an admin-gated unbind path.

#### [CWA-33] Telegram verify: one wallet can verify unlimited Telegram accounts
- **Severity:** Medium · **Likelihood:** medium · **Status:** Open — works as-coded
- **Component:** `services/verificationStore.js:156-167` — maps keyed by `userId` only; no
  uniqueness on the wallet side.
- **Description:** a single qualifying wallet (e.g. a signer wallet) can mint unlimited
  "verified" Telegram identities into the Core Dev (58), Council (21), Vote (23) and
  Dev & Builder (11) topics — defeating the tier gate as a Sybil control.
- **Recommendation:** enforce `wallet → at most one active userId` (unique index + re-verify
  moves the binding).

#### [CWA-34] Telegram verify: unauthenticated `/api/verify/status/:userId` leaks wallet↔Telegram linkage
- **Severity:** Medium · **Likelihood:** certain (public) · **Status:** Open — works as-coded
- **Component:** `apps/telegram/telegram-bot/src/index.js:271-275`
- **Description:** anyone can enumerate Telegram user IDs and read `{verified, wallet, tier}`
  with full (unmasked) wallet addresses — a deanonymization oracle for every verified member.
  The project's own wiki promises privacy-preserving verification; this endpoint contradicts it.
- **Recommendation:** drop the wallet from the public response (or return a salted hash), add
  rate limiting, consider requiring the request to prove control of the Telegram ID (bot-signed
  token).

### Low

- **[CWA-35] Benefits backend:** read-only seller actions (`business:list`, `sessions:list`,
  `rules:list`, `products:list`, `operators:*`, `rewards:read`) skip the single-use challenge —
  a captured signature triple replays for ≤ 10 minutes (`services/sellerAuthorizationActions.ts:2-9`).
  Mutations are properly challenge-gated; residual read-replay window only.
- **[CWA-36] Benefits backend:** seller authorization message lacks `Domain:`/`Chain ID:`
  binding (unlike the customer challenge, which has both) — same signature is valid on any
  deployment sharing the format (`services/sellerAuth.ts:19-36` vs. `sessionService.ts:445-468`).
- **[CWA-37] Benefits backend:** attest griefing — anyone holding a session ID can burn the
  3 signature attempts (`sessionService.ts:635-694`; the ID also transits unmasked via public
  `GET /api/sessions/:id`); 50/h/IP limiter slows but doesn't stop it. Bounded: kills one
  in-flight checkout; seller can recreate.
- **[CWA-38] Telegram:** hardcoded privilege fallbacks activate when env is unset —
  `PROTECTED_ADMIN_IDS` defaults to a literal user ID `579949616` (`index.js:130-132`); on Safe
  RPC failure **and** unset `SIGNER_WALLETS`, signer tier falls open to the hardcoded deployer
  EOA (`services/onChainReader.js:48-55`). Fail-closed on missing config would be safer.
- **[CWA-39] Telegram verify CORS:** substring origin match (`origin.includes('ifrunit.tech')`
  accepts `ifrunit.tech.evil.example`; empty Origin gets `*`). Contrast: `communityLinks.js`
  does proper origin parsing — apply the same rigor (`index.js:202-209`).
- **[CWA-40] Telegram:** the protected-topic guard (`bot.on('message')`, `index.js:134-167`) is
  registered **after** the command handlers (`:80-96`); Telegraf's first-match semantics let
  `/ask`, `/price`, etc. execute in restricted topics (bot replies leak into them; only plain
  text is deleted). Register the guard first.
- **[CWA-41] creator-gateway:** Google `access_token` is embedded in the client-held HS256 JWT
  (`auth.ts:52-59`) — base64-readable by anyone holding it; any XSS/log capture yields a live
  Google API token. At minimum shorten its scope/expiry; better: keep provider tokens
  server-side.
- **[CWA-42] creator-gateway:** `jwt.verify` without `algorithms:` pinning
  (`middleware/auth.ts:17` — hardening, not a live break with current jsonwebtoken); also
  `ifrLockAddress` default is mainnet-format while `chainId` defaults to 11155111
  (`config/index.ts:4-5`) — a fresh deployment silently checks the wrong chain.

### Informational

- **[CWA-43] Benefits backend hygiene:** `GET /api/businesses/:id[/rules|/products]` lack the
  rate limiter their siblings have; `GET /api/sessions/:id` is unauthenticated **and performs a
  DB write** (auto-expire) — a write-on-GET pattern worth removing (session IDs are cuids, so
  practical exposure is limited to observed ones).
- **[CWA-44] Telegram operational notes:** verified tier is cached until bot restart (a user who
  unlocks keeps Vote-topic access meanwhile — `reverifyFromMap` only re-checks unverified users);
  the wallet map persists to `/tmp/ifr_wallet_map.json` (world-readable on shared hosts; a local
  write there survives restarts via `autoRestoreAll`).
- **[CWA-45] Telegram content trust:** `/ask` interpolates the LLM answer into a Markdown group
  message (prompt-injection → crafted links in the group; cost bounded by 3/h/user + 50/h global
  + 500-char truncation); channel→community auto-sync reposts and pins whatever the bot sees as
  `channel_post` — safe only while the bot is admin in exactly the official channel.

## 3. Positive patterns (verified, do not regress)

- **Redemption atomicity (Benefits):** conditional `updateMany({status:'APPROVED', expiresAt: gt})`
  inside a transaction that first takes the writer lock; daily/monthly caps counted under the
  same lock (`sessionService.ts:714-776`); pass binding claims via `updateMany({status:'OPEN'})`.
- **Challenges are single-use and atomically consumed** (compare-and-set on `consumedAt: null`)
  across seller, customer-history, and customer-pass flows.
- **IDOR closed:** seller mutations re-verify ownership inside the transaction; customers list
  only their own history; passes require a 256-bit control token stored as SHA-256.
- **Fail-closed rate limiting:** Redis outage → 503, boot refused without Redis when configured,
  multi-replica+SQLite topology rejected at config parse.
- **Validation:** zod `.strict()` schemas, address regexes, HTTPS-only credential-free URL
  policy, canonical slugs with reserved-word guards; all raw queries parameterized.
- **On-chain checks:** eligibility re-verifies bytecode, chainId and token address at a single
  block tag; reward verification requires governance alignment + beneficiary match.
- **Admin surface:** static bearer with constant-time compare, ≥32-char + placeholder blocklist
  at boot, per-IP 60/h limiter, pseudonymized audit log on every mutation.
- **SDK:** no secrets, address validation on all entry points, raw-bigint math, and the benefits
  client byte-for-byte validates the server challenge template before signing (anti-phishing).
  Dashboards contain no keys (public Alchemy `demo` fallback only). The wallet prototype is
  deliberately capability-free (Sepolia-only, no transfer/approval paths).

## 4. Prioritized recommendations

1. **creator-gateway (CWA-28/29/30):** remove `/auth/wallet`; require SIWE before any JWT is
   minted; bind Google OAuth to an existing SIWE session; add `domain` to SIWE verify here and
   in points-backend (CWA-04) in one sweep. Until then: do not expose the service publicly.
2. **Telegram verify (CWA-31…34):** DM-only codes, CSPRNG nonces, rate limits, wallet
   uniqueness, masked/absent wallet in status responses.
3. Benefits: domain/chain-bind the seller message (CWA-36), close the read-replay window where
   cheap (CWA-35), move the session auto-expire write off the GET path (CWA-43).
4. Telegram hygiene: guard registration order (CWA-40), strict origin parsing (CWA-39),
   fail-closed config (CWA-38), persist the wallet map outside `/tmp` with 0600 perms (CWA-44).

## 5. Reviewed vs. skipped (honest coverage)

**Reviewed (all security-relevant logic read at the pinned commit):** benefits backend —
`index.ts`, `config.ts`, all middleware, routes `seller/customer/passes/admin/businesses/
sessions/attest`, and the services listed in the findings (incl. `sellerAuth`,
`sellerAuthorizationChallenge(s/Actions)`, `rateLimitInfrastructure`, `rateLimitTopology`,
`adminSecretPolicy`, `adminAudit`, `sessionService`, `customerPassService`, `customerHistoryAuth`,
`sellerAccess`, `sellerLimits`, `sellerLimitPolicy`, `businessLifecycle`, `businessProfile`,
`businessSlug`, `productPrice`, `lockSource`, `ifrLockService`, `rewardService`), Prisma schema.
Telegram bot — `index.js` incl. the verify API, all admin commands, `verify.js`,
`handlers/verification.js`, `verificationStore.js`, `onChainReader.js`, `skywalker.js`,
`moderation.js`, `communityLinks.js`, `bootstrapListener.js`, `governanceNotifier.js`, Dockerfile,
railway.json. creator-gateway — all of `src/`. SDK — `index.ts`, `benefits.ts`. dashboards —
config/hooks/key components. benefits-wallet-prototype — all of `src/`.

**Skipped:** benefits-network frontend (Next.js client code beyond the skimmed libs), builder
app, indexer stubs, `patches/` archive. Not executed anywhere: no dynamic testing, no live
deployment probing — every finding is static-analysis-based; "works as-coded" means the code
path exists as written, not that it was exploited.

## 6. Limitations & disclaimer

Static review at the stated commit; no guarantee of completeness; not financial or legal advice.
The two High findings' real-world impact depends on whether creator-gateway is publicly deployed
— that could not be determined read-only. Verify deployment status first, then prioritize
accordingly.

— Collateral Web3 Open Audits, 2026-09-14
