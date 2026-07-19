-- Add optional public seller identity without changing existing checkout or ownership data.
ALTER TABLE "Business" ADD COLUMN "description" TEXT;
ALTER TABLE "Business" ADD COLUMN "website" TEXT;
ALTER TABLE "Business" ADD COLUMN "categoriesJson" TEXT NOT NULL DEFAULT '[]';
