-- Existing rules and sessions remain unlimited. New limits are opt-in per benefit rule.
ALTER TABLE "BenefitRule" ADD COLUMN "dailyRedemptionLimit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BenefitRule" ADD COLUMN "monthlyRedemptionLimit" INTEGER NOT NULL DEFAULT 0;

-- Session snapshots freeze the policy that was shown when the checkout QR was created.
ALTER TABLE "Session" ADD COLUMN "benefitDailyRedemptionLimit" INTEGER;
ALTER TABLE "Session" ADD COLUMN "benefitMonthlyRedemptionLimit" INTEGER;

CREATE INDEX "Session_redemptionLimitLookup_idx"
ON "Session"("benefitRuleId", "status", "redeemedAt");
