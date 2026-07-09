-- Ledger por tienda por item: vincula cada reserva con la linea de pedido que la
-- origino, para reconstruir el reparto por tienda desde el backend (multi-dispositivo)
-- sin depender de localStorage. Nullable por compatibilidad con reservas legacy.
ALTER TABLE "Reservation" ADD COLUMN "orderItemId" INTEGER;

ALTER TABLE "Reservation"
ADD CONSTRAINT "Reservation_orderItemId_fkey"
FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Reservation_orderItemId_idx" ON "Reservation"("orderItemId");
