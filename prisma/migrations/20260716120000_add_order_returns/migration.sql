-- G4: devolucion post-entrega (parcial por item, repone stock, NC SUNAT aparte).

-- Acumulado devuelto por linea (guarda contra devolver mas de lo entregado).
ALTER TABLE "OrderItem" ADD COLUMN "returnedQuantity" INTEGER NOT NULL DEFAULT 0;

-- Cabecera de devolucion.
CREATE TABLE "OrderReturn" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "responsibleUserId" INTEGER,
    "totalQuantity" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderReturn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderReturn_orderId_idx" ON "OrderReturn"("orderId");

-- Lineas devueltas.
CREATE TABLE "OrderReturnItem" (
    "id" SERIAL NOT NULL,
    "returnId" INTEGER NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "OrderReturnItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderReturnItem_returnId_idx" ON "OrderReturnItem"("returnId");

-- Foreign keys.
ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_responsibleUserId_fkey"
    FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderReturnItem" ADD CONSTRAINT "OrderReturnItem_returnId_fkey"
    FOREIGN KEY ("returnId") REFERENCES "OrderReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderReturnItem" ADD CONSTRAINT "OrderReturnItem_orderItemId_fkey"
    FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderReturnItem" ADD CONSTRAINT "OrderReturnItem_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
