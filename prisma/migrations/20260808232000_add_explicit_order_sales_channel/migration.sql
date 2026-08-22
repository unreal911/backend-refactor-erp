ALTER TABLE "Order" ADD COLUMN "salesChannel" TEXT NOT NULL DEFAULT 'INTERNAL';

UPDATE "Order"
SET "salesChannel" = CASE
    WHEN upper("code") LIKE 'MK-%' OR upper(COALESCE("note", '')) LIKE '%ECOMMERCE%' THEN 'ECOMMERCE'
    WHEN upper(COALESCE("note", '')) LIKE '%POS-%'
      OR upper(COALESCE("note", '')) LIKE '%METODO DE PAGO%' THEN 'POS'
    ELSE 'INTERNAL'
END;

ALTER TABLE "Order" ADD CONSTRAINT "Order_salesChannel_check"
    CHECK ("salesChannel" IN ('POS', 'ECOMMERCE', 'INTERNAL'));

CREATE INDEX "Order_tenantId_salesChannel_createdAt_idx"
    ON "Order"("tenantId", "salesChannel", "createdAt" DESC);
