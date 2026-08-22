-- MIG-002: formaliza todo el DDL que antes se ejecutaba al arrancar la API.
-- La migración es aditiva e idempotente para poder aplicarse tanto sobre una
-- base vacía como sobre la instalación heredada que ya ejecutó los bootstraps.
-- Los datos por defecto permanecen en seeds separados del DDL.

-- Configuración de aplicación.
CREATE TABLE IF NOT EXISTS "SystemSetting" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SystemSetting_key_key"
    ON "SystemSetting"("key");

-- Identidad del marketplace.
CREATE TABLE IF NOT EXISTS "MarketplaceCustomer" (
    "id" SERIAL NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "password" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketplaceCustomer_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MarketplaceCustomer"
    ADD COLUMN IF NOT EXISTS "address" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceCustomer_email_key"
    ON "MarketplaceCustomer"(lower("email"));
CREATE INDEX IF NOT EXISTS "MarketplaceCustomer_phone_idx"
    ON "MarketplaceCustomer"("phone");

-- Auditoría y actividad.
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" SERIAL NOT NULL,
    "actorUserId" INTEGER,
    "actorEmail" TEXT,
    "actorRole" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestQuery" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "requestParams" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "requestBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx"
    ON "AuditLog"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AuditLog_actorUserId_idx"
    ON "AuditLog"("actorUserId");
CREATE INDEX IF NOT EXISTS "AuditLog_method_idx"
    ON "AuditLog"("method");
CREATE INDEX IF NOT EXISTS "AuditLog_statusCode_idx"
    ON "AuditLog"("statusCode");
CREATE INDEX IF NOT EXISTS "AuditLog_path_idx"
    ON "AuditLog"("path");

CREATE TABLE IF NOT EXISTS "UserActivityLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "userEmail" TEXT,
    "userRole" TEXT,
    "module" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionLabel" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER,
    "entityCode" TEXT,
    "description" TEXT,
    "products" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "context" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserActivityLog_createdAt_idx"
    ON "UserActivityLog"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "UserActivityLog_userId_idx"
    ON "UserActivityLog"("userId");
CREATE INDEX IF NOT EXISTS "UserActivityLog_module_idx"
    ON "UserActivityLog"("module");
CREATE INDEX IF NOT EXISTS "UserActivityLog_actionType_idx"
    ON "UserActivityLog"("actionType");
CREATE INDEX IF NOT EXISTS "UserActivityLog_entity_idx"
    ON "UserActivityLog"("entityType", "entityId");

-- Responsabilidad compartida de picking.
CREATE TABLE IF NOT EXISTS "PickingSharedResponsibility" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "assignedByUserId" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'DELEGATION',
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PickingSharedResponsibility_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PickingSharedResponsibility_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "Order"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingSharedResponsibility_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingSharedResponsibility_assignedByUserId_fkey"
        FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PickingResponsibilityRequest" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "requesterUserId" INTEGER NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'SHARED',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "resolvedByUserId" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PickingResponsibilityRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PickingResponsibilityRequest_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "Order"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingResponsibilityRequest_requesterUserId_fkey"
        FOREIGN KEY ("requesterUserId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingResponsibilityRequest_resolvedByUserId_fkey"
        FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PickingItemContribution" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "pickingItemId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PickingItemContribution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PickingItemContribution_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "Order"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingItemContribution_pickingItemId_fkey"
        FOREIGN KEY ("pickingItemId") REFERENCES "PickingItem"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingItemContribution_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingItemContribution_quantity_check"
        CHECK ("quantity" >= 0)
);

CREATE TABLE IF NOT EXISTS "PickingUnpickRequest" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "pickingItemId" INTEGER NOT NULL,
    "requesterUserId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "resolvedByUserId" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PickingUnpickRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PickingUnpickRequest_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "Order"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingUnpickRequest_pickingItemId_fkey"
        FOREIGN KEY ("pickingItemId") REFERENCES "PickingItem"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingUnpickRequest_requesterUserId_fkey"
        FOREIGN KEY ("requesterUserId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingUnpickRequest_resolvedByUserId_fkey"
        FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PickingUnpickRequest_quantity_check"
        CHECK ("quantity" > 0)
);

CREATE TABLE IF NOT EXISTS "PickingOrderItemDetail" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "pickingItemId" INTEGER,
    "variantId" INTEGER NOT NULL,
    "pickedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PickingOrderItemDetail_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PickingOrderItemDetail_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "Order"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingOrderItemDetail_orderItemId_fkey"
        FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingOrderItemDetail_pickingItemId_fkey"
        FOREIGN KEY ("pickingItemId") REFERENCES "PickingItem"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PickingOrderItemDetail_variantId_fkey"
        FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PickingOrderItemDetail_pickedQuantity_check"
        CHECK ("pickedQuantity" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "PickingSharedResponsibility_order_user_key"
    ON "PickingSharedResponsibility"("orderId", "userId");
CREATE INDEX IF NOT EXISTS "PickingSharedResponsibility_order_active_idx"
    ON "PickingSharedResponsibility"("orderId", "isActive");
CREATE INDEX IF NOT EXISTS "PickingSharedResponsibility_user_active_idx"
    ON "PickingSharedResponsibility"("userId", "isActive");
CREATE INDEX IF NOT EXISTS "PickingResponsibilityRequest_order_status_idx"
    ON "PickingResponsibilityRequest"("orderId", "status");
CREATE INDEX IF NOT EXISTS "PickingResponsibilityRequest_requester_status_idx"
    ON "PickingResponsibilityRequest"("requesterUserId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "PickingResponsibilityRequest_pending_unique_idx"
    ON "PickingResponsibilityRequest"("orderId", "requesterUserId", "mode", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "PickingItemContribution_item_user_key"
    ON "PickingItemContribution"("pickingItemId", "userId");
CREATE INDEX IF NOT EXISTS "PickingItemContribution_order_idx"
    ON "PickingItemContribution"("orderId");
CREATE INDEX IF NOT EXISTS "PickingItemContribution_user_idx"
    ON "PickingItemContribution"("userId");
CREATE INDEX IF NOT EXISTS "PickingUnpickRequest_order_status_idx"
    ON "PickingUnpickRequest"("orderId", "status");
CREATE INDEX IF NOT EXISTS "PickingUnpickRequest_item_status_idx"
    ON "PickingUnpickRequest"("pickingItemId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "PickingOrderItemDetail_orderItem_unique_idx"
    ON "PickingOrderItemDetail"("orderItemId");
CREATE INDEX IF NOT EXISTS "PickingOrderItemDetail_order_idx"
    ON "PickingOrderItemDetail"("orderId");
CREATE INDEX IF NOT EXISTS "PickingOrderItemDetail_picking_item_idx"
    ON "PickingOrderItemDetail"("pickingItemId");
DROP INDEX IF EXISTS "PickingUnpickRequest_pending_unique_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "PickingUnpickRequest_pending_unique_idx"
    ON "PickingUnpickRequest"("pickingItemId", "requesterUserId")
    WHERE "status" = 'PENDING';

-- Restricciones defensivas de inventario. NOT VALID conserva cualquier fila
-- heredada problemática, pero protege de inmediato todo INSERT/UPDATE nuevo.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'Inventory_stock_nonneg_check'
    ) THEN
        ALTER TABLE "Inventory"
            ADD CONSTRAINT "Inventory_stock_nonneg_check"
            CHECK ("stock" >= 0) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'Inventory_reserved_range_check'
    ) THEN
        ALTER TABLE "Inventory"
            ADD CONSTRAINT "Inventory_reserved_range_check"
            CHECK ("reservedStock" >= 0 AND "reservedStock" <= "stock") NOT VALID;
    END IF;
END $$;

-- SUNAT.
DO $$ BEGIN
    CREATE TYPE "ComprobanteTipo" AS ENUM (
        'FACTURA',
        'BOLETA',
        'NOTA_CREDITO',
        'NOTA_DEBITO'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "ComprobanteEstado" AS ENUM (
        'BORRADOR',
        'ENVIADO',
        'ACEPTADO',
        'ACEPTADO_CON_OBSERVACIONES',
        'RECHAZADO',
        'ANULADO',
        'ERROR'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SunatDispatchStatus" AS ENUM (
        'SIMULATED',
        'PENDING',
        'ACCEPTED',
        'ACCEPTED_WITH_OBSERVATIONS',
        'REJECTED',
        'ERROR'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ComprobanteSerie" (
    "id" SERIAL NOT NULL,
    "tipo" "ComprobanteTipo" NOT NULL,
    "serie" TEXT NOT NULL,
    "correlativo" INTEGER NOT NULL DEFAULT 0,
    "storeId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComprobanteSerie_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Comprobante" (
    "id" SERIAL NOT NULL,
    "tipo" "ComprobanteTipo" NOT NULL,
    "tipoCodigo" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "nombreArchivo" TEXT NOT NULL,
    "estado" "ComprobanteEstado" NOT NULL DEFAULT 'BORRADOR',
    "emisorRuc" TEXT NOT NULL,
    "emisorRazonSocial" TEXT NOT NULL,
    "clienteTipoDoc" TEXT NOT NULL,
    "clienteNumDoc" TEXT NOT NULL,
    "clienteNombre" TEXT NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'PEN',
    "fechaEmision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalGravado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalExonerado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalInafecto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalGratuito" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalIgv" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalIsc" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalOtrosTributos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDescuentos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalValorVenta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalPrecioVenta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "leyendaMontoLetras" TEXT NOT NULL,
    "motivoNota" TEXT,
    "motivoNotaCodigo" TEXT,
    "comprobanteAfectadoId" INTEGER,
    "orderId" INTEGER,
    "serieRefId" INTEGER,
    "resumenDiarioId" INTEGER,
    "comunicacionBajaId" INTEGER,
    "motivoBaja" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Comprobante_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ComprobanteItem" (
    "id" SERIAL NOT NULL,
    "linea" INTEGER NOT NULL,
    "codigoProducto" TEXT,
    "descripcion" TEXT NOT NULL,
    "unidadMedida" TEXT NOT NULL DEFAULT 'NIU',
    "cantidad" DECIMAL(12,3) NOT NULL,
    "valorUnitario" DECIMAL(12,6) NOT NULL,
    "precioUnitario" DECIMAL(12,6) NOT NULL,
    "valorVenta" DECIMAL(12,2) NOT NULL,
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "afectacionIgvCodigo" TEXT NOT NULL DEFAULT '10',
    "igv" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isc" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "comprobanteId" INTEGER NOT NULL,
    CONSTRAINT "ComprobanteItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SunatDispatch" (
    "id" SERIAL NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'BETA',
    "endpoint" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "metodo" TEXT NOT NULL DEFAULT 'sendBill',
    "documentTypeCode" TEXT NOT NULL,
    "status" "SunatDispatchStatus" NOT NULL,
    "ticket" TEXT,
    "cdrCode" TEXT,
    "cdrDescription" TEXT,
    "cdrNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "faultCode" TEXT,
    "faultString" TEXT,
    "xmlBase64" TEXT,
    "cdrZipBase64" TEXT,
    "rawResponseXml" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comprobanteId" INTEGER NOT NULL,
    CONSTRAINT "SunatDispatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ResumenDiario" (
    "id" SERIAL NOT NULL,
    "correlativo" INTEGER NOT NULL,
    "fechaReferencia" DATE NOT NULL,
    "fechaGeneracion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileName" TEXT NOT NULL,
    "esAnulacion" BOOLEAN NOT NULL DEFAULT false,
    "environment" TEXT NOT NULL DEFAULT 'BETA',
    "endpoint" TEXT NOT NULL,
    "status" "SunatDispatchStatus" NOT NULL DEFAULT 'PENDING',
    "ticket" TEXT,
    "cdrCode" TEXT,
    "cdrDescription" TEXT,
    "cdrNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "faultCode" TEXT,
    "faultString" TEXT,
    "xmlBase64" TEXT,
    "cdrZipBase64" TEXT,
    "rawResponseXml" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResumenDiario_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ResumenDiario"
    ADD COLUMN IF NOT EXISTS "esAnulacion" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "ComunicacionBaja" (
    "id" SERIAL NOT NULL,
    "correlativo" INTEGER NOT NULL,
    "fechaReferencia" DATE NOT NULL,
    "fechaGeneracion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileName" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'BETA',
    "endpoint" TEXT NOT NULL,
    "status" "SunatDispatchStatus" NOT NULL DEFAULT 'PENDING',
    "ticket" TEXT,
    "cdrCode" TEXT,
    "cdrDescription" TEXT,
    "cdrNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "faultCode" TEXT,
    "faultString" TEXT,
    "xmlBase64" TEXT,
    "cdrZipBase64" TEXT,
    "rawResponseXml" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComunicacionBaja_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SunatEmisorConfig" (
    "id" SERIAL NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'BETA',
    "ruc" TEXT NOT NULL DEFAULT '',
    "razonSocial" TEXT NOT NULL DEFAULT '',
    "nombreComercial" TEXT,
    "ubigeo" TEXT NOT NULL DEFAULT '',
    "direccion" TEXT,
    "tipoOperacion" TEXT,
    "regimen" TEXT,
    "solUser" TEXT NOT NULL DEFAULT '',
    "solPasswordEnc" TEXT,
    "certP12Enc" TEXT,
    "certPasswordEnc" TEXT,
    "certSubjectCN" TEXT,
    "certNotAfter" TIMESTAMP(3),
    "signatureId" TEXT NOT NULL DEFAULT 'SignSUNAT',
    "activo" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SunatEmisorConfig_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Comprobante"
    ADD COLUMN IF NOT EXISTS "resumenDiarioId" INTEGER;
ALTER TABLE "Comprobante"
    ADD COLUMN IF NOT EXISTS "comunicacionBajaId" INTEGER;
ALTER TABLE "Comprobante"
    ADD COLUMN IF NOT EXISTS "motivoBaja" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ComprobanteSerie_tipo_serie_key"
    ON "ComprobanteSerie"("tipo", "serie");
CREATE INDEX IF NOT EXISTS "ComprobanteSerie_storeId_idx"
    ON "ComprobanteSerie"("storeId");
CREATE UNIQUE INDEX IF NOT EXISTS "Comprobante_nombreArchivo_key"
    ON "Comprobante"("nombreArchivo");
CREATE INDEX IF NOT EXISTS "Comprobante_orderId_idx"
    ON "Comprobante"("orderId");
CREATE INDEX IF NOT EXISTS "Comprobante_estado_idx"
    ON "Comprobante"("estado");
CREATE INDEX IF NOT EXISTS "Comprobante_tipo_fechaEmision_idx"
    ON "Comprobante"("tipo", "fechaEmision");
CREATE INDEX IF NOT EXISTS "Comprobante_resumenDiarioId_idx"
    ON "Comprobante"("resumenDiarioId");
CREATE INDEX IF NOT EXISTS "Comprobante_comunicacionBajaId_idx"
    ON "Comprobante"("comunicacionBajaId");
CREATE INDEX IF NOT EXISTS "ComprobanteItem_comprobanteId_idx"
    ON "ComprobanteItem"("comprobanteId");
CREATE INDEX IF NOT EXISTS "SunatDispatch_comprobanteId_idx"
    ON "SunatDispatch"("comprobanteId");
CREATE INDEX IF NOT EXISTS "SunatDispatch_status_idx"
    ON "SunatDispatch"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "ResumenDiario_fileName_key"
    ON "ResumenDiario"("fileName");
CREATE INDEX IF NOT EXISTS "ResumenDiario_status_idx"
    ON "ResumenDiario"("status");
CREATE INDEX IF NOT EXISTS "ResumenDiario_fechaReferencia_idx"
    ON "ResumenDiario"("fechaReferencia");
CREATE UNIQUE INDEX IF NOT EXISTS "ComunicacionBaja_fileName_key"
    ON "ComunicacionBaja"("fileName");
CREATE INDEX IF NOT EXISTS "ComunicacionBaja_status_idx"
    ON "ComunicacionBaja"("status");
CREATE INDEX IF NOT EXISTS "ComunicacionBaja_fechaReferencia_idx"
    ON "ComunicacionBaja"("fechaReferencia");

DO $$ BEGIN
    ALTER TABLE "ComprobanteSerie"
        ADD CONSTRAINT "ComprobanteSerie_storeId_fkey"
        FOREIGN KEY ("storeId") REFERENCES "Store"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Comprobante"
        ADD CONSTRAINT "Comprobante_comprobanteAfectadoId_fkey"
        FOREIGN KEY ("comprobanteAfectadoId") REFERENCES "Comprobante"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Comprobante"
        ADD CONSTRAINT "Comprobante_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "Order"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Comprobante"
        ADD CONSTRAINT "Comprobante_serieRefId_fkey"
        FOREIGN KEY ("serieRefId") REFERENCES "ComprobanteSerie"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Comprobante"
        ADD CONSTRAINT "Comprobante_resumenDiarioId_fkey"
        FOREIGN KEY ("resumenDiarioId") REFERENCES "ResumenDiario"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Comprobante"
        ADD CONSTRAINT "Comprobante_comunicacionBajaId_fkey"
        FOREIGN KEY ("comunicacionBajaId") REFERENCES "ComunicacionBaja"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "ComprobanteItem"
        ADD CONSTRAINT "ComprobanteItem_comprobanteId_fkey"
        FOREIGN KEY ("comprobanteId") REFERENCES "Comprobante"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "SunatDispatch"
        ADD CONSTRAINT "SunatDispatch_comprobanteId_fkey"
        FOREIGN KEY ("comprobanteId") REFERENCES "Comprobante"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
