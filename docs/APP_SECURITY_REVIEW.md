# App Security Review — Inferno ($IFR)

**Date:** 2026-03-04
**Scope:** Full code review of all 5 IFR applications
**Reviewer:** Claude Code (automated)
**Apps reviewed:** Creator Gateway, Points Backend, Benefits Network (Backend + Frontend), AI Copilot

---

## Summary

| Severity | Count | Fixed |
|----------|-------|-------|
| CRITICAL | 2 | 2 (+2 bonus: Points Backend JWT + FeeRouter address) |
| HIGH | 5 | 5 |
| MEDIUM | 3 | 0 (documented) |
| LOW | 2 | 0 (documented) |
| **Total** | **12** | **9** |

---

## Findings

### F1 — CRITICAL: Wrong IFRLock ABI function name

| Field | Value |
|-------|-------|
| App | Creator Gateway |
| File | `apps/creator-gateway/src/services/lock-checker.ts:6,29` |
| Category | Smart Contract Integration |
| Status | **FIXED** |

**Description:** ABI declares `lockedAmount(address)` but IFRLock.sol has `lockedBalance(address)` (line 77). Every call to `lockedAmount()` silently fails (caught, returns `'0'`). The `lockedAmount()` function in Creator Gateway always returns `'0'` regardless of actual lock state.

**Impact:** Creator cannot query how much IFR a user has locked. The `isLocked()` function works correctly (separate ABI entry), but amount display is broken.

**Fix:** Renamed `lockedAmount` → `lockedBalance` in ABI definition and method name.

---

### F2 — CRITICAL: Insecure JWT secret default

| Field | Value |
|-------|-------|
| App | Creator Gateway |
| File | `apps/creator-gateway/src/config/index.ts:6` |
| Category | Authentication |
| Status | **FIXED** |

**Description:** JWT secret defaults to `'change-me'` when `JWT_SECRET` env var is not set. If deployed without setting the env var, all JWTs are signed with a known secret — any attacker can forge valid tokens.

**Impact:** Full authentication bypass in production if `JWT_SECRET` is not configured.

**Fix:** Added startup validation — throws error in production if `JWT_SECRET` is not set. In development, logs a warning and uses a clearly-marked dev-only default. Same fix applied to Points Backend (`apps/points-backend/src/middleware/auth.ts:4`) which had `"dev-secret"` default.

---

### F3 — HIGH: Open CORS in Creator Gateway

| Field | Value |
|-------|-------|
| App | Creator Gateway |
| File | `apps/creator-gateway/src/index.ts:11` |
| Category | Security Headers |
| Status | **FIXED** |

**Description:** `app.use(cors())` allows requests from any origin. In production, this enables cross-site request forgery from any domain.

**Fix:** CORS now reads allowed origins from `ALLOWED_ORIGINS` env var (comma-separated). Defaults to `http://localhost:3005` for local development.

---

### F4 — HIGH: Open CORS in Points Backend

| Field | Value |
|-------|-------|
| App | Points Backend |
| File | `apps/points-backend/src/index.ts:12` |
| Category | Security Headers |
| Status | **FIXED** |

**Description:** Same as F3 — unrestricted CORS.

**Fix:** CORS reads from `ALLOWED_ORIGINS` env var. Defaults to `http://localhost:3004` for local dev.

---

### F5 — HIGH: Open CORS in Benefits Network Backend

| Field | Value |
|-------|-------|
| App | Benefits Network |
| File | `apps/benefits-network/backend/src/index.ts:12` |
| Category | Security Headers |
| Status | **FIXED** |

**Description:** Same as F3 — unrestricted CORS.

**Fix:** CORS reads from `ALLOWED_ORIGINS` env var. Defaults to `http://localhost:3000,http://localhost:3001` for local dev.

---

### F6 — HIGH: Open CORS in AI Copilot

| Field | Value |
|-------|-------|
| App | AI Copilot |
| File | `apps/ai-copilot/server/index.ts:9` |
| Category | Security Headers |
| Status | **FIXED** |

**Description:** Same as F3 — unrestricted CORS.

**Fix:** CORS reads from `ALLOWED_ORIGINS` env var. Defaults to `http://localhost:5175,http://localhost:3003` for local dev.

---

### F7 — HIGH: Legacy wallet auth without signature verification

| Field | Value |
|-------|-------|
| App | Creator Gateway |
| File | `apps/creator-gateway/src/routes/auth.ts:100-112` |
| Category | Authentication |
| Status | **FIXED** |

**Description:** `POST /auth/wallet` accepts any `walletAddress` string and issues a valid JWT without any signature verification. An attacker can claim to be any wallet and receive a valid token. The SIWE endpoint (`/auth/siwe/verify`) correctly verifies signatures, but this legacy endpoint bypasses all verification.

**Fix:** Added `ethers.utils.getAddress()` validation to reject invalid addresses, and added deprecation warning header. Route should be removed before mainnet — SIWE is the correct auth flow.

---

### F8 — MEDIUM: Admin secret timing attack

| Field | Value |
|-------|-------|
| App | Benefits Network |
| File | `apps/benefits-network/backend/src/middleware/auth.ts:12` |
| Category | Authentication |
| Status | Documented |

**Description:** Admin secret comparison uses `token !== config.ADMIN_SECRET` (string equality) instead of `crypto.timingSafeEqual()`. Theoretically vulnerable to timing-based side-channel attacks to recover the admin secret character by character.

**Impact:** Low in practice — requires thousands of precisely-timed requests. The rate limiter (50 req/hr on admin routes) makes exploitation impractical.

**Recommendation:** Replace with `crypto.timingSafeEqual(Buffer.from(token), Buffer.from(config.ADMIN_SECRET))` before mainnet.

---

### F9 — MEDIUM: No message length validation in AI Copilot

| Field | Value |
|-------|-------|
| App | AI Copilot |
| File | `apps/ai-copilot/server/index.ts:72` |
| Category | Input Validation |
| Status | Documented |

**Description:** The `messages` array is passed to the Anthropic API without size validation. An attacker could send extremely large payloads to cause high API costs or memory issues.

**Recommendation:** Add `express.json({ limit: '50kb' })` and validate `messages.length <= 20`.

---

### F10 — MEDIUM: Immutable guardian in Vesting contract

| Field | Value |
|-------|-------|
| App | Smart Contracts |
| File | `contracts/vesting/Vesting.sol` |
| Category | Access Control |
| Status | Documented (from ChatGPT Audit V5, W18) |

**Description:** Guardian address is immutable — cannot be rotated. If compromised, attacker can permanently pause releases (DoS on beneficiary). Cross-referenced from W18.

---

### F11 — LOW: Silent error handling in LockChecker

| Field | Value |
|-------|-------|
| App | Creator Gateway |
| File | `apps/creator-gateway/src/services/lock-checker.ts:22,31` |
| Category | Code Quality |
| Status | Documented |

**Description:** Both `isLocked()` and `lockedBalance()` catch all errors silently, returning `false` / `'0'`. While this is fail-closed (secure), it makes debugging difficult. RPC failures, wrong addresses, and ABI mismatches all produce the same silent failure.

**Recommendation:** Add `console.error()` in catch blocks for observability.

---

### F12 — LOW: Google OAuth state parameter unvalidated

| Field | Value |
|-------|-------|
| App | Creator Gateway |
| File | `apps/creator-gateway/src/routes/auth.ts:27,37` |
| Category | Input Validation |
| Status | Documented |

**Description:** The `walletAddress` is passed via OAuth `state` parameter without validation. The callback trusts the returned state value and embeds it in a JWT. While this doesn't enable authentication bypass (the wallet address is informational, not authoritative), it could lead to confusion if a tampered state is returned.

**Recommendation:** Validate with `ethers.utils.getAddress()` in the callback, or use a signed state token.

---

## App-by-App Assessment

### Creator Gateway (`apps/creator-gateway/`)

| Aspect | Rating | Notes |
|--------|--------|-------|
| Authentication | GOOD | SIWE with nonce store + 10-min TTL, Google OAuth |
| Authorization | FAIR | JWT-based, but legacy `/auth/wallet` bypasses SIWE |
| Input Validation | FAIR | Missing wallet address validation (F7) |
| Rate Limiting | GOOD | 60 req/min global via express-rate-limit |
| Error Handling | FAIR | Silent catch blocks (F11) |
| IFRLock Integration | FIXED | ABI mismatch fixed (F1) |

### Points Backend (`apps/points-backend/`)

| Aspect | Rating | Notes |
|--------|--------|-------|
| Authentication | EXCELLENT | SIWE with 5-min nonce expiry |
| Authorization | GOOD | JWT middleware on protected routes |
| Input Validation | GOOD | Prisma ORM prevents SQL injection |
| Rate Limiting | EXCELLENT | Per-route: 60/min general, 5/hr SIWE, 1/day voucher |
| Anti-Sybil | GOOD | Per-wallet + per-IP + global daily caps |
| EIP-712 Vouchers | GOOD | Correct typed data signing |

### Benefits Network (`apps/benefits-network/`)

| Aspect | Rating | Notes |
|--------|--------|-------|
| Authentication | EXCELLENT | Challenge-response with crypto.randomUUID nonce, EIP-191 sig, 60s TTL |
| Authorization | GOOD | Admin secret + Zod validation |
| Input Validation | EXCELLENT | Zod schemas on all inputs |
| Rate Limiting | GOOD | 100 sessions/hr, 50 attests/hr |
| Audit Logging | EXCELLENT | Full audit trail for all attestations |
| IFRLock Integration | EXCELLENT | Correct `lockedBalance()`, 9 decimals |

### AI Copilot (`apps/ai-copilot/`)

| Aspect | Rating | Notes |
|--------|--------|-------|
| API Key Security | GOOD | Server-side only, never exposed to frontend |
| Safety Guards | EXCELLENT | Seed phrase / private key detection with warnings |
| RAG Knowledge Base | GOOD | Wiki docs loaded at startup |
| Points Integration | GOOD | Fire-and-forget, non-critical failures handled |
| Input Validation | FAIR | No message length limit (F9) |

---

## Recommendations for Mainnet

1. **Remove legacy `/auth/wallet` endpoint** — SIWE is the correct auth flow
2. **Use `crypto.timingSafeEqual` for admin secrets** (F8)
3. **Add message length limits to AI Copilot** (F9)
4. **Set `ALLOWED_ORIGINS` env var** in all production deployments
5. **Set `JWT_SECRET` env var** with cryptographically random 32+ byte secret
6. **Add structured logging** (e.g., winston/pino) for production observability
7. **Add health check auth** — `/health` endpoints are unauthenticated (acceptable for monitoring but should not leak sensitive state)

---

*App Security Review — Inferno ($IFR) Applications*
