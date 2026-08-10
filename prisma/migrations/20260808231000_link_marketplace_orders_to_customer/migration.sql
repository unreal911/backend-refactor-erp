ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "marketplaceCustomerId" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceCustomer_id_tenantId_key"
    ON "MarketplaceCustomer"("id", "tenantId");

CREATE INDEX IF NOT EXISTS "Order_tenantId_marketplaceCustomerId_idx"
    ON "Order"("tenantId", "marketplaceCustomerId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'Order_marketplaceCustomerId_tenantId_fkey'
    ) THEN
        ALTER TABLE "Order"
            ADD CONSTRAINT "Order_marketplaceCustomerId_tenantId_fkey"
            FOREIGN KEY ("marketplaceCustomerId", "tenantId")
            REFERENCES "MarketplaceCustomer"("id", "tenantId")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
