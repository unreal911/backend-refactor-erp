-- Allow the runtime DB login to retain audit entries that have no tenant yet.
-- Tenant-owned rows remain governed by the existing tienda_tenant_app RLS policy.
CREATE POLICY "AuditLog_quarantine_insert_policy"
    ON "AuditLog"
    FOR INSERT
    TO "tienda_api"
    WITH CHECK (
        "tenantId" IS NULL
        AND "dataScope" = 'QUARANTINE'
    );
