CREATE OR REPLACE FUNCTION protect_last_tenant_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    removes_active_owner boolean;
    tenant_requires_owner boolean;
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

    SELECT EXISTS (
        SELECT 1
        FROM "Tenant"
        WHERE "id" = OLD."tenantId"
          AND "status" <> 'PURGED'
    ) INTO tenant_requires_owner;

    IF removes_active_owner AND tenant_requires_owner AND NOT EXISTS (
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

COMMENT ON FUNCTION protect_last_tenant_owner() IS
    'Protege empresas operativas y permite desactivar/eliminar membresías solo después de marcar el tenant PURGED.';
