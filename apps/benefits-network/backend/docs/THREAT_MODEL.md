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
- `ethers.utils.verifyMessage()` recovers the actual signer address deterministically
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
- Session creation: max 100 per business per hour (express-rate-limit)
- Attest attempts: max 3 per session (enforced in database)
- Global attest rate limit: max 50 per IP per hour
- Failed attestations before the third attempt keep the stored session PENDING so a real customer can recover from an insufficient lock or bad wallet prompt without asking the seller for a new QR
- After 3 failed attempts, the session becomes terminal REJECTED and cannot accept more attestations
- TTL, nonce binding and the three-attempt limit still bound the retry window

## 6. Seller Account Takeover / Unauthorized Staff Actions

**Threat:** A non-owner tries to list rules, inspect session history or redeem a customer benefit for a seller business.

**Mitigation:**
- Seller actions require short-lived, server-issued wallet messages
- Owner-only actions require the recovered signer to match `Business.ownerAddress`
- Session history uses `Action: sessions:list` and is limited to the owned business
- Checkout operators are unique per business, owner-managed, revocable and optionally expiring
- Operators can only check their checkout role and redeem; profile, rule, history and delegation routes remain owner-only
- Redeem uses `Action: sessions:redeem` with the specific session id and rechecks current owner/operator access
- Redeem uses a conditional database update so concurrent requests still produce one redemption and one audit event
- Audit data stores actor wallet/role but not the wallet signature

## 7. Session History Data Exposure

**Threat:** Session history reveals more customer or checkout data than the seller needs.

**Mitigation:**
- Session history is not public; it requires the business owner wallet signature
- The endpoint returns recent operational fields only: status, recovered wallet, locked amount, reason, timestamps and benefit metadata
- Customer signatures and raw challenge messages are not returned in the seller history response
- The `limit` query is clamped to 1-50 to prevent large bulk exports

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
