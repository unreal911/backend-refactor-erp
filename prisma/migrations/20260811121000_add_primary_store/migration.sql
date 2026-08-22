ALTER TABLE "Tenant" ADD COLUMN "primaryStoreId" INTEGER;

CREATE INDEX "Tenant_primaryStoreId_idx" ON "Tenant"("primaryStoreId");
