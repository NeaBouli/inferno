-- Add seller-managed products/services while preserving existing rule display snapshots.
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "BenefitRule" ADD COLUMN "productId" TEXT REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Session" ADD COLUMN "benefitSnapshotVersion" INTEGER;
ALTER TABLE "Session" ADD COLUMN "benefitLabel" TEXT;
ALTER TABLE "Session" ADD COLUMN "benefitCategory" TEXT;
ALTER TABLE "Session" ADD COLUMN "benefitProductName" TEXT;
ALTER TABLE "Session" ADD COLUMN "benefitDiscountPercent" INTEGER;
ALTER TABLE "Session" ADD COLUMN "benefitRequiredLockIFR" INTEGER;
ALTER TABLE "Session" ADD COLUMN "benefitTtlSeconds" INTEGER;

CREATE INDEX "Product_businessId_active_idx" ON "Product"("businessId", "active");
CREATE INDEX "Product_category_idx" ON "Product"("category");
CREATE INDEX "BenefitRule_productId_idx" ON "BenefitRule"("productId");
