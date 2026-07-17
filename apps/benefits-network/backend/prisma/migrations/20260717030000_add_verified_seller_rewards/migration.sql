CREATE TABLE "SellerRewardLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "partnerId" TEXT,
    "builderWallet" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" DATETIME,
    "lastCheckedAt" DATETIME,
    "verificationBlock" TEXT,
    "governanceReference" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SellerRewardLink_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "RewardEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "customerWallet" TEXT NOT NULL,
    "lockAmountRaw" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "txHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RewardEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RewardEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SellerRewardLink_businessId_key" ON "SellerRewardLink"("businessId");
CREATE UNIQUE INDEX "SellerRewardLink_partnerId_key" ON "SellerRewardLink"("partnerId");
CREATE UNIQUE INDEX "RewardEvent_sessionId_key" ON "RewardEvent"("sessionId");
CREATE UNIQUE INDEX "RewardEvent_customerWallet_partnerId_key" ON "RewardEvent"("customerWallet", "partnerId");
CREATE INDEX "RewardEvent_businessId_status_idx" ON "RewardEvent"("businessId", "status");
CREATE INDEX "RewardEvent_partnerId_idx" ON "RewardEvent"("partnerId");
