-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'RETURN_PENDING';

-- CreateEnum
CREATE TYPE "ReturnResponsibilityStatus" AS ENUM ('PENDING', 'ACCEPTED');

-- AlterTable
ALTER TABLE "Order"
ADD COLUMN "cancelledByUserId" INTEGER,
ADD COLUMN "returnResponsibilityAcceptedAt" TIMESTAMP(3),
ADD COLUMN "returnResponsibilityDelegatedById" INTEGER,
ADD COLUMN "returnResponsibilityStatus" "ReturnResponsibilityStatus",
ADD COLUMN "returnRequestedAt" TIMESTAMP(3),
ADD COLUMN "returnResponsibleUserId" INTEGER,
ADD COLUMN "returnedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_returnResponsibleUserId_fkey" FOREIGN KEY ("returnResponsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_returnResponsibilityDelegatedById_fkey" FOREIGN KEY ("returnResponsibilityDelegatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
