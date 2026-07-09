-- CreateTable
CREATE TABLE "BenefitRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL,
    "requiredLockIFR" INTEGER NOT NULL,
    "ttlSeconds" INTEGER NOT NULL DEFAULT 90,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BenefitRule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BenefitRule_businessId_idx" ON "BenefitRule"("businessId");

-- CreateIndex
CREATE INDEX "BenefitRule_active_idx" ON "BenefitRule"("active");
