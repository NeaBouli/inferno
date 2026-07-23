ALTER TABLE "Business"
ADD COLUMN "slug" TEXT;

CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");
