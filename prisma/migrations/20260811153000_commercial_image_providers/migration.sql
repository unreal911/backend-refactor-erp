CREATE TYPE "ImageProviderType" AS ENUM ('CLOUDINARY', 'S3');
CREATE TYPE "ImageProviderEnvironment" AS ENUM ('ANY', 'DEVELOPMENT', 'STAGING', 'PRODUCTION');
CREATE TYPE "ImageProviderHealthStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNAVAILABLE');
CREATE TYPE "CommercialAssetPurpose" AS ENUM ('PRODUCT', 'VARIANT', 'COMPANY_LOGO', 'PLATFORM_QR', 'OTHER');
CREATE TYPE "CommercialAssetStatus" AS ENUM ('UPLOADING', 'ACTIVE', 'FAILED', 'DELETED');

CREATE TABLE "ImageProviderProfile" (
    "id" UUID NOT NULL,
    "type" "ImageProviderType" NOT NULL,
    "name" TEXT NOT NULL,
    "environment" "ImageProviderEnvironment" NOT NULL DEFAULT 'ANY',
    "secretRef" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "pauseNewUploads" BOOLEAN NOT NULL DEFAULT false,
    "maxUploadBytes" BIGINT NOT NULL DEFAULT 10485760,
    "warningPercent" INTEGER NOT NULL DEFAULT 80,
    "monthlyBudgetUsd" DECIMAL(10,2),
    "healthStatus" "ImageProviderHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastHealthMessage" TEXT,
    "lastHealthCheckedAt" TIMESTAMP(3),
    "createdByPlatformAdminId" UUID,
    "updatedByPlatformAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImageProviderProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImageProviderProfile_name_key" ON "ImageProviderProfile"("name");
CREATE UNIQUE INDEX "ImageProviderProfile_single_active_idx" ON "ImageProviderProfile"(("isActive")) WHERE "isActive" = true;
CREATE INDEX "ImageProviderProfile_isActive_isEnabled_idx" ON "ImageProviderProfile"("isActive", "isEnabled");
CREATE INDEX "ImageProviderProfile_type_environment_idx" ON "ImageProviderProfile"("type", "environment");

CREATE TABLE "CommercialAsset" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "providerProfileId" UUID NOT NULL,
    "purpose" "CommercialAssetPurpose" NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" CHAR(64) NOT NULL,
    "variants" JSONB,
    "status" "CommercialAssetStatus" NOT NULL DEFAULT 'UPLOADING',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "CommercialAsset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommercialAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommercialAsset_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ImageProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CommercialAsset_id_tenantId_key" ON "CommercialAsset"("id", "tenantId");
CREATE UNIQUE INDEX "CommercialAsset_providerProfileId_externalId_key" ON "CommercialAsset"("providerProfileId", "externalId");
CREATE INDEX "CommercialAsset_tenantId_status_createdAt_idx" ON "CommercialAsset"("tenantId", "status", "createdAt");
CREATE INDEX "CommercialAsset_tenantId_ownerType_ownerId_status_idx" ON "CommercialAsset"("tenantId", "ownerType", "ownerId", "status");
CREATE INDEX "CommercialAsset_url_idx" ON "CommercialAsset"("url");

INSERT INTO "ImageProviderProfile" (
    "id", "type", "name", "environment", "secretRef", "config", "isEnabled", "isActive"
) VALUES (
    '30000000-0000-4000-8000-000000000001', 'CLOUDINARY', 'Cloudinary principal', 'ANY',
    'env:CLOUDINARY_CLOUD_NAME,CLOUDINARY_API_KEY,CLOUDINARY_API_SECRET',
    '{"folder":"product_images","transformationProfile":"commercial-v1"}'::jsonb,
    true, true
);

ALTER TABLE "CommercialAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommercialAsset" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CommercialAsset_tenant_isolation_policy"
    ON "CommercialAsset" FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = "current_tenant_id"())
    WITH CHECK ("tenantId" = "current_tenant_id"());

GRANT SELECT, INSERT, UPDATE ON TABLE "CommercialAsset" TO "tienda_tenant_app";
REVOKE ALL ON TABLE "ImageProviderProfile" FROM "tienda_tenant_app";
