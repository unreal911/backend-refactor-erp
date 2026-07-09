-- AlterEnum
ALTER TYPE "OrderItemStatus" ADD VALUE 'MISSING';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "shortageQuantity" INTEGER NOT NULL DEFAULT 0;
