-- CreateEnum
CREATE TYPE "StoreType" AS ENUM ('STORE', 'WAREHOUSE');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "type" "StoreType" NOT NULL DEFAULT 'STORE';
