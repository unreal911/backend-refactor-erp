-- OPS-002: correlacion HTTP durable sin exponer datos del negocio.
ALTER TABLE "AuditLog"
    ADD COLUMN IF NOT EXISTS "correlationId" UUID;

UPDATE "AuditLog"
SET "correlationId" = gen_random_uuid()
WHERE "correlationId" IS NULL;

ALTER TABLE "AuditLog"
    ALTER COLUMN "correlationId" SET DEFAULT gen_random_uuid(),
    ALTER COLUMN "correlationId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "AuditLog_correlationId_idx"
    ON "AuditLog"("correlationId");
