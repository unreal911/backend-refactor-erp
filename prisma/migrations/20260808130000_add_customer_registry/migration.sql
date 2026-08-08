CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "tenantId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "name" TEXT NOT NULL,
    "documentType" TEXT,
    "documentNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Customer_tenantId_documentNumber_key" ON "Customer"("tenantId", "documentNumber");
CREATE UNIQUE INDEX "Customer_id_tenantId_key" ON "Customer"("id", "tenantId");
CREATE INDEX "Customer_tenantId_name_idx" ON "Customer"("tenantId", "name");

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "customerId" INTEGER;
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_tenantId_fkey"
    FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Order_tenantId_customerId_idx" ON "Order"("tenantId", "customerId");

ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Customer_tenant_isolation" ON "Customer"
    FOR ALL TO "tienda_tenant_app"
    USING ("tenantId" = "current_tenant_id"())
    WITH CHECK ("tenantId" = "current_tenant_id"());
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Customer" TO "tienda_tenant_app";
GRANT USAGE, SELECT, UPDATE ON SEQUENCE "Customer_id_seq" TO "tienda_tenant_app";
