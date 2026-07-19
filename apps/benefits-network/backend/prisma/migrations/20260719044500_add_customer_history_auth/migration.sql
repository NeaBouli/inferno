CREATE INDEX "Session_customerHistory_idx"
ON "Session"("recoveredAddress", "createdAt", "id");

CREATE TABLE "CustomerHistoryChallenge" (
  "nonce" TEXT NOT NULL PRIMARY KEY,
  "walletAddress" TEXT NOT NULL,
  "issuedAt" DATETIME NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "consumedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "CustomerHistoryChallenge_expiresAt_idx"
ON "CustomerHistoryChallenge"("expiresAt");

CREATE INDEX "CustomerHistoryChallenge_walletAddress_consumedAt_idx"
ON "CustomerHistoryChallenge"("walletAddress", "consumedAt");

CREATE TABLE "CustomerHistoryAccess" (
  "tokenHash" TEXT NOT NULL PRIMARY KEY,
  "walletAddress" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "CustomerHistoryAccess_expiresAt_idx"
ON "CustomerHistoryAccess"("expiresAt");

CREATE INDEX "CustomerHistoryAccess_walletAddress_expiresAt_idx"
ON "CustomerHistoryAccess"("walletAddress", "expiresAt");
