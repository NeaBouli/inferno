-- T-231b / owner decision B (2026-10-06): no customer wallet address, derivative or stable customer
-- identifier is persisted. Explicit, irreversible DDL; needs its own reviewed migration release
-- (stop backend -> verified backup -> migrate -> VACUUM -> start). See
-- docs/BENEFITS_CUSTOMER_PRIVACY_MIGRATION.md.

-- 1. Refusal guard (runs first, changes nothing). Fail closed on an explicit allowlist: the only
--    reward status treated as finished is CONFIRMED (recorded on-chain). Every other status - open,
--    blocked, settlement-pending or any unknown/unexpected value - aborts the migration. Obligations
--    must be resolved under the previous release first; nothing is deleted, and elapsed time
--    (e.g. periodEnd + 72h) is never treated as settlement.
CREATE TEMP TABLE "owner_b_migration_guard" (
    "non_terminal_reward_events_must_be_resolved_first" INTEGER NOT NULL
        CHECK ("non_terminal_reward_events_must_be_resolved_first" = 0)
);
INSERT INTO "owner_b_migration_guard" ("non_terminal_reward_events_must_be_resolved_first")
SELECT COUNT(*) FROM "RewardEvent" WHERE "status" IS NULL OR "status" NOT IN ('CONFIRMED');
DROP TABLE "owner_b_migration_guard";

-- Everything below runs in ONE transaction: a failure at any later statement rolls back the
-- invalidation, the audit scrub and the DDL together (verified with a forced late failure).
-- Foreign-key enforcement is switched off outside the transaction (PRAGMA foreign_keys is a no-op
-- inside one) for the SQLite table redefinition, and checked again after COMMIT.
PRAGMA foreign_keys=OFF;
BEGIN;

-- 2a. Legacy session reasons. Closed sessions (REJECTED/EXPIRED/REDEEMED or any other non-open status)
--     may hold customer balance or per-wallet limit text from earlier releases (e.g. "<n> IFR held < <m>
--     IFR required", "Insufficient wallet balance: ...", "... for this wallet"). Their reason is replaced
--     by one fixed neutral text, independent of its content. Open sessions are handled in step 2.
UPDATE "Session"
SET "reason" = 'Closed before the customer-privacy upgrade; details removed.'
WHERE "status" NOT IN ('PENDING', 'APPROVED') AND "reason" IS NOT NULL;

-- 2. In-flight invalidation. Checkouts live for minutes. Open checkouts from before the cutover have
--    no recorded seller confirmation and APPROVED ones no proof-v2 outcome, so all fail closed.
UPDATE "Session"
SET "status" = 'EXPIRED', "reason" = 'Checkout closed by the customer-privacy upgrade; start a new checkout.'
WHERE "status" IN ('PENDING', 'APPROVED');
UPDATE "CustomerPass" SET "status" = 'EXPIRED' WHERE "status" IN ('OPEN', 'BOUND');

-- 3. Scrub customer values from existing audit payloads (seller identities stay). Type-independent:
--    every historic writer's customer keys (wallet, held, locked, verificationBlock, per-customer
--    counter used) are removed from every payload. ATTEST_FAIL free text (reason, error) may embed the
--    customer address (RPC calldata) or balances and is removed as well. Invalid JSON payloads are
--    left untouched here and make scripts/verify-owner-b-migration.cjs fail closed.
UPDATE "AuditLog"
SET "payload" = json_remove("payload", '$.wallet', '$.held', '$.locked', '$.verificationBlock', '$.used')
WHERE json_valid("payload");
UPDATE "AuditLog"
SET "payload" = json_remove("payload", '$.reason', '$.error')
WHERE "type" = 'ATTEST_FAIL' AND json_valid("payload");

-- 4. Drop customer tables (all customer history read tokens become invalid) and customer columns.
-- DropIndex
DROP INDEX "CustomerHistoryAccess_walletAddress_expiresAt_idx";

-- DropIndex
DROP INDEX "CustomerHistoryAccess_expiresAt_idx";

-- DropIndex
DROP INDEX "CustomerHistoryChallenge_walletAddress_consumedAt_idx";

-- DropIndex
DROP INDEX "CustomerHistoryChallenge_expiresAt_idx";

-- DropIndex
DROP INDEX "CustomerPassChallenge_walletAddress_consumedAt_idx";

-- DropIndex
DROP INDEX "CustomerPassChallenge_expiresAt_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CustomerHistoryAccess";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CustomerHistoryChallenge";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CustomerPassChallenge";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CustomerPass" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "controlHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "expiresAt" DATETIME NOT NULL,
    "boundAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CustomerPass" ("boundAt", "cancelledAt", "controlHash", "createdAt", "expiresAt", "id", "status", "updatedAt") SELECT "boundAt", "cancelledAt", "controlHash", "createdAt", "expiresAt", "id", "status", "updatedAt" FROM "CustomerPass";
DROP TABLE "CustomerPass";
ALTER TABLE "new_CustomerPass" RENAME TO "CustomerPass";
CREATE UNIQUE INDEX "CustomerPass_controlHash_key" ON "CustomerPass"("controlHash");
CREATE INDEX "CustomerPass_status_expiresAt_idx" ON "CustomerPass"("status", "expiresAt");
CREATE TABLE "new_RewardEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "txHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RewardEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RewardEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RewardEvent" ("businessId", "chainId", "createdAt", "id", "partnerId", "reason", "sessionId", "status", "txHash", "updatedAt") SELECT "businessId", "chainId", "createdAt", "id", "partnerId", "reason", "sessionId", "status", "txHash", "updatedAt" FROM "RewardEvent";
DROP TABLE "RewardEvent";
ALTER TABLE "new_RewardEvent" RENAME TO "RewardEvent";
CREATE UNIQUE INDEX "RewardEvent_sessionId_key" ON "RewardEvent"("sessionId");
CREATE INDEX "RewardEvent_businessId_status_idx" ON "RewardEvent"("businessId", "status");
CREATE INDEX "RewardEvent_partnerId_idx" ON "RewardEvent"("partnerId");
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "benefitRuleId" TEXT,
    "benefitSnapshotVersion" INTEGER,
    "benefitLabel" TEXT,
    "benefitCategory" TEXT,
    "benefitProductName" TEXT,
    "benefitBasePriceMinor" TEXT,
    "benefitCurrency" TEXT,
    "benefitDiscountPercent" INTEGER,
    "benefitRequiredLockIFR" INTEGER,
    "benefitMinIFRHeld" INTEGER,
    "benefitLockSource" TEXT,
    "benefitTtlSeconds" INTEGER,
    "benefitDailyRedemptionLimit" INTEGER,
    "benefitMonthlyRedemptionLimit" INTEGER,
    "nonce" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "verifiedLockSource" TEXT,
    "selfRedemption" BOOLEAN,
    "proofVersion" INTEGER,
    "confirmedByWallet" TEXT,
    "confirmedByRole" TEXT,
    "confirmedByOperatorId" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "redeemedAt" DATETIME,
    "attestAttempts" INTEGER NOT NULL DEFAULT 0,
    "customerPassId" TEXT,
    CONSTRAINT "Session_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Session_benefitRuleId_fkey" FOREIGN KEY ("benefitRuleId") REFERENCES "BenefitRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Session_customerPassId_fkey" FOREIGN KEY ("customerPassId") REFERENCES "CustomerPass" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("attestAttempts", "benefitBasePriceMinor", "benefitCategory", "benefitCurrency", "benefitDailyRedemptionLimit", "benefitDiscountPercent", "benefitLabel", "benefitLockSource", "benefitMinIFRHeld", "benefitMonthlyRedemptionLimit", "benefitProductName", "benefitRequiredLockIFR", "benefitRuleId", "benefitSnapshotVersion", "benefitTtlSeconds", "businessId", "createdAt", "customerPassId", "expiresAt", "id", "nonce", "reason", "redeemedAt", "status", "updatedAt", "verifiedLockSource") SELECT "attestAttempts", "benefitBasePriceMinor", "benefitCategory", "benefitCurrency", "benefitDailyRedemptionLimit", "benefitDiscountPercent", "benefitLabel", "benefitLockSource", "benefitMinIFRHeld", "benefitMonthlyRedemptionLimit", "benefitProductName", "benefitRequiredLockIFR", "benefitRuleId", "benefitSnapshotVersion", "benefitTtlSeconds", "businessId", "createdAt", "customerPassId", "expiresAt", "id", "nonce", "reason", "redeemedAt", "status", "updatedAt", "verifiedLockSource" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE UNIQUE INDEX "Session_nonce_key" ON "Session"("nonce");
CREATE UNIQUE INDEX "Session_customerPassId_key" ON "Session"("customerPassId");
CREATE INDEX "Session_businessId_idx" ON "Session"("businessId");
CREATE INDEX "Session_benefitRuleId_idx" ON "Session"("benefitRuleId");
CREATE INDEX "Session_redemptionLimitLookup_idx" ON "Session"("benefitRuleId", "status", "redeemedAt");
CREATE INDEX "Session_status_idx" ON "Session"("status");
-- Seller authorization challenges become nonce-only (no wallet column): the signer is bound by the
-- signature alone. Existing rows are short-lived single-use challenges and are deleted, not copied;
-- sellers simply request a new challenge.
CREATE TABLE "new_SellerAuthorizationChallenge" (
    "nonce" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DROP TABLE "SellerAuthorizationChallenge";
ALTER TABLE "new_SellerAuthorizationChallenge" RENAME TO "SellerAuthorizationChallenge";
CREATE INDEX "SellerAuthorizationChallenge_expiresAt_idx" ON "SellerAuthorizationChallenge"("expiresAt");
CREATE INDEX "SellerAuthorizationChallenge_action_businessId_idx" ON "SellerAuthorizationChallenge"("action", "businessId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
COMMIT;
PRAGMA foreign_keys=ON;
