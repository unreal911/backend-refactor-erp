-- TEN-008: defensa en profundidad con RLS forzado.
-- Las migraciones conservan el rol propietario; la aplicacion opera como
-- tienda_tenant_app dentro de transacciones con app.tenant_id local.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = 'tienda_tenant_app'
    ) THEN
        CREATE ROLE "tienda_tenant_app"
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            NOBYPASSRLS;
    END IF;
END $$;

ALTER ROLE "tienda_tenant_app"
    NOLOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOBYPASSRLS;

-- El propietario de migraciones puede asumir el rol efectivo para ejecutar la
-- aplicacion local y las verificaciones. En produccion el login se provisiona
-- fuera de la migracion y solo recibe membresia/SET ROLE.
DO $$
BEGIN
    EXECUTE format(
        'GRANT "tienda_tenant_app" TO %I',
        current_user
    );
END $$;

CREATE OR REPLACE FUNCTION "current_tenant_id"()
RETURNS UUID
LANGUAGE SQL
STABLE
PARALLEL SAFE
AS $$
    SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

REVOKE ALL ON FUNCTION "current_tenant_id"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "current_tenant_id"() TO "tienda_tenant_app";

DO $$
DECLARE
    table_name TEXT;
    tenant_column_tables TEXT[] := ARRAY[
        'AuditLog',
        'Category',
        'Color',
        'Comprobante',
        'ComprobanteItem',
        'ComprobanteSerie',
        'ComunicacionBaja',
        'Inventory',
        'InventoryMovement',
        'MarketplaceCustomer',
        'Order',
        'OrderItem',
        'OrderReturn',
        'OrderReturnItem',
        'PaymentMethod',
        'PickingItem',
        'PickingItemContribution',
        'PickingOrderItemDetail',
        'PickingResponsibilityRequest',
        'PickingSession',
        'PickingSharedResponsibility',
        'PickingUnpickRequest',
        'Product',
        'ProductImage',
        'ProductVariant',
        'Reservation',
        'ResumenDiario',
        'Size',
        'StockTransfer',
        'StockTransferItem',
        'Store',
        'SunatDispatch',
        'SunatEmisorConfig',
        'SystemSetting',
        'TenantMembership',
        'TenantMigrationCheckpoint',
        'TenantMigrationQuarantine',
        'UserActivityLog'
    ];
BEGIN
    FOREACH table_name IN ARRAY tenant_column_tables LOOP
        EXECUTE format(
            'ALTER TABLE %I ENABLE ROW LEVEL SECURITY',
            table_name
        );
        EXECUTE format(
            'ALTER TABLE %I FORCE ROW LEVEL SECURITY',
            table_name
        );
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL TO "tienda_tenant_app" USING ("tenantId" = "current_tenant_id"()) WITH CHECK ("tenantId" = "current_tenant_id"())',
            table_name || '_tenant_isolation',
            table_name
        );
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO "tienda_tenant_app"',
            table_name
        );
    END LOOP;
END $$;

ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Tenant_tenant_isolation"
    ON "Tenant"
    FOR ALL
    TO "tienda_tenant_app"
    USING (id = "current_tenant_id"())
    WITH CHECK (id = "current_tenant_id"());
GRANT SELECT, UPDATE ON TABLE "Tenant" TO "tienda_tenant_app";

GRANT USAGE ON SCHEMA public TO "tienda_tenant_app";
GRANT USAGE, SELECT, UPDATE
    ON ALL SEQUENCES IN SCHEMA public
    TO "tienda_tenant_app";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "tienda_tenant_app";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "tienda_tenant_app";

COMMENT ON ROLE "tienda_tenant_app" IS
    'Rol efectivo de aplicacion: sin BYPASSRLS, usado solo con app.tenant_id transaccional.';
COMMENT ON FUNCTION "current_tenant_id"() IS
    'Tenant de la transaccion actual; NULL cuando no existe contexto.';
