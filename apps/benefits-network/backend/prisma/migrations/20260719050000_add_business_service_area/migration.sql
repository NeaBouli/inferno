ALTER TABLE "Business" ADD COLUMN "serviceArea" TEXT;
ALTER TABLE "Business" ADD COLUMN "serviceAreaKey" TEXT;

CREATE INDEX "Business_active_serviceAreaKey_idx"
ON "Business"("active", "serviceAreaKey");
