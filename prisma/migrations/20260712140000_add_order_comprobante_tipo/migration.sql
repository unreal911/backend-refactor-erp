-- Facturacion SUNAT: la orden guarda el tipo de comprobante solicitado (BOLETA/FACTURA).
-- El backend crea el Comprobante en BORRADOR al registrar la venta (fuente de verdad).
-- Migracion manual (el repo gestiona subsistemas via bootstrap; no usar `migrate dev`,
-- diffea contra el schema y dropearia las tablas bootstrap). Aplicar con `prisma migrate deploy`.

ALTER TABLE "Order" ADD COLUMN "comprobanteTipo" TEXT;
