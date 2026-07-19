# IFR Benefits Network — Threat Model

## 1. Screenshot / Video Attack

**Threat:** Attacker screenshots or records a customer's APPROVED screen and shows it to a merchant.

**Mitigation:**
- Each session has a unique nonce (32 bytes random) and a TTL (default 60 seconds)
- After TTL, the session expires and cannot be redeemed
- One-time redeem: once a session is redeemed, it cannot be reused
- The merchant must press "Redeem" within the TTL window

## 2. Wallet Spoofing (Showing Someone Else's Wallet)

**Threat:** Attacker claims to own a wallet with locked IFR by displaying someone else's address.

**Mitigation:**
- The customer must sign a challenge message with their private key
- `ethers.verifyMessage()` recovers the actual signer address deterministically
- Without the private key, it is cryptographically impossible to produce a valid signature
- The recovered address (not the claimed address) is checked against IFRLock

## 3. Nonce Reuse / Replay Attack

**Threat:** Attacker captures a valid signature and replays it on a different session.

**Mitigation:**
- Each session has a unique nonce embedded in the challenge message
- The nonce has a `@unique` constraint in the database
- The signature is only valid for the exact message (including session ID, nonce, expiry)
- A signature from session A cannot pass verification for session B

## 4. RPC Failure / On-Chain Error

**Threat:** The RPC node is down or returns incorrect data, causing false approvals.

**Mitigation:**
- On-chain errors are propagated as errors, never as approvals
- If `ifrLock.isLocked()` throws, the session remains PENDING (not APPROVED)
- The attest endpoint returns a 500 error, not a false positive
- Merchants see "verification failed" rather than "approved"

## 5. Brute Force / Rate Limiting

**Threat:** Attacker floods the API with session creation or attest attempts.

**Mitigation:**
- Session creation: pre-auth IP budget plus a post-auth budget charged only to the recovered seller wallet
- QR creation requires a server-issued, single-use `sessions:create` challenge bound to the recovered wallet, business and selected rule
- Challenge consumption, current owner/operator recheck and session creation share one database transaction
- Attest attempts: max 3 per session (enforced in database)
- Global attest rate limit: max 50 per IP per hour
- Auth-message and challenge reads are IP-limited
- Only private/loopback proxy hops are trusted when resolving the public client IP; arbitrary forwarded headers are not trusted directly
- Failed attestations before the third attempt keep the stored session PENDING so a real customer can recover from an insufficient lock or bad wallet prompt without asking the seller for a new QR
- After 3 failed attempts, the session becomes terminal REJECTED and cannot accept more attestations
- TTL, nonce binding and the three-attempt limit still bound the retry window

## 6. Seller Account Takeover / Unauthorized Staff Actions

**Threat:** A non-owner tries to list rules, inspect session history or redeem a customer benefit for a seller business.

**Mitigation:**
- Seller actions require short-lived, server-issued wallet messages
- Every mutating seller action uses a persisted random nonce bound to wallet, action, business and exact target resource; replay, wrong-action and wrong-scope use are rejected
- Read-only seller actions remain timestamp-bound and do not write challenge rows
- Pre-auth rate limits never key on the claimed wallet; wallet budgets are charged only after signature recovery
- Owner-only actions require the recovered signer to match `Business.ownerAddress`
- Session history uses `Action: sessions:list` and is limited to the owned business
- Checkout operators are unique per business, owner-managed, revocable and optionally expiring
- Operators can only check their checkout role and create/redeem QR sessions; profile, rule, history and delegation routes remain owner-only
- Redeem uses a one-time `Action: sessions:redeem` challenge with the specific session id as both business and scope, then rechecks current owner/operator access
- Redeem uses a conditional database update so concurrent requests still produce one redemption and one audit event
- Audit data stores actor wallet/role but not the wallet signature

## 7. Session History Data Exposure

**Threat:** Session history reveals more customer or checkout data than the seller needs.

**Mitigation:**
- Session history is not public; it requires the business owner wallet signature
- The endpoint returns recent operational fields only: status, recovered wallet, locked amount, reason, timestamps and benefit metadata
- Customer signatures and raw challenge messages are not returned in the seller history response
- The `limit` query is clamped to 1-50 to prevent large bulk exports

## 7a. Public Proof-Link Privacy

**Threat:** Anyone who receives or later discovers a customer proof link correlates a wallet
address with a seller, benefit rule, exact lock amount or detailed rejection reason.

**Mitigation:**
- Public session status never returns the recovered customer address or exact rejection details
- Rejected and expired sessions expose only a generic terminal message
- Public status, challenge and attest responses use `Cache-Control: private, no-store`
- The signing customer receives their own detailed attest result only in the direct response
- Detailed operational history remains behind the business owner's wallet signature

## 8. Catalog Tampering / Mutable Checkout Terms

**Threat:** A seller binds a rule to another business's product, or edits a product/rule after
creating a QR so the customer signs different terms than the seller originally presented.

**Mitigation:**
- Product CRUD is owner-wallet protected and scoped to the owned business
- Rule binding accepts only an active product from the same business
- Product name/category are copied into the rule as display snapshots
- QR creation copies label, category, product, discount, required IFR and TTL into a versioned session snapshot
- Challenge, attest, status and seller history read the immutable session snapshot for new sessions
- Product archive is a soft archive and atomically pauses active linked rules; historical sessions/audits remain intact
- Legacy sessions without a snapshot version use the prior relation fallback for backward compatibility

## 9. Reward Fraud / Governance Drift / Double Submission

**Threat:** An unverified seller, removed builder, inactive partner, seller-owned customer wallet,
or retried worker causes an unauthorized or duplicate PartnerVault reward.

**Mitigation:**
- Seller application is not approval and cannot set a PartnerVault ID
- Admin verification reads configured-chain bytecode, aligned BuilderRegistry owner / PartnerVault admin,
  active builder state, active partner state and matching owner/beneficiary before storing `VERIFIED`
- Successful redeem creates at most one `PENDING` outbox event in the same transaction; unique session and
  `(customerWallet, partnerId)` constraints mirror PartnerVault anti-double-count semantics
- Seller-owner and currently active checkout-operator wallets are excluded from the reward outbox
- Reconciliation repeats all live governance checks and reads `walletRewardClaimed` before marking an event ready
- Builder removal or partner deactivation marks the local link stale and prevents readiness
- The Benefits backend contains no private key or transaction signer and never calls `recordLockReward`
- `READY` is not a reward quote, submission, confirmation or payment; effective BPS, caps and vesting remain on-chain

**Known policy boundary:** The verified amount is the customer's current IFRLock balance observed during checkout,
not cryptographic proof that a new lock transaction was caused by that seller. Governance must approve this
one-wallet/one-partner usage policy or require a future event-indexed lock adapter before enabling submissions.
