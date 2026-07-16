-- Idempotencia en creacion de ordenes: clave opcional enviada por el cliente
-- para deduplicar reintentos/doble-submit. Nullable + indice unico (Postgres
-- permite multiples NULL, asi que las ordenes sin clave conviven sin conflicto).
-- Migracion manual (el repo gestiona subsistemas via bootstrap; no usar
-- `migrate dev`). Aplicar con `prisma migrate deploy`.

ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
