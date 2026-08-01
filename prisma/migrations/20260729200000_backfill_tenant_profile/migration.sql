-- MIG-009: el perfil empresarial deja de depender únicamente de claves
-- genéricas. Las filas de SystemSetting se conservan como espejo compatible.
ALTER TABLE "Tenant"
    ADD COLUMN "address" TEXT,
    ADD COLUMN "contactPhone" TEXT,
    ADD COLUMN "contactEmail" TEXT,
    ADD COLUMN "logoUrl" TEXT;

UPDATE "Tenant" tenant
SET
    "name" = COALESCE(
        NULLIF(BTRIM((
            SELECT setting."value"
            FROM "SystemSetting" setting
            WHERE setting."tenantId"=tenant.id
              AND setting."key"='company_name'
        )), ''),
        tenant."name"
    ),
    "legalName" = COALESCE(
        NULLIF(BTRIM((
            SELECT setting."value"
            FROM "SystemSetting" setting
            WHERE setting."tenantId"=tenant.id
              AND setting."key"='company_legal_name'
        )), ''),
        tenant."legalName"
    ),
    "ruc" = COALESCE(
        NULLIF(BTRIM((
            SELECT setting."value"
            FROM "SystemSetting" setting
            WHERE setting."tenantId"=tenant.id
              AND setting."key"='company_ruc'
        )), ''),
        tenant."ruc"
    ),
    "address" = COALESCE(
        NULLIF(BTRIM((
            SELECT setting."value"
            FROM "SystemSetting" setting
            WHERE setting."tenantId"=tenant.id
              AND setting."key"='company_address'
        )), ''),
        tenant."address"
    ),
    "contactPhone" = COALESCE(
        NULLIF(BTRIM((
            SELECT setting."value"
            FROM "SystemSetting" setting
            WHERE setting."tenantId"=tenant.id
              AND setting."key"='company_phone'
        )), ''),
        tenant."contactPhone"
    ),
    "contactEmail" = COALESCE(
        NULLIF(BTRIM((
            SELECT setting."value"
            FROM "SystemSetting" setting
            WHERE setting."tenantId"=tenant.id
              AND setting."key"='company_email'
        )), ''),
        tenant."contactEmail"
    ),
    "logoUrl" = COALESCE(
        NULLIF(BTRIM((
            SELECT setting."value"
            FROM "SystemSetting" setting
            WHERE setting."tenantId"=tenant.id
              AND setting."key"='company_logo_url'
        )), ''),
        tenant."logoUrl"
    );

COMMENT ON COLUMN "Tenant"."address" IS
    'MIG-009: dirección operativa migrada desde SystemSetting.';
COMMENT ON COLUMN "Tenant"."contactPhone" IS
    'MIG-009: teléfono empresarial migrado desde SystemSetting.';
COMMENT ON COLUMN "Tenant"."contactEmail" IS
    'MIG-009: correo empresarial migrado desde SystemSetting.';
COMMENT ON COLUMN "Tenant"."logoUrl" IS
    'MIG-009: logo empresarial migrado desde SystemSetting.';
