CREATE TABLE "TenantFeatureOverride" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "featureCode" TEXT NOT NULL,
    "effect" VARCHAR(5) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "reason" VARCHAR(500) NOT NULL,
    "createdByPlatformAdminId" UUID,
    "revokedAt" TIMESTAMP(3),
    "revokedByPlatformAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantFeatureOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TenantFeatureOverride_effect_check" CHECK ("effect" IN ('ALLOW', 'DENY')),
    CONSTRAINT "TenantFeatureOverride_dates_check" CHECK ("expiresAt" IS NULL OR "expiresAt" > "startsAt")
);

CREATE TABLE "TenantLimitOverride" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "limitCode" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "reason" VARCHAR(500) NOT NULL,
    "createdByPlatformAdminId" UUID,
    "revokedAt" TIMESTAMP(3),
    "revokedByPlatformAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantLimitOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TenantLimitOverride_value_check" CHECK ("value" >= 0),
    CONSTRAINT "TenantLimitOverride_dates_check" CHECK ("expiresAt" IS NULL OR "expiresAt" > "startsAt")
);

CREATE TABLE "TenantMembershipPermissionOverride" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "effect" VARCHAR(5) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "reason" VARCHAR(500) NOT NULL,
    "createdByPlatformAdminId" UUID,
    "revokedAt" TIMESTAMP(3),
    "revokedByPlatformAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantMembershipPermissionOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TenantMembershipPermissionOverride_effect_check" CHECK ("effect" IN ('ALLOW', 'DENY')),
    CONSTRAINT "TenantMembershipPermissionOverride_dates_check" CHECK ("expiresAt" IS NULL OR "expiresAt" > "startsAt")
);

CREATE INDEX "TenantFeatureOverride_tenantId_featureCode_revokedAt_startsAt_expiresAt_idx" ON "TenantFeatureOverride"("tenantId", "featureCode", "revokedAt", "startsAt", "expiresAt");
CREATE INDEX "TenantFeatureOverride_expiresAt_revokedAt_idx" ON "TenantFeatureOverride"("expiresAt", "revokedAt");
CREATE INDEX "TenantLimitOverride_tenantId_limitCode_revokedAt_startsAt_expiresAt_idx" ON "TenantLimitOverride"("tenantId", "limitCode", "revokedAt", "startsAt", "expiresAt");
CREATE INDEX "TenantLimitOverride_expiresAt_revokedAt_idx" ON "TenantLimitOverride"("expiresAt", "revokedAt");
CREATE INDEX "TenantMembershipPermissionOverride_tenantId_membershipId_permissionCode_revokedAt_startsAt_expiresAt_idx" ON "TenantMembershipPermissionOverride"("tenantId", "membershipId", "permissionCode", "revokedAt", "startsAt", "expiresAt");
CREATE INDEX "TenantMembershipPermissionOverride_expiresAt_revokedAt_idx" ON "TenantMembershipPermissionOverride"("expiresAt", "revokedAt");

ALTER TABLE "TenantFeatureOverride" ADD CONSTRAINT "TenantFeatureOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TenantLimitOverride" ADD CONSTRAINT "TenantLimitOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TenantMembershipPermissionOverride" ADD CONSTRAINT "TenantMembershipPermissionOverride_membershipId_tenantId_fkey" FOREIGN KEY ("membershipId", "tenantId") REFERENCES "TenantMembership"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantFeatureOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantLimitOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantMembershipPermissionOverride" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "TenantFeatureOverride_tenant_isolation_policy" ON "TenantFeatureOverride" FOR ALL TO "tienda_tenant_app" USING ("tenantId" = "current_tenant_id"()) WITH CHECK ("tenantId" = "current_tenant_id"());
CREATE POLICY "TenantLimitOverride_tenant_isolation_policy" ON "TenantLimitOverride" FOR ALL TO "tienda_tenant_app" USING ("tenantId" = "current_tenant_id"()) WITH CHECK ("tenantId" = "current_tenant_id"());
CREATE POLICY "TenantMembershipPermissionOverride_tenant_isolation_policy" ON "TenantMembershipPermissionOverride" FOR ALL TO "tienda_tenant_app" USING ("tenantId" = "current_tenant_id"()) WITH CHECK ("tenantId" = "current_tenant_id"());
GRANT SELECT ON TABLE "TenantFeatureOverride", "TenantLimitOverride", "TenantMembershipPermissionOverride" TO "tienda_tenant_app";

INSERT INTO "PlatformPermission" ("code", "name", "module") VALUES
    ('platform.tenant_entitlements.manage', 'Administrar excepciones comerciales', 'tenants'),
    ('platform.tenant_permissions.manage', 'Administrar permisos de usuarios tenant', 'tenants')
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "module" = EXCLUDED."module";

INSERT INTO "PlatformRolePermission" ("roleId", "permissionCode")
SELECT role."id", permission."code"
FROM "PlatformRole" role
CROSS JOIN "PlatformPermission" permission
WHERE role."code" = 'SUPER_ADMIN'
  AND permission."code" IN ('platform.tenant_entitlements.manage', 'platform.tenant_permissions.manage')
ON CONFLICT DO NOTHING;
