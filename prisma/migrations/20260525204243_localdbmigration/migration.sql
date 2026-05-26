-- DropIndex
DROP INDEX "PaymentMethod_displayOrder_idx";

-- DropIndex
DROP INDEX "PaymentMethod_isActive_idx";

-- AlterTable
ALTER TABLE "PaymentMethod" ALTER COLUMN "updatedAt" DROP DEFAULT;
