ALTER TABLE "OrderItem" ADD COLUMN "fulfillmentStoreId" INTEGER;

UPDATE "OrderItem"
SET "fulfillmentStoreId" = "Order"."fulfillmentStoreId"
FROM "Order"
WHERE "OrderItem"."orderId" = "Order"."id"
  AND "Order"."fulfillmentStoreId" IS NOT NULL;

ALTER TABLE "OrderItem"
ADD CONSTRAINT "OrderItem_fulfillmentStoreId_fkey"
FOREIGN KEY ("fulfillmentStoreId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
