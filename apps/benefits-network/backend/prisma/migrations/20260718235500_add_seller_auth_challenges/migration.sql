CREATE TABLE "SellerAuthorizationChallenge" (
  "nonce" TEXT NOT NULL PRIMARY KEY,
  "walletAddress" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "consumedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "SellerAuthorizationChallenge_expiresAt_idx"
ON "SellerAuthorizationChallenge"("expiresAt");

CREATE INDEX "SellerAuthorizationChallenge_walletAddress_action_businessId_idx"
ON "SellerAuthorizationChallenge"("walletAddress", "action", "businessId");
