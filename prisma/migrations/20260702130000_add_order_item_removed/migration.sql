-- Soft-delete de items en proformas ecommerce (eliminar/restaurar con estado real)
ALTER TABLE "OrderItem"
  ADD COLUMN "removedAt" TIMESTAMP(3),
  ADD COLUMN "removedReason" TEXT,
  ADD COLUMN "removedNote" TEXT,
  ADD COLUMN "removedById" INTEGER,
  ADD COLUMN "removedByName" TEXT;
