CREATE TYPE "TenantPlanCode" AS ENUM ('TRIAL', 'STARTER', 'GROWTH', 'PREMIUM');
CREATE TYPE "TenantSubscriptionStatus" AS ENUM (
    'INACTIVE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'
);
CREATE TYPE "BillingWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'REJECTED');
CREATE TYPE "SunatArtifactType" AS ENUM (
    'SIGNED_XML', 'SUBMISSION_ZIP', 'CDR_ZIP', 'CDR_XML',
    'SOAP_RESPONSE', 'PDF_A4', 'PDF_THERMAL'
);
CREATE TYPE "SunatArtifactOwnerType" AS ENUM (
    'COMPROBANTE', 'DISPATCH', 'RESUMEN', 'BAJA'
);
CREATE TYPE "SunatArtifactStorageStatus" AS ENUM (
    'PENDING', 'STORED', 'VERIFIED', 'QUARANTINED', 'DELETED'
);
CREATE TYPE "SunatJobType" AS ENUM (
    'SEND_SUMMARY', 'POLL_TICKET', 'GENERATE_PDF',
    'CHECK_CERTIFICATE_EXPIRY', 'PURGE_TRIAL',
    'MIGRATE_ARTIFACTS', 'REENCRYPT_SECRETS'
);
CREATE TYPE "SunatJobStatus" AS ENUM (
    'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD'
);

ALTER TABLE "Tenant"
    ADD COLUMN "planCode" "TenantPlanCode" NOT NULL DEFAULT 'TRIAL',
    ADD COLUMN "maxUsers" INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN "maxProducts" INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN "maxOrders" INTEGER NOT NULL DEFAULT 250,
    ADD COLUMN "maxStorageBytes" BIGINT NOT NULL DEFAULT 524288000,
    ADD COLUMN "readOnlyAt" TIMESTAMP(3),
    ADD COLUMN "graceEndsAt" TIMESTAMP(3),
    ADD COLUMN "purgeScheduledAt" TIMESTAMP(3),
    ADD COLUMN "purgedAt" TIMESTAMP(3),
    ADD COLUMN "productionApprovedAt" TIMESTAMP(3),
    ADD COLUMN "productionApprovedById" INTEGER,
    ADD COLUMN "sunatProductionEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT "Tenant_quota_positive_check" CHECK (
        "maxUsers" > 0 AND "maxProducts" > 0 AND "maxOrders" > 0
        AND "maxStorageBytes" > 0
    ),
    ADD CONSTRAINT "Tenant_trial_lifecycle_check" CHECK (
        ("status" <> 'EXPIRED' OR "readOnlyAt" IS NOT NULL)
        AND ("status" <> 'PURGED' OR "purgedAt" IS NOT NULL)
        AND (NOT "sunatProductionEnabled" OR "productionApprovedAt" IS NOT NULL)
    );

ALTER TABLE "SunatEmisorConfig"
    ADD COLUMN "certificateValidatedAt" TIMESTAMP(3),
    ADD COLUMN "credentialsVerifiedAt" TIMESTAMP(3);

UPDATE "Tenant"
SET "planCode" = CASE WHEN "status" = 'TRIAL' THEN 'TRIAL'::"TenantPlanCode"
                      ELSE 'STARTER'::"TenantPlanCode" END;

CREATE UNIQUE INDEX "Tenant_confirmed_ruc_key"
ON "Tenant"("ruc")
WHERE "ruc" IS NOT NULL AND "rucConfirmedAt" IS NOT NULL;

CREATE TABLE "TenantLifecycleEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actorUserId" INTEGER,
    "source" TEXT NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenantLifecycleEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TenantLifecycleEvent_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TenantLifecycleEvent_id_tenantId_key"
ON "TenantLifecycleEvent"("id", "tenantId");
CREATE INDEX "TenantLifecycleEvent_tenantId_occurredAt_idx"
ON "TenantLifecycleEvent"("tenantId", "occurredAt");
CREATE INDEX "TenantLifecycleEvent_type_occurredAt_idx"
ON "TenantLifecycleEvent"("type", "occurredAt");

CREATE TABLE "TenantSubscription" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalCustomerId" TEXT,
    "externalSubscriptionId" TEXT,
    "planCode" "TenantPlanCode" NOT NULL,
    "status" "TenantSubscriptionStatus" NOT NULL DEFAULT 'INACTIVE',
    "currentPeriodEndsAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TenantSubscription_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TenantSubscription_tenantId_key"
ON "TenantSubscription"("tenantId");
CREATE UNIQUE INDEX "TenantSubscription_provider_externalSubscriptionId_key"
ON "TenantSubscription"("provider", "externalSubscriptionId");
CREATE UNIQUE INDEX "TenantSubscription_id_tenantId_key"
ON "TenantSubscription"("id", "tenantId");
CREATE INDEX "TenantSubscription_tenantId_status_idx"
ON "TenantSubscription"("tenantId", "status");

INSERT INTO "TenantSubscription" (
    "tenantId", "provider", "planCode", "status", "currentPeriodEndsAt"
)
SELECT
    "id",
    'internal',
    "planCode",
    CASE WHEN "status" = 'TRIAL'
        THEN 'TRIALING'::"TenantSubscriptionStatus"
        ELSE 'ACTIVE'::"TenantSubscriptionStatus"
    END,
    CASE WHEN "status" = 'TRIAL' THEN "trialEndsAt" ELSE NULL END
FROM "Tenant"
ON CONFLICT ("tenantId") DO NOTHING;

CREATE TABLE "BillingWebhookEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadSha256" CHAR(64) NOT NULL,
    "signatureSha256" CHAR(64) NOT NULL,
    "status" "BillingWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "rejectionReason" TEXT,
    "tenantId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BillingWebhookEvent_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BillingWebhookEvent_provider_externalEventId_key"
ON "BillingWebhookEvent"("provider", "externalEventId");
CREATE INDEX "BillingWebhookEvent_tenantId_receivedAt_idx"
ON "BillingWebhookEvent"("tenantId", "receivedAt");
CREATE INDEX "BillingWebhookEvent_status_receivedAt_idx"
ON "BillingWebhookEvent"("status", "receivedAt");

CREATE TABLE "SunatArtifact" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "ownerType" "SunatArtifactOwnerType" NOT NULL,
    "logicalKey" TEXT NOT NULL,
    "type" "SunatArtifactType" NOT NULL,
    "logicalVersion" INTEGER NOT NULL DEFAULT 1,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "objectVersion" TEXT,
    "sha256" CHAR(64) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storageStatus" "SunatArtifactStorageStatus" NOT NULL DEFAULT 'PENDING',
    "comprobanteId" INTEGER,
    "dispatchId" INTEGER,
    "resumenDiarioId" INTEGER,
    "comunicacionBajaId" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "retentionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SunatArtifact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SunatArtifact_metadata_check" CHECK (
        "logicalVersion" > 0 AND "sizeBytes" >= 0
        AND "sha256" ~ '^[0-9a-f]{64}$'
        AND length("bucket") > 0 AND length("objectKey") > 0
    ),
    CONSTRAINT "SunatArtifact_owner_check" CHECK (
        ("ownerType" = 'COMPROBANTE' AND "comprobanteId" IS NOT NULL AND "dispatchId" IS NULL AND "resumenDiarioId" IS NULL AND "comunicacionBajaId" IS NULL)
        OR ("ownerType" = 'DISPATCH' AND "comprobanteId" IS NULL AND "dispatchId" IS NOT NULL AND "resumenDiarioId" IS NULL AND "comunicacionBajaId" IS NULL)
        OR ("ownerType" = 'RESUMEN' AND "comprobanteId" IS NULL AND "dispatchId" IS NULL AND "resumenDiarioId" IS NOT NULL AND "comunicacionBajaId" IS NULL)
        OR ("ownerType" = 'BAJA' AND "comprobanteId" IS NULL AND "dispatchId" IS NULL AND "resumenDiarioId" IS NULL AND "comunicacionBajaId" IS NOT NULL)
    ),
    CONSTRAINT "SunatArtifact_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SunatArtifact_comprobanteId_tenantId_fkey"
        FOREIGN KEY ("comprobanteId", "tenantId") REFERENCES "Comprobante"("id", "tenantId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SunatArtifact_dispatchId_tenantId_fkey"
        FOREIGN KEY ("dispatchId", "tenantId") REFERENCES "SunatDispatch"("id", "tenantId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SunatArtifact_resumenDiarioId_tenantId_fkey"
        FOREIGN KEY ("resumenDiarioId", "tenantId") REFERENCES "ResumenDiario"("id", "tenantId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SunatArtifact_comunicacionBajaId_tenantId_fkey"
        FOREIGN KEY ("comunicacionBajaId", "tenantId") REFERENCES "ComunicacionBaja"("id", "tenantId")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SunatArtifact_tenantId_logicalKey_type_logicalVersion_key"
ON "SunatArtifact"("tenantId", "logicalKey", "type", "logicalVersion");
CREATE UNIQUE INDEX "SunatArtifact_tenantId_objectKey_objectVersion_key"
ON "SunatArtifact"("tenantId", "objectKey", "objectVersion");
CREATE UNIQUE INDEX "SunatArtifact_id_tenantId_key"
ON "SunatArtifact"("id", "tenantId");
CREATE INDEX "SunatArtifact_tenantId_ownerType_logicalKey_idx"
ON "SunatArtifact"("tenantId", "ownerType", "logicalKey");
CREATE INDEX "SunatArtifact_tenantId_storageStatus_createdAt_idx"
ON "SunatArtifact"("tenantId", "storageStatus", "createdAt");

CREATE TABLE "SunatJob" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "type" "SunatJobType" NOT NULL,
    "status" "SunatJobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorSafe" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SunatJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SunatJob_attempts_check" CHECK (
        "attempts" >= 0 AND "maxAttempts" > 0 AND "attempts" <= "maxAttempts"
    ),
    CONSTRAINT "SunatJob_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SunatJob_tenantId_type_idempotencyKey_key"
ON "SunatJob"("tenantId", "type", "idempotencyKey");
CREATE UNIQUE INDEX "SunatJob_id_tenantId_key"
ON "SunatJob"("id", "tenantId");
CREATE INDEX "SunatJob_status_nextRunAt_idx"
ON "SunatJob"("status", "nextRunAt");
CREATE INDEX "SunatJob_tenantId_status_nextRunAt_idx"
ON "SunatJob"("tenantId", "status", "nextRunAt");

DO $$
DECLARE
    table_name TEXT;
    tenant_tables TEXT[] := ARRAY[
        'TenantLifecycleEvent', 'TenantSubscription', 'SunatArtifact', 'SunatJob'
    ];
BEGIN
    FOREACH table_name IN ARRAY tenant_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL TO "tienda_tenant_app" USING ("tenantId" = "current_tenant_id"()) WITH CHECK ("tenantId" = "current_tenant_id"())',
            table_name || '_tenant_isolation', table_name
        );
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO "tienda_tenant_app"',
            table_name
        );
    END LOOP;
END $$;

REVOKE ALL ON TABLE "BillingWebhookEvent" FROM "tienda_tenant_app";

GRANT USAGE, SELECT, UPDATE
ON ALL SEQUENCES IN SCHEMA public
TO "tienda_tenant_app";

COMMENT ON TABLE "SunatArtifact" IS
    'Metadatos inmutables de evidencia SUNAT; el contenido binario permanece en S3 privado.';
COMMENT ON TABLE "BillingWebhookEvent" IS
    'Registro global idempotente de webhooks; conserva solo huellas, nunca el payload ni la firma originales.';
