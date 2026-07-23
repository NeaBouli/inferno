ALTER TABLE "BenefitRule"
ADD COLUMN "lockSource" TEXT NOT NULL DEFAULT 'ifrlock'
CHECK ("lockSource" IN ('ifrlock', 'commitment_time_only', 'either'));

ALTER TABLE "Session"
ADD COLUMN "benefitLockSource" TEXT
CHECK ("benefitLockSource" IS NULL OR "benefitLockSource" IN ('ifrlock', 'commitment_time_only', 'either'));

ALTER TABLE "Session"
ADD COLUMN "verifiedLockSource" TEXT
CHECK ("verifiedLockSource" IS NULL OR "verifiedLockSource" IN ('ifrlock', 'commitment_time_only'));

ALTER TABLE "Session"
ADD COLUMN "verificationBlock" INTEGER;
