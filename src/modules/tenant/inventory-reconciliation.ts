import { createHash } from "node:crypto";
import {
    Prisma,
    TenantMigrationStatus,
} from "@prisma/client";
import { prisma } from "../../data/prisma";
import { LEGACY_TENANT_ID } from "./tenant-data-context";

const LEGACY_INVENTORY_BASELINE = {
    stores: 2,
    inventories: 5,
    stock: 158,
    reservedStock: 0,
} as const;

type SealedInventoryIds = {
    storeIds: number[];
    inventoryIds: number[];
};

export type InventoryReconciliationSummary = SealedInventoryIds & {
    storeCount: number;
    inventoryCount: number;
    stock: number;
    reservedStock: number;
    availableStock: number;
    storeGroups: Array<{
        storeId: number;
        inventoryCount: number;
        stock: number;
        reservedStock: number;
    }>;
    variantGroups: Array<{
        variantId: number;
        inventoryCount: number;
        stock: number;
        reservedStock: number;
    }>;
    storeReferenceCount: number;
    fingerprints: {
        stores: string;
        inventories: string;
        groups: string;
        logicalInventory: string;
    };
};

function digest(value: unknown): string {
    return createHash("sha256")
        .update(JSON.stringify(value))
        .digest("hex");
}

function readSealedIds(details: Prisma.JsonValue | null): SealedInventoryIds | null {
    if (!details || typeof details !== "object" || Array.isArray(details)) {
        return null;
    }
    const record = details as Record<string, unknown>;
    const storeIds = Array.isArray(record.storeIds)
        ? record.storeIds.filter(
            (value): value is number => Number.isInteger(value) && Number(value) > 0,
        )
        : [];
    const inventoryIds = Array.isArray(record.inventoryIds)
        ? record.inventoryIds.filter(
            (value): value is number => Number.isInteger(value) && Number(value) > 0,
        )
        : [];
    return storeIds.length > 0 && inventoryIds.length > 0
        ? { storeIds, inventoryIds }
        : null;
}

async function assertValidatedBalanceConstraints(): Promise<void> {
    const rows = await prisma.$queryRaw<Array<{
        conname: string;
        convalidated: boolean;
    }>>(Prisma.sql`
        SELECT conname, convalidated
        FROM pg_constraint
        WHERE conrelid = '"Inventory"'::regclass
          AND conname IN (
              'Inventory_stock_nonneg_check',
              'Inventory_reserved_range_check'
          )
    `);
    if (rows.length !== 2 || rows.some((row) => !row.convalidated)) {
        throw new Error("Las restricciones de saldo no están validadas");
    }
}

async function countStoreReferences(): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT (
            (SELECT COUNT(*) FROM "Order" WHERE "sourceStoreId" IS NOT NULL)
            + (SELECT COUNT(*) FROM "Order" WHERE "fulfillmentStoreId" IS NOT NULL)
            + (SELECT COUNT(*) FROM "OrderItem" WHERE "fulfillmentStoreId" IS NOT NULL)
            + (SELECT COUNT(*) FROM "StockTransfer" WHERE "fromStoreId" IS NOT NULL)
            + (SELECT COUNT(*) FROM "StockTransfer" WHERE "toStoreId" IS NOT NULL)
            + (SELECT COUNT(*) FROM "OrderReturn" WHERE "storeId" IS NOT NULL)
            + (SELECT COUNT(*) FROM "ComprobanteSerie" WHERE "storeId" IS NOT NULL)
        )::bigint AS count
    `);
    return Number(rows[0]?.count ?? 0n);
}

export async function inspectInventoryMigration(): Promise<InventoryReconciliationSummary> {
    const checkpoint = await prisma.tenantMigrationCheckpoint.findUnique({
        where: {
            tenantId_storyId: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-005",
            },
        },
        select: { details: true },
    });
    const sealed = readSealedIds(checkpoint?.details ?? null);
    const stores = await prisma.store.findMany({
        where: {
            tenantId: LEGACY_TENANT_ID,
            ...(sealed ? { id: { in: sealed.storeIds } } : {}),
        },
        orderBy: { id: "asc" },
        include: {
            inventories: {
                where: sealed ? { id: { in: sealed.inventoryIds } } : {},
                orderBy: { id: "asc" },
                include: {
                    variant: true,
                },
            },
        },
    });
    const inventories = stores.flatMap((store) =>
        store.inventories.map((inventory) => ({ ...inventory, store })),
    );
    if (
        stores.length !== LEGACY_INVENTORY_BASELINE.stores
        || inventories.length !== LEGACY_INVENTORY_BASELINE.inventories
    ) {
        throw new Error(
            `Conteos de inventario inesperados: tiendas ${stores.length}/2, `
            + `saldos ${inventories.length}/5`,
        );
    }

    const stock = inventories.reduce((sum, inventory) => sum + inventory.stock, 0);
    const reservedStock = inventories.reduce(
        (sum, inventory) => sum + inventory.reservedStock,
        0,
    );
    if (
        stock !== LEGACY_INVENTORY_BASELINE.stock
        || reservedStock !== LEGACY_INVENTORY_BASELINE.reservedStock
    ) {
        throw new Error(
            `Totales de inventario inesperados: stock ${stock}/158, reservado ${reservedStock}/0`,
        );
    }

    const invalid = inventories.filter((inventory) =>
        inventory.stock < 0
        || inventory.reservedStock < 0
        || inventory.reservedStock > inventory.stock
        || inventory.store.tenantId !== inventory.tenantId
        || inventory.variant.tenantId !== inventory.tenantId
    );
    if (invalid.length > 0) {
        throw new Error(`Existen ${invalid.length} saldos inválidos o cruzados`);
    }
    const pairKeys = inventories.map(
        (inventory) => `${inventory.storeId}:${inventory.variantId}`,
    );
    if (new Set(pairKeys).size !== pairKeys.length) {
        throw new Error("Existen pares tienda/variante duplicados");
    }

    const storeGroups = stores.map((store) => ({
        storeId: store.id,
        inventoryCount: store.inventories.length,
        stock: store.inventories.reduce((sum, inventory) => sum + inventory.stock, 0),
        reservedStock: store.inventories.reduce(
            (sum, inventory) => sum + inventory.reservedStock,
            0,
        ),
    }));
    const variantMap = new Map<number, {
        variantId: number;
        inventoryCount: number;
        stock: number;
        reservedStock: number;
    }>();
    for (const inventory of inventories) {
        const current = variantMap.get(inventory.variantId) ?? {
            variantId: inventory.variantId,
            inventoryCount: 0,
            stock: 0,
            reservedStock: 0,
        };
        current.inventoryCount += 1;
        current.stock += inventory.stock;
        current.reservedStock += inventory.reservedStock;
        variantMap.set(inventory.variantId, current);
    }
    const variantGroups = [...variantMap.values()].sort(
        (left, right) => left.variantId - right.variantId,
    );

    await assertValidatedBalanceConstraints();
    const storeReferenceCount = await countStoreReferences();
    const storeRows = stores.map((store) => ({
        id: store.id,
        tenantId: store.tenantId,
        name: store.name,
        code: store.code,
        type: store.type,
        address: store.address,
        isActive: store.isActive,
        createdAt: store.createdAt.toISOString(),
        updatedAt: store.updatedAt.toISOString(),
    }));
    const inventoryRows = inventories.map((inventory) => ({
        id: inventory.id,
        tenantId: inventory.tenantId,
        storeId: inventory.storeId,
        variantId: inventory.variantId,
        stock: inventory.stock,
        reservedStock: inventory.reservedStock,
        createdAt: inventory.createdAt.toISOString(),
        updatedAt: inventory.updatedAt.toISOString(),
    }));

    return {
        storeIds: stores.map((store) => store.id),
        inventoryIds: inventories.map((inventory) => inventory.id),
        storeCount: stores.length,
        inventoryCount: inventories.length,
        stock,
        reservedStock,
        availableStock: stock - reservedStock,
        storeGroups,
        variantGroups,
        storeReferenceCount,
        fingerprints: {
            stores: digest(storeRows),
            inventories: digest(inventoryRows),
            groups: digest({ storeGroups, variantGroups }),
            logicalInventory: digest({ storeRows, inventoryRows }),
        },
    };
}

export async function reconcileInventoryMigration(): Promise<InventoryReconciliationSummary> {
    const checkpoint = await prisma.tenantMigrationCheckpoint.findUnique({
        where: {
            tenantId_storyId: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-005",
            },
        },
    });
    if (!checkpoint) throw new Error("No existe el checkpoint MIG-005");

    await prisma.tenantMigrationCheckpoint.update({
        where: { id: checkpoint.id },
        data: {
            status: TenantMigrationStatus.RUNNING,
            startedAt: checkpoint.startedAt ?? new Date(),
            completedAt: null,
        },
    });
    try {
        const summary = await inspectInventoryMigration();
        await prisma.tenantMigrationCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
                status: TenantMigrationStatus.COMPLETED,
                completedAt: new Date(),
                details: {
                    version: 1,
                    transformation: "IN_PLACE",
                    tenantId: LEGACY_TENANT_ID,
                    policy: "docs/migration/inventory-reconciliation-policy.md",
                    baselineReport:
                        "legacy-baseline-2026-07-29T16-27-05-069Z.json",
                    ...summary,
                } as Prisma.InputJsonObject,
            },
        });
        return summary;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.tenantMigrationCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
                status: TenantMigrationStatus.FAILED,
                completedAt: null,
                details: {
                    version: 1,
                    policy: "docs/migration/inventory-reconciliation-policy.md",
                    failure: message.slice(0, 500),
                },
            },
        }).catch(() => undefined);
        throw error;
    }
}
