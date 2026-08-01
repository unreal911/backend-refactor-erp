-- TEN-001..TEN-004: núcleo de identidad multiempresa.
-- Los datos operativos continúan monoempresa hasta MIG-003..MIG-010.

CREATE TYPE "TenantStatus" AS ENUM (
    'TRIAL',
    'ACTIVE',
    'SUSPENDED',
    'EXPIRED',
    'PURGED'
);

CREATE TYPE "TenantDatabaseMode" AS ENUM (
    'SHARED',
    'DEDICATED'
);

CREATE TYPE "TenantMembershipRole" AS ENUM (
    'OWNER',
    'ADMIN',
    'SELLER',
    'VIEWER'
);

CREATE TYPE "TenantMembershipStatus" AS ENUM (
    'INVITED',
    'ACTIVE',
    'INACTIVE'
);

CREATE TYPE "TenantMigrationStatus" AS ENUM (
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'QUARANTINED'
);

CREATE TABLE "Tenant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "ruc" VARCHAR(11),
    "rucConfirmedAt" TIMESTAMP(3),
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "databaseMode" "TenantDatabaseMode" NOT NULL DEFAULT 'SHARED',
    "trialStartedAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Tenant_slug_format_check"
        CHECK ("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    CONSTRAINT "Tenant_ruc_format_check"
        CHECK ("ruc" IS NULL OR "ruc" ~ '^[0-9]{11}$'),
    CONSTRAINT "Tenant_confirmed_ruc_check"
        CHECK ("rucConfirmedAt" IS NULL OR "ruc" IS NOT NULL),
    CONSTRAINT "Tenant_trial_dates_check"
        CHECK (
            "trialEndsAt" IS NULL
            OR "trialStartedAt" IS NULL
            OR "trialEndsAt" > "trialStartedAt"
        )
);

CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE UNIQUE INDEX "Tenant_active_confirmed_ruc_key"
    ON "Tenant"("ruc")
    WHERE "status" = 'ACTIVE'
      AND "rucConfirmedAt" IS NOT NULL
      AND "ruc" IS NOT NULL;
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

CREATE OR REPLACE FUNCTION prevent_tenant_id_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id" THEN
        RAISE EXCEPTION 'Tenant.id es inmutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "Tenant_id_immutable_trigger"
BEFORE UPDATE OF "id" ON "Tenant"
FOR EACH ROW
EXECUTE FUNCTION prevent_tenant_id_update();

CREATE TABLE "TenantMembership" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "TenantMembershipRole" NOT NULL,
    "status" "TenantMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TenantMembership_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TenantMembership_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TenantMembership_deactivation_check"
        CHECK (
            ("status" = 'INACTIVE' AND "deactivatedAt" IS NOT NULL)
            OR ("status" <> 'INACTIVE' AND "deactivatedAt" IS NULL)
        )
);

CREATE UNIQUE INDEX "TenantMembership_userId_tenantId_key"
    ON "TenantMembership"("userId", "tenantId");
CREATE INDEX "TenantMembership_tenantId_status_idx"
    ON "TenantMembership"("tenantId", "status");
CREATE INDEX "TenantMembership_userId_status_idx"
    ON "TenantMembership"("userId", "status");

CREATE TABLE "TenantMigrationCheckpoint" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "status" "TenantMigrationStatus" NOT NULL DEFAULT 'PENDING',
    "details" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenantMigrationCheckpoint_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TenantMigrationCheckpoint_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TenantMigrationCheckpoint_tenantId_storyId_key"
    ON "TenantMigrationCheckpoint"("tenantId", "storyId");
CREATE INDEX "TenantMigrationCheckpoint_tenantId_status_idx"
    ON "TenantMigrationCheckpoint"("tenantId", "status");

CREATE TABLE "PlatformAdmin" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlatformAdmin_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlatformAdmin_userId_key"
    ON "PlatformAdmin"("userId");

-- Tenant inicial estable e idempotente para la instalación heredada.
WITH legacy_settings AS (
    SELECT
        COALESCE(
            NULLIF(MAX("value") FILTER (WHERE "key" = 'company_name'), ''),
            'Empresa principal'
        ) AS display_name,
        NULLIF(MAX("value") FILTER (WHERE "key" = 'company_legal_name'), '') AS legal_name,
        NULLIF(
            regexp_replace(
                COALESCE(MAX("value") FILTER (WHERE "key" = 'company_ruc'), ''),
                '[^0-9]',
                '',
                'g'
            ),
            ''
        ) AS normalized_ruc
    FROM "SystemSetting"
)
INSERT INTO "Tenant" (
    "id",
    "slug",
    "name",
    "legalName",
    "ruc",
    "rucConfirmedAt",
    "status",
    "databaseMode",
    "updatedAt"
)
SELECT
    '00000000-0000-4000-8000-000000000001'::uuid,
    'legacy-main',
    display_name,
    legal_name,
    CASE WHEN normalized_ruc ~ '^[0-9]{11}$' THEN normalized_ruc ELSE NULL END,
    CASE
        WHEN normalized_ruc ~ '^[0-9]{11}$' THEN CURRENT_TIMESTAMP
        ELSE NULL
    END,
    'ACTIVE'::"TenantStatus",
    'SHARED'::"TenantDatabaseMode",
    CURRENT_TIMESTAMP
FROM legacy_settings
ON CONFLICT ("id") DO NOTHING;

-- Una membresía por usuario. El primer ADMIN activo es propietario; si no
-- existe, se usa el primer usuario activo y, como último recurso, el primero.
WITH ranked_users AS (
    SELECT
        u."id",
        u."isActive",
        r."name" AS role_name,
        COALESCE(
            MIN(u."id") FILTER (
                WHERE u."isActive" = true AND upper(r."name") = 'ADMIN'
            ) OVER (),
            MIN(u."id") FILTER (WHERE u."isActive" = true) OVER (),
            MIN(u."id") OVER ()
        ) AS owner_user_id
    FROM "User" u
    JOIN "Role" r ON r."id" = u."roleId"
)
INSERT INTO "TenantMembership" (
    "tenantId",
    "userId",
    "role",
    "status",
    "activatedAt",
    "deactivatedAt",
    "updatedAt"
)
SELECT
    '00000000-0000-4000-8000-000000000001'::uuid,
    "id",
    CASE
        WHEN "id" = owner_user_id THEN 'OWNER'::"TenantMembershipRole"
        WHEN upper(role_name) IN ('ADMIN', 'MANAGER') THEN 'ADMIN'::"TenantMembershipRole"
        WHEN upper(role_name) = 'SELLER' THEN 'SELLER'::"TenantMembershipRole"
        ELSE 'VIEWER'::"TenantMembershipRole"
    END,
    CASE
        WHEN "isActive" THEN 'ACTIVE'::"TenantMembershipStatus"
        ELSE 'INACTIVE'::"TenantMembershipStatus"
    END,
    CASE WHEN "isActive" THEN CURRENT_TIMESTAMP ELSE NULL END,
    CASE WHEN "isActive" THEN NULL ELSE CURRENT_TIMESTAMP END,
    CURRENT_TIMESTAMP
FROM ranked_users
ON CONFLICT ("userId", "tenantId") DO NOTHING;

CREATE OR REPLACE FUNCTION protect_last_tenant_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    removes_active_owner boolean;
BEGIN
    removes_active_owner :=
        OLD."role" = 'OWNER'
        AND OLD."status" = 'ACTIVE'
        AND (
            TG_OP = 'DELETE'
            OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
            OR NEW."role" IS DISTINCT FROM 'OWNER'::"TenantMembershipRole"
            OR NEW."status" IS DISTINCT FROM 'ACTIVE'::"TenantMembershipStatus"
        );

    IF removes_active_owner AND NOT EXISTS (
        SELECT 1
        FROM "TenantMembership" other
        WHERE other."tenantId" = OLD."tenantId"
          AND other."id" <> OLD."id"
          AND other."role" = 'OWNER'
          AND other."status" = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'No se puede retirar al último propietario activo del tenant';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "TenantMembership_last_owner_trigger"
BEFORE DELETE OR UPDATE OF "tenantId", "role", "status"
ON "TenantMembership"
FOR EACH ROW
EXECUTE FUNCTION protect_last_tenant_owner();

INSERT INTO "TenantMigrationCheckpoint" (
    "tenantId",
    "domain",
    "storyId",
    "status",
    "details",
    "updatedAt"
)
VALUES
    ('00000000-0000-4000-8000-000000000001', 'IDENTITY',      'MIG-003', 'PENDING', '{"delegated":true}'::jsonb, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000001', 'CATALOG',       'MIG-004', 'PENDING', '{"delegated":true}'::jsonb, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000001', 'INVENTORY',     'MIG-005', 'PENDING', '{"delegated":true}'::jsonb, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000001', 'MOVEMENTS',     'MIG-006', 'PENDING', '{"delegated":true}'::jsonb, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000001', 'ORDERS',        'MIG-007', 'PENDING', '{"delegated":true}'::jsonb, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000001', 'PAYMENTS',      'MIG-008', 'PENDING', '{"delegated":true}'::jsonb, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000001', 'CONFIGURATION', 'MIG-009', 'PENDING', '{"delegated":true}'::jsonb, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000001', 'AUDIT',         'MIG-010', 'PENDING', '{"delegated":true}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("tenantId", "storyId") DO NOTHING;

-- Contexto tenant sanitizado en auditoría. Los accesos públicos y de plataforma
-- conservan NULL; las rutas tenant-aware registran el UUID resuelto.
ALTER TABLE "AuditLog"
    ADD COLUMN "tenantId" UUID;

ALTER TABLE "AuditLog"
    ADD CONSTRAINT "AuditLog_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AuditLog_tenantId_createdAt_idx"
    ON "AuditLog"("tenantId", "createdAt" DESC);
