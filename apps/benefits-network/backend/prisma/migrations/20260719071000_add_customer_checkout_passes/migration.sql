CREATE TABLE "CustomerPassChallenge" (
  "nonce" TEXT NOT NULL PRIMARY KEY,
  "walletAddress" TEXT NOT NULL,
  "issuedAt" DATETIME NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "consumedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "CustomerPassChallenge_expiresAt_idx"
ON "CustomerPassChallenge"("expiresAt");

CREATE INDEX "CustomerPassChallenge_walletAddress_consumedAt_idx"
ON "CustomerPassChallenge"("walletAddress", "consumedAt");

CREATE TABLE "CustomerPass" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "walletAddress" TEXT NOT NULL,
  "controlHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "expiresAt" DATETIME NOT NULL,
  "boundAt" DATETIME,
  "cancelledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "CustomerPass_controlHash_key" ON "CustomerPass"("controlHash");
CREATE INDEX "CustomerPass_status_expiresAt_idx" ON "CustomerPass"("status", "expiresAt");
CREATE INDEX "CustomerPass_walletAddress_createdAt_idx" ON "CustomerPass"("walletAddress", "createdAt");

ALTER TABLE "Session" ADD COLUMN "customerPassId" TEXT
REFERENCES "CustomerPass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Session_customerPassId_key" ON "Session"("customerPassId");
