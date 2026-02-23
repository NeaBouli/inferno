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
- After 3 failed attempts, the session is locked and cannot accept more attestations
