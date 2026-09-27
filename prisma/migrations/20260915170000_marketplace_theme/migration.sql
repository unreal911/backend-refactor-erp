CREATE TABLE "MarketplaceTheme" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "preset" TEXT NOT NULL DEFAULT 'catalogo_moderno',
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "draftConfig" JSONB NOT NULL,
    "publishedConfig" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketplaceTheme_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MarketplaceTheme_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED'))
);

CREATE UNIQUE INDEX "MarketplaceTheme_tenantId_key" ON "MarketplaceTheme"("tenantId");
CREATE INDEX "MarketplaceTheme_tenantId_status_idx" ON "MarketplaceTheme"("tenantId", "status");

ALTER TABLE "MarketplaceTheme"
  ADD CONSTRAINT "MarketplaceTheme_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketplaceTheme" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketplaceTheme" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MarketplaceTheme_tenant_isolation_policy"
  ON "MarketplaceTheme"
  FOR ALL TO "tienda_tenant_app"
  USING ("tenantId" = "current_tenant_id"())
  WITH CHECK ("tenantId" = "current_tenant_id"());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "MarketplaceTheme" TO "tienda_tenant_app";
