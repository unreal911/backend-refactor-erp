ALTER TABLE "ImageProviderProfile"
    ADD COLUMN "providerUsage" JSONB,
    ADD COLUMN "providerUsageCheckedAt" TIMESTAMP(3),
    ADD COLUMN "providerUsageError" TEXT;
