-- Owner-managed checkout wallets may redeem approved sessions without receiving profile or rule permissions.
CREATE TABLE "CheckoutOperator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CheckoutOperator_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CheckoutOperator_businessId_walletAddress_key" ON "CheckoutOperator"("businessId", "walletAddress");
CREATE INDEX "CheckoutOperator_businessId_active_idx" ON "CheckoutOperator"("businessId", "active");
CREATE INDEX "CheckoutOperator_walletAddress_idx" ON "CheckoutOperator"("walletAddress");
