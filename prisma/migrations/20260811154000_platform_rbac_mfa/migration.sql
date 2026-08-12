CREATE TYPE "PlatformMfaStatus" AS ENUM ('DISABLED', 'PENDING', 'ENABLED', 'LOCKED');

CREATE TABLE "PlatformRole" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformRole_code_key" ON "PlatformRole"("code");

CREATE TABLE "PlatformPermission" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformPermission_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "PlatformRolePermission" (
    "roleId" UUID NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformRolePermission_pkey" PRIMARY KEY ("roleId", "permissionCode"),
    CONSTRAINT "PlatformRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "PlatformRole"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlatformRolePermission_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "PlatformPermission"("code") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PlatformRolePermission_permissionCode_idx" ON "PlatformRolePermission"("permissionCode");

INSERT INTO "PlatformRole" ("id", "code", "name", "description") VALUES
('40000000-0000-4000-8000-000000000001', 'SUPER_ADMIN', 'Superadministrador', 'Control completo de la plataforma'),
('40000000-0000-4000-8000-000000000002', 'PRODUCT', 'Producto', 'Planes y publicación comercial'),
('40000000-0000-4000-8000-000000000003', 'BILLING', 'Cobros', 'Medios y validación de pagos'),
('40000000-0000-4000-8000-000000000004', 'OPERATIONS', 'Operaciones', 'Empresas, infraestructura y proveedores'),
('40000000-0000-4000-8000-000000000005', 'SUPPORT', 'Soporte', 'Consulta limitada de empresas'),
('40000000-0000-4000-8000-000000000006', 'AUDITOR', 'Auditoría', 'Consulta de eventos y configuración');

INSERT INTO "PlatformPermission" ("code", "name", "module") VALUES
('platform.dashboard.view','Ver resumen','dashboard'),
('platform.plans.view','Ver planes','plans'),
('platform.plans.manage','Editar borradores','plans'),
('platform.plans.publish','Publicar planes','plans'),
('platform.payments.view','Ver cobros','payments'),
('platform.payments.manage','Configurar medios de cobro','payments'),
('platform.payments.approve','Aprobar o rechazar pagos','payments'),
('platform.tenants.view','Ver empresas','tenants'),
('platform.tenants.manage','Administrar empresas','tenants'),
('platform.providers.view','Ver proveedores','providers'),
('platform.providers.manage','Configurar proveedores','providers'),
('platform.providers.switch','Cambiar proveedor activo','providers'),
('platform.audit.view','Ver auditoría','audit'),
('platform.audit.export','Exportar auditoría','audit'),
('platform.admins.manage','Administrar accesos','iam');

INSERT INTO "PlatformRolePermission" ("roleId", "permissionCode")
SELECT '40000000-0000-4000-8000-000000000001'::uuid, "code" FROM "PlatformPermission";
INSERT INTO "PlatformRolePermission" ("roleId", "permissionCode") VALUES
('40000000-0000-4000-8000-000000000002','platform.dashboard.view'),('40000000-0000-4000-8000-000000000002','platform.plans.view'),('40000000-0000-4000-8000-000000000002','platform.plans.manage'),('40000000-0000-4000-8000-000000000002','platform.plans.publish'),('40000000-0000-4000-8000-000000000002','platform.audit.view'),
('40000000-0000-4000-8000-000000000003','platform.dashboard.view'),('40000000-0000-4000-8000-000000000003','platform.payments.view'),('40000000-0000-4000-8000-000000000003','platform.payments.manage'),('40000000-0000-4000-8000-000000000003','platform.payments.approve'),('40000000-0000-4000-8000-000000000003','platform.tenants.view'),('40000000-0000-4000-8000-000000000003','platform.audit.view'),
('40000000-0000-4000-8000-000000000004','platform.dashboard.view'),('40000000-0000-4000-8000-000000000004','platform.tenants.view'),('40000000-0000-4000-8000-000000000004','platform.tenants.manage'),('40000000-0000-4000-8000-000000000004','platform.providers.view'),('40000000-0000-4000-8000-000000000004','platform.providers.manage'),('40000000-0000-4000-8000-000000000004','platform.providers.switch'),('40000000-0000-4000-8000-000000000004','platform.audit.view'),
('40000000-0000-4000-8000-000000000005','platform.dashboard.view'),('40000000-0000-4000-8000-000000000005','platform.tenants.view'),
('40000000-0000-4000-8000-000000000006','platform.dashboard.view'),('40000000-0000-4000-8000-000000000006','platform.plans.view'),('40000000-0000-4000-8000-000000000006','platform.payments.view'),('40000000-0000-4000-8000-000000000006','platform.tenants.view'),('40000000-0000-4000-8000-000000000006','platform.providers.view'),('40000000-0000-4000-8000-000000000006','platform.audit.view'),('40000000-0000-4000-8000-000000000006','platform.audit.export');

ALTER TABLE "PlatformAdmin"
    ADD COLUMN "roleId" UUID,
    ADD COLUMN "mfaStatus" "PlatformMfaStatus" NOT NULL DEFAULT 'DISABLED',
    ADD COLUMN "totpSecretEncrypted" TEXT,
    ADD COLUMN "recoveryCodeHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "mfaFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "mfaLockedUntil" TIMESTAMP(3),
    ADD COLUMN "mfaEnrolledAt" TIMESTAMP(3);

UPDATE "PlatformAdmin" SET "roleId" = '40000000-0000-4000-8000-000000000001'::uuid WHERE "roleId" IS NULL;
ALTER TABLE "PlatformAdmin" ALTER COLUMN "roleId" SET NOT NULL;
ALTER TABLE "PlatformAdmin" ADD CONSTRAINT "PlatformAdmin_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "PlatformRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PlatformAdmin_roleId_isActive_idx" ON "PlatformAdmin"("roleId", "isActive");

REVOKE ALL ON TABLE "PlatformRole", "PlatformPermission", "PlatformRolePermission" FROM "tienda_tenant_app";
