ALTER TABLE "Tenant" ADD COLUMN "marketplaceSlug" TEXT;

UPDATE "Tenant"
SET "marketplaceSlug" = "slug"
WHERE "marketplaceSlug" IS NULL;

CREATE UNIQUE INDEX "Tenant_marketplaceSlug_key"
    ON "Tenant"("marketplaceSlug");
