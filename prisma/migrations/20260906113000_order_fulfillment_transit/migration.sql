-- Cadena logística por pedido: múltiples orígenes, tránsito explícito y recepción parcial.
ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_RECEIVED' AFTER 'IN_TRANSIT';

DROP INDEX IF EXISTS "StockTransfer_orderId_key";
DROP INDEX IF EXISTS "StockTransfer_orderId_tenantId_key";
CREATE INDEX IF NOT EXISTS "StockTransfer_tenantId_orderId_idx" ON "StockTransfer"("tenantId", "orderId");

ALTER TABLE "StockTransfer"
  ADD COLUMN IF NOT EXISTS "dispatchedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "dispatchedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3);

ALTER TABLE "StockTransferItem"
  ADD COLUMN IF NOT EXISTS "dispatchedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discrepancyQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "orderItemId" INTEGER,
  ADD COLUMN IF NOT EXISTS "reservationId" INTEGER;

ALTER TABLE "StockTransferItem"
  ADD CONSTRAINT "StockTransferItem_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockTransferItem"
  ADD CONSTRAINT "StockTransferItem_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS "StockTransferItem_reservationId_key" ON "StockTransferItem"("reservationId");

ALTER TABLE "StockTransferItem"
  ADD CONSTRAINT "StockTransferItem_quantities_check"
  CHECK (
    "quantity" > 0
    AND "dispatchedQuantity" >= 0
    AND "receivedQuantity" >= 0
    AND "discrepancyQuantity" >= 0
    AND "receivedQuantity" + "discrepancyQuantity" <= "dispatchedQuantity"
  );

CREATE INDEX IF NOT EXISTS "StockTransferItem_tenantId_orderItemId_idx"
  ON "StockTransferItem"("tenantId", "orderItemId");
