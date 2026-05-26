import { prisma } from './prisma';

const PICKING_RESPONSIBILITY_SCHEMA_STATEMENTS: string[] = [
    `CREATE TABLE IF NOT EXISTS "PickingSharedResponsibility" (
        "id" SERIAL NOT NULL,
        "orderId" INTEGER NOT NULL,
        "userId" INTEGER NOT NULL,
        "assignedByUserId" INTEGER,
        "source" TEXT NOT NULL DEFAULT 'DELEGATION',
        "note" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PickingSharedResponsibility_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "PickingSharedResponsibility_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PickingSharedResponsibility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PickingSharedResponsibility_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS "PickingResponsibilityRequest" (
        "id" SERIAL NOT NULL,
        "orderId" INTEGER NOT NULL,
        "requesterUserId" INTEGER NOT NULL,
        "mode" TEXT NOT NULL DEFAULT 'SHARED',
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "note" TEXT,
        "resolvedByUserId" INTEGER,
        "resolvedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PickingResponsibilityRequest_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "PickingResponsibilityRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PickingResponsibilityRequest_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PickingResponsibilityRequest_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS "PickingItemContribution" (
        "id" SERIAL NOT NULL,
        "orderId" INTEGER NOT NULL,
        "pickingItemId" INTEGER NOT NULL,
        "userId" INTEGER NOT NULL,
        "quantity" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PickingItemContribution_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "PickingItemContribution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PickingItemContribution_pickingItemId_fkey" FOREIGN KEY ("pickingItemId") REFERENCES "PickingItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PickingItemContribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PickingItemContribution_quantity_check" CHECK ("quantity" >= 0)
    )`,
    `CREATE TABLE IF NOT EXISTS "PickingUnpickRequest" (
        "id" SERIAL NOT NULL,
        "orderId" INTEGER NOT NULL,
        "pickingItemId" INTEGER NOT NULL,
        "requesterUserId" INTEGER NOT NULL,
        "quantity" INTEGER NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "note" TEXT,
        "resolvedByUserId" INTEGER,
        "resolvedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PickingUnpickRequest_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "PickingUnpickRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PickingUnpickRequest_pickingItemId_fkey" FOREIGN KEY ("pickingItemId") REFERENCES "PickingItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PickingUnpickRequest_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PickingUnpickRequest_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "PickingUnpickRequest_quantity_check" CHECK ("quantity" > 0)
    )`,
    `CREATE TABLE IF NOT EXISTS "PickingOrderItemDetail" (
        "id" SERIAL NOT NULL,
        "orderId" INTEGER NOT NULL,
        "orderItemId" INTEGER NOT NULL,
        "pickingItemId" INTEGER,
        "variantId" INTEGER NOT NULL,
        "pickedQuantity" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PickingOrderItemDetail_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "PickingOrderItemDetail_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PickingOrderItemDetail_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PickingOrderItemDetail_pickingItemId_fkey" FOREIGN KEY ("pickingItemId") REFERENCES "PickingItem"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "PickingOrderItemDetail_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "PickingOrderItemDetail_pickedQuantity_check" CHECK ("pickedQuantity" >= 0)
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS "PickingSharedResponsibility_order_user_key" ON "PickingSharedResponsibility"("orderId", "userId")',
    'CREATE INDEX IF NOT EXISTS "PickingSharedResponsibility_order_active_idx" ON "PickingSharedResponsibility"("orderId", "isActive")',
    'CREATE INDEX IF NOT EXISTS "PickingSharedResponsibility_user_active_idx" ON "PickingSharedResponsibility"("userId", "isActive")',
    'CREATE INDEX IF NOT EXISTS "PickingResponsibilityRequest_order_status_idx" ON "PickingResponsibilityRequest"("orderId", "status")',
    'CREATE INDEX IF NOT EXISTS "PickingResponsibilityRequest_requester_status_idx" ON "PickingResponsibilityRequest"("requesterUserId", "status")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "PickingResponsibilityRequest_pending_unique_idx" ON "PickingResponsibilityRequest"("orderId", "requesterUserId", "mode", "status")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "PickingItemContribution_item_user_key" ON "PickingItemContribution"("pickingItemId", "userId")',
    'CREATE INDEX IF NOT EXISTS "PickingItemContribution_order_idx" ON "PickingItemContribution"("orderId")',
    'CREATE INDEX IF NOT EXISTS "PickingItemContribution_user_idx" ON "PickingItemContribution"("userId")',
    'CREATE INDEX IF NOT EXISTS "PickingUnpickRequest_order_status_idx" ON "PickingUnpickRequest"("orderId", "status")',
    'CREATE INDEX IF NOT EXISTS "PickingUnpickRequest_item_status_idx" ON "PickingUnpickRequest"("pickingItemId", "status")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "PickingOrderItemDetail_orderItem_unique_idx" ON "PickingOrderItemDetail"("orderItemId")',
    'CREATE INDEX IF NOT EXISTS "PickingOrderItemDetail_order_idx" ON "PickingOrderItemDetail"("orderId")',
    'CREATE INDEX IF NOT EXISTS "PickingOrderItemDetail_picking_item_idx" ON "PickingOrderItemDetail"("pickingItemId")',
    'DROP INDEX IF EXISTS "PickingUnpickRequest_pending_unique_idx"',
    `CREATE UNIQUE INDEX IF NOT EXISTS "PickingUnpickRequest_pending_unique_idx"
        ON "PickingUnpickRequest"("pickingItemId", "requesterUserId")
        WHERE "status" = 'PENDING'`,
];

export async function ensurePickingResponsibilitySchema(): Promise<void> {
    for (const statement of PICKING_RESPONSIBILITY_SCHEMA_STATEMENTS) {
        await prisma.$executeRawUnsafe(statement);
    }
}
