-- Add wallet ownership for seller-managed businesses.
ALTER TABLE "Business" ADD COLUMN "ownerAddress" TEXT;

CREATE INDEX "Business_ownerAddress_idx" ON "Business"("ownerAddress");
