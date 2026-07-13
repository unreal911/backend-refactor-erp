-- Facturacion SUNAT: persistir documento del adquirente en Order y afectacion IGV por Producto.
-- Migracion manual (el repo gestiona varios subsistemas via bootstrap; no usar `migrate dev` aqui,
-- diffea contra el schema y dropearia las tablas bootstrap). Aplicar con `prisma migrate deploy`.

ALTER TABLE "Product" ADD COLUMN "afectacionIgv" TEXT NOT NULL DEFAULT '10';

ALTER TABLE "Order" ADD COLUMN "clienteTipoDoc" TEXT;
ALTER TABLE "Order" ADD COLUMN "clienteNumDoc" TEXT;
