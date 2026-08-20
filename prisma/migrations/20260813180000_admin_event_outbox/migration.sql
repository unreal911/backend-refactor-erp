CREATE TYPE "AdminEventOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED');
CREATE SEQUENCE "AdminEventOutbox_sequence_seq";

CREATE TABLE "AdminEventOutbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "sequence" BIGINT NOT NULL DEFAULT nextval('"AdminEventOutbox_sequence_seq"'),
    "eventType" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "AdminEventOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminEventOutbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdminEventOutbox_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER SEQUENCE "AdminEventOutbox_sequence_seq" OWNED BY "AdminEventOutbox"."sequence";
CREATE UNIQUE INDEX "AdminEventOutbox_sequence_key" ON "AdminEventOutbox"("sequence");
CREATE INDEX "AdminEventOutbox_status_availableAt_createdAt_idx" ON "AdminEventOutbox"("status", "availableAt", "createdAt");
CREATE INDEX "AdminEventOutbox_tenantId_sequence_idx" ON "AdminEventOutbox"("tenantId", "sequence");

ALTER TABLE "AdminEventOutbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminEventOutbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AdminEventOutbox_tenant_isolation_policy"
    ON "AdminEventOutbox" FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "AdminEventOutbox" TO "tienda_tenant_app";
GRANT USAGE, SELECT ON SEQUENCE "AdminEventOutbox_sequence_seq" TO "tienda_tenant_app";
