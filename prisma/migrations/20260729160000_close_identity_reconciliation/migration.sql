-- MIG-003: cerrar las últimas fronteras de identidad sin reescribir usuarios.
--
-- Role, Permission y RolePermission son el catálogo RBAC global heredado.
-- La asignación editable de cada empresa vive en TenantMembership.role.

ALTER TABLE "OrderItem"
    ADD CONSTRAINT "OrderItem_removed_by_tenant_fkey"
    FOREIGN KEY ("removedById", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION validate_audit_actor_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."dataScope" = 'TENANT'
       AND NEW."actorUserId" IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "TenantMembership" membership
           WHERE membership."userId" = NEW."actorUserId"
             AND membership."tenantId" = NEW."tenantId"
       ) THEN
        RAISE EXCEPTION 'El actor de auditoría no pertenece al tenant';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "AuditLog_actor_tenant_trigger"
BEFORE INSERT OR UPDATE OF "actorUserId", "tenantId", "dataScope"
ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION validate_audit_actor_tenant();

COMMENT ON TABLE "Role" IS
    'PLATFORM_GLOBAL RBAC: plantillas heredadas inmutables desde flujos tenant.';
COMMENT ON TABLE "Permission" IS
    'PLATFORM_GLOBAL RBAC: catálogo estable de códigos de permiso.';
COMMENT ON TABLE "RolePermission" IS
    'PLATFORM_GLOBAL RBAC: matriz heredada entre plantillas y permisos.';
COMMENT ON COLUMN "TenantMembership"."role" IS
    'Asignación RBAC editable y aislada para un usuario dentro de un tenant.';
