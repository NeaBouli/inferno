-- Additive EXT-10 prerequisite only. Existing events remain non-payable; no customer backfill.
ALTER TABLE "RewardEvent" ADD COLUMN "rewardPeriod" TEXT;
ALTER TABLE "RewardEvent" ADD COLUMN "rewardDedupKey" TEXT;
CREATE UNIQUE INDEX "RewardEvent_partner_period_dedup_key"
ON "RewardEvent"("partnerId", "rewardPeriod", "rewardDedupKey");
