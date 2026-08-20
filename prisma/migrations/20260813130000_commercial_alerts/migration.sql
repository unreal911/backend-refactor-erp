CREATE TABLE "CommercialAlert" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "percent" INTEGER,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstTriggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastTriggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    CONSTRAINT "CommercialAlert_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommercialAlert_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CommercialAlert_tenantId_key_key" ON "CommercialAlert"("tenantId", "key");
CREATE UNIQUE INDEX "CommercialAlert_id_tenantId_key" ON "CommercialAlert"("id", "tenantId");
CREATE INDEX "CommercialAlert_tenantId_isActive_lastTriggeredAt_idx" ON "CommercialAlert"("tenantId", "isActive", "lastTriggeredAt");

ALTER TABLE "CommercialAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommercialAlert" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CommercialAlert_tenant_isolation_policy"
    ON "CommercialAlert" FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "CommercialAlert" TO "tienda_tenant_app";

ALTER TABLE "ImageProviderProfile" ADD COLUMN "capacityBytes" BIGINT;
