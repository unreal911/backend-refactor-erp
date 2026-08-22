ALTER TABLE "ComprobanteSerie"
    ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'GLOBAL';

ALTER TABLE "Comprobante"
    ADD COLUMN "numberingScope" TEXT NOT NULL DEFAULT 'GLOBAL',
    ADD COLUMN "idempotencyKey" TEXT,
    ADD COLUMN "payloadSha256" CHAR(64);

ALTER TABLE "SunatDispatch"
    ADD COLUMN "idempotencyKey" TEXT,
    ADD COLUMN "requestSha256" CHAR(64);

ALTER TABLE "ResumenDiario"
    ADD COLUMN "idempotencyKey" TEXT,
    ADD COLUMN "payloadSha256" CHAR(64);

ALTER TABLE "ComunicacionBaja"
    ADD COLUMN "idempotencyKey" TEXT,
    ADD COLUMN "payloadSha256" CHAR(64);

DROP INDEX "ComprobanteSerie_tenantId_tipo_serie_key";
DROP INDEX "Comprobante_tenantId_tipo_serie_numero_key";

CREATE UNIQUE INDEX "ComprobanteSerie_tenantId_tipo_serie_scopeKey_key"
ON "ComprobanteSerie"("tenantId", "tipo", "serie", "scopeKey");

CREATE UNIQUE INDEX "Comprobante_tenantId_tipo_serie_numberingScope_numero_key"
ON "Comprobante"("tenantId", "tipo", "serie", "numberingScope", "numero");

CREATE UNIQUE INDEX "Comprobante_tenantId_idempotencyKey_key"
ON "Comprobante"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "SunatDispatch_tenantId_idempotencyKey_key"
ON "SunatDispatch"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "ResumenDiario_tenantId_idempotencyKey_key"
ON "ResumenDiario"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "ComunicacionBaja_tenantId_idempotencyKey_key"
ON "ComunicacionBaja"("tenantId", "idempotencyKey");

ALTER TABLE "Comprobante"
    ADD CONSTRAINT "Comprobante_payload_hash_check"
        CHECK ("payloadSha256" IS NULL OR "payloadSha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "SunatDispatch"
    ADD CONSTRAINT "SunatDispatch_request_hash_check"
        CHECK ("requestSha256" IS NULL OR "requestSha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ResumenDiario"
    ADD CONSTRAINT "ResumenDiario_payload_hash_check"
        CHECK ("payloadSha256" IS NULL OR "payloadSha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ComunicacionBaja"
    ADD CONSTRAINT "ComunicacionBaja_payload_hash_check"
        CHECK ("payloadSha256" IS NULL OR "payloadSha256" ~ '^[0-9a-f]{64}$');

UPDATE "Tenant"
SET
    "maxUsers" = 5,
    "maxProducts" = 1000,
    "maxOrders" = 5000,
    "maxStorageBytes" = 5368709120
WHERE "planCode" = 'STARTER';
