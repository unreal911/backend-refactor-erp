-- TEN-007: aisla facturacion electronica y configuracion SUNAT por empresa.

DO $$
DECLARE
    table_name TEXT;
    tenant_tables TEXT[] := ARRAY[
        'ComprobanteSerie',
        'Comprobante',
        'ComprobanteItem',
        'SunatDispatch',
        'ResumenDiario',
        'ComunicacionBaja',
        'SunatEmisorConfig'
    ];
BEGIN
    FOREACH table_name IN ARRAY tenant_tables LOOP
        EXECUTE format(
            'ALTER TABLE %I ADD COLUMN "tenantId" UUID NOT NULL DEFAULT %L::uuid',
            table_name,
            '00000000-0000-4000-8000-000000000001'
        );
        EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
            table_name,
            table_name || '_tenantId_fkey'
        );
        EXECUTE format(
            'CREATE INDEX %I ON %I ("tenantId")',
            table_name || '_tenantId_idx',
            table_name
        );
    END LOOP;
END $$;

-- Cuando existe un padre empresarial, su tenant es la fuente autoritativa del
-- backfill. Las cabeceras historicas sin padre permanecen en la empresa legacy.
UPDATE "ComprobanteSerie" AS serie
SET "tenantId" = store."tenantId"
FROM "Store" AS store
WHERE serie."storeId" = store.id;

UPDATE "Comprobante" AS comprobante
SET "tenantId" = orden."tenantId"
FROM "Order" AS orden
WHERE comprobante."orderId" = orden.id;

UPDATE "Comprobante" AS comprobante
SET "tenantId" = serie."tenantId"
FROM "ComprobanteSerie" AS serie
WHERE comprobante."orderId" IS NULL
  AND comprobante."serieRefId" = serie.id;

UPDATE "ComprobanteItem" AS item
SET "tenantId" = comprobante."tenantId"
FROM "Comprobante" AS comprobante
WHERE item."comprobanteId" = comprobante.id;

UPDATE "SunatDispatch" AS dispatch
SET "tenantId" = comprobante."tenantId"
FROM "Comprobante" AS comprobante
WHERE dispatch."comprobanteId" = comprobante.id;

DO $$
DECLARE
    conflict_count INTEGER;
BEGIN
    SELECT COUNT(*)::int
    INTO conflict_count
    FROM (
        SELECT serie.id
        FROM "ComprobanteSerie" AS serie
        JOIN "Store" AS store ON store.id = serie."storeId"
        WHERE serie."tenantId" <> store."tenantId"

        UNION ALL

        SELECT comprobante.id
        FROM "Comprobante" AS comprobante
        JOIN "Order" AS orden ON orden.id = comprobante."orderId"
        WHERE comprobante."tenantId" <> orden."tenantId"

        UNION ALL

        SELECT comprobante.id
        FROM "Comprobante" AS comprobante
        JOIN "ComprobanteSerie" AS serie ON serie.id = comprobante."serieRefId"
        WHERE comprobante."tenantId" <> serie."tenantId"

        UNION ALL

        SELECT comprobante.id
        FROM "Comprobante" AS comprobante
        JOIN "Comprobante" AS afectado ON afectado.id = comprobante."comprobanteAfectadoId"
        WHERE comprobante."tenantId" <> afectado."tenantId"

        UNION ALL

        SELECT comprobante.id
        FROM "Comprobante" AS comprobante
        JOIN "ResumenDiario" AS resumen ON resumen.id = comprobante."resumenDiarioId"
        WHERE comprobante."tenantId" <> resumen."tenantId"

        UNION ALL

        SELECT comprobante.id
        FROM "Comprobante" AS comprobante
        JOIN "ComunicacionBaja" AS baja ON baja.id = comprobante."comunicacionBajaId"
        WHERE comprobante."tenantId" <> baja."tenantId"

        UNION ALL

        SELECT item.id
        FROM "ComprobanteItem" AS item
        JOIN "Comprobante" AS comprobante ON comprobante.id = item."comprobanteId"
        WHERE item."tenantId" <> comprobante."tenantId"

        UNION ALL

        SELECT dispatch.id
        FROM "SunatDispatch" AS dispatch
        JOIN "Comprobante" AS comprobante ON comprobante.id = dispatch."comprobanteId"
        WHERE dispatch."tenantId" <> comprobante."tenantId"

        UNION ALL

        SELECT config.id
        FROM "SunatEmisorConfig" AS config
        WHERE config."updatedById" IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM "TenantMembership" AS membership
              WHERE membership."userId" = config."updatedById"
                AND membership."tenantId" = config."tenantId"
          )
    ) AS conflicts;

    IF conflict_count > 0 THEN
        RAISE EXCEPTION
            'TEN-007: existen % relaciones SUNAT cruzadas entre empresas',
            conflict_count;
    END IF;
END $$;

-- Las unicidades fiscales dejan de ser globales. Un mismo codigo puede
-- existir en empresas diferentes, nunca repetirse dentro de una empresa.
DROP INDEX "ComprobanteSerie_tipo_serie_key";
DROP INDEX "Comprobante_nombreArchivo_key";
DROP INDEX "ResumenDiario_fileName_key";
DROP INDEX "ComunicacionBaja_fileName_key";

CREATE UNIQUE INDEX "ComprobanteSerie_tenantId_tipo_serie_key"
    ON "ComprobanteSerie"("tenantId", "tipo", "serie");
CREATE UNIQUE INDEX "Comprobante_tenantId_nombreArchivo_key"
    ON "Comprobante"("tenantId", "nombreArchivo");
CREATE UNIQUE INDEX "Comprobante_tenantId_tipo_serie_numero_key"
    ON "Comprobante"("tenantId", "tipo", "serie", "numero");
CREATE UNIQUE INDEX "ResumenDiario_tenantId_fileName_key"
    ON "ResumenDiario"("tenantId", "fileName");
CREATE UNIQUE INDEX "ComunicacionBaja_tenantId_fileName_key"
    ON "ComunicacionBaja"("tenantId", "fileName");
CREATE UNIQUE INDEX "SunatEmisorConfig_tenantId_key"
    ON "SunatEmisorConfig"("tenantId");

DO $$
DECLARE
    table_name TEXT;
    relation_tables TEXT[] := ARRAY[
        'ComprobanteSerie',
        'Comprobante',
        'ComprobanteItem',
        'SunatDispatch',
        'ResumenDiario',
        'ComunicacionBaja',
        'SunatEmisorConfig'
    ];
BEGIN
    FOREACH table_name IN ARRAY relation_tables LOOP
        EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I UNIQUE ("id", "tenantId")',
            table_name,
            table_name || '_id_tenantId_key'
        );
    END LOOP;
END $$;

-- El trigger compartido ya creado por TEN-005/TEN-006 deriva el tenant desde
-- todos los padres y rechaza combinaciones cruzadas antes de persistirlas.
CREATE TRIGGER "a_ComprobanteSerie_derive_tenant"
    BEFORE INSERT OR UPDATE ON "ComprobanteSerie"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"('Store:storeId');
CREATE TRIGGER "a_Comprobante_derive_tenant"
    BEFORE INSERT OR UPDATE ON "Comprobante"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"(
        'Comprobante:comprobanteAfectadoId',
        'Order:orderId',
        'ComprobanteSerie:serieRefId',
        'ResumenDiario:resumenDiarioId',
        'ComunicacionBaja:comunicacionBajaId'
    );
CREATE TRIGGER "a_ComprobanteItem_derive_tenant"
    BEFORE INSERT OR UPDATE ON "ComprobanteItem"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"('Comprobante:comprobanteId');
CREATE TRIGGER "a_SunatDispatch_derive_tenant"
    BEFORE INSERT OR UPDATE ON "SunatDispatch"
    FOR EACH ROW EXECUTE FUNCTION "derive_tenant_from_parents"('Comprobante:comprobanteId');

DO $$
DECLARE
    table_name TEXT;
    immutable_tables TEXT[] := ARRAY[
        'ComprobanteSerie',
        'Comprobante',
        'ComprobanteItem',
        'SunatDispatch',
        'ResumenDiario',
        'ComunicacionBaja',
        'SunatEmisorConfig'
    ];
BEGIN
    FOREACH table_name IN ARRAY immutable_tables LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION "prevent_tenant_change"()',
            'z_' || table_name || '_tenant_immutable',
            table_name
        );
    END LOOP;
END $$;

-- FKs compuestas: una orden, serie, nota, resumen o baja de otra empresa no
-- puede vincularse ni siquiera mediante SQL directo.
ALTER TABLE "ComprobanteSerie"
    ADD CONSTRAINT "ComprobanteSerie_store_tenant_fkey"
    FOREIGN KEY ("storeId", "tenantId")
    REFERENCES "Store"("id", "tenantId")
    ON DELETE SET NULL ("storeId") ON UPDATE CASCADE;

ALTER TABLE "Comprobante"
    ADD CONSTRAINT "Comprobante_afectado_tenant_fkey"
    FOREIGN KEY ("comprobanteAfectadoId", "tenantId")
    REFERENCES "Comprobante"("id", "tenantId")
    ON DELETE SET NULL ("comprobanteAfectadoId") ON UPDATE CASCADE,
    ADD CONSTRAINT "Comprobante_order_tenant_fkey"
    FOREIGN KEY ("orderId", "tenantId")
    REFERENCES "Order"("id", "tenantId")
    ON DELETE SET NULL ("orderId") ON UPDATE CASCADE,
    ADD CONSTRAINT "Comprobante_serie_tenant_fkey"
    FOREIGN KEY ("serieRefId", "tenantId")
    REFERENCES "ComprobanteSerie"("id", "tenantId")
    ON DELETE SET NULL ("serieRefId") ON UPDATE CASCADE,
    ADD CONSTRAINT "Comprobante_resumen_tenant_fkey"
    FOREIGN KEY ("resumenDiarioId", "tenantId")
    REFERENCES "ResumenDiario"("id", "tenantId")
    ON DELETE SET NULL ("resumenDiarioId") ON UPDATE CASCADE,
    ADD CONSTRAINT "Comprobante_baja_tenant_fkey"
    FOREIGN KEY ("comunicacionBajaId", "tenantId")
    REFERENCES "ComunicacionBaja"("id", "tenantId")
    ON DELETE SET NULL ("comunicacionBajaId") ON UPDATE CASCADE;

ALTER TABLE "ComprobanteItem"
    ADD CONSTRAINT "ComprobanteItem_comprobante_tenant_fkey"
    FOREIGN KEY ("comprobanteId", "tenantId")
    REFERENCES "Comprobante"("id", "tenantId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SunatDispatch"
    ADD CONSTRAINT "SunatDispatch_comprobante_tenant_fkey"
    FOREIGN KEY ("comprobanteId", "tenantId")
    REFERENCES "Comprobante"("id", "tenantId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SunatEmisorConfig"
    ADD CONSTRAINT "SunatEmisorConfig_updated_user_tenant_fkey"
    FOREIGN KEY ("updatedById", "tenantId")
    REFERENCES "TenantMembership"("userId", "tenantId")
    ON DELETE SET NULL ("updatedById") ON UPDATE CASCADE;

COMMENT ON TABLE "SunatEmisorConfig" IS
    'Configuracion fiscal y secretos SUNAT cifrados, una fila independiente por empresa.';
