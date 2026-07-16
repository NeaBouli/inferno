-- AlterTable
ALTER TABLE "Session" ADD COLUMN "benefitRuleId" TEXT REFERENCES "BenefitRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Session_benefitRuleId_idx" ON "Session"("benefitRuleId");
