-- AlterTable
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "croppedImagePath" TEXT,
ADD COLUMN IF NOT EXISTS "originalImagePath" TEXT,
ADD COLUMN IF NOT EXISTS "fields" TEXT;
