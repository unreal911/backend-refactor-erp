-- CommercialAlert se creó consultando por error app.current_tenant_id.
-- El runtime establece app.tenant_id y el contrato RLS común lo expone
-- mediante current_tenant_id(). Reemplazamos la política sin tocar datos.
DROP POLICY IF EXISTS "CommercialAlert_tenant_isolation_policy" ON "CommercialAlert";

CREATE POLICY "CommercialAlert_tenant_isolation_policy"
    ON "CommercialAlert" FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = "current_tenant_id"())
    WITH CHECK ("tenantId" = "current_tenant_id"());
