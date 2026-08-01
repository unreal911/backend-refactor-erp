import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from "vitest";
import { prisma, runTenantDatabaseTransaction } from "../src/data/prisma";
import { CreateOrderDto } from "../src/domain/dtos/create-order.dto";
import { inspectInventoryMigration } from "../src/modules/tenant/inventory-reconciliation";
import { LEGACY_TENANT_ID } from "../src/modules/tenant/tenant-data-context";
import { InventoryService } from "../src/presentation/services/inventory.service";
import { OrderService } from "../src/presentation/services/order.service";
import { ProductService } from "../src/presentation/services/product.service";
import { StoreService } from "../src/presentation/services/store.service";

const tag = Date.now().toString(36);
let dbReady = false;
let reconciled = false;
let tenantBId = "";
let categoryBId = 0;
let productBId = 0;
let variantBId = 0;
let storeBId = 0;
let inventoryBId = 0;
let orderBId = 0;
let legacyStoreCode = "";
let legacyInventoryIds: number[] = [];

async function inTenant<T>(tenantId: string, callback: () => Promise<T>): Promise<T> {
    return runTenantDatabaseTransaction(tenantId, () => callback());
}

beforeAll(async () => {
    const [migration, checkpoint, legacyStore] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
            `SELECT migration_name
             FROM "_prisma_migrations"
             WHERE migration_name = '20260729170000_validate_inventory_balances'
               AND finished_at IS NOT NULL`,
        ).catch(() => []),
        prisma.tenantMigrationCheckpoint.findFirst({
            where: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-005",
                status: "COMPLETED",
            },
        }).catch(() => null),
        prisma.store.findFirst({
            where: { tenantId: LEGACY_TENANT_ID },
            orderBy: { id: "asc" },
        }).catch(() => null),
    ]);
    dbReady = migration.length === 1 && Boolean(legacyStore);
    const details = checkpoint?.details as {
        version?: unknown;
        inventoryIds?: unknown;
    } | null;
    reconciled = details?.version === 1 && Array.isArray(details.inventoryIds);
    legacyInventoryIds = Array.isArray(details?.inventoryIds)
        ? details.inventoryIds.filter(
            (value): value is number => Number.isInteger(value),
        )
        : [];
    if (!dbReady || !legacyStore) return;
    legacyStoreCode = legacyStore.code;

    const tenantB = await prisma.tenant.create({
        data: {
            slug: `mig005-${tag}`,
            name: `MIG005 ${tag}`,
            status: "SUSPENDED",
        },
    });
    tenantBId = tenantB.id;

    await inTenant(tenantBId, async () => {
        const category = await prisma.category.create({
            data: { name: `MIG005 Category ${tag}` },
        });
        categoryBId = category.id;
        const product = await prisma.product.create({
            data: {
                name: `MIG005 Product ${tag}`,
                categoryId: category.id,
                hasColor: false,
                hasSize: false,
                variants: {
                    create: {
                        sku: `MIG005-SKU-${tag}`,
                        price: 25,
                        variantKey: "0-0",
                    },
                },
            },
            include: { variants: true },
        });
        productBId = product.id;
        variantBId = product.variants[0]!.id;
        const store = await prisma.store.create({
            data: {
                name: `MIG005 Store ${tag}`,
                code: legacyStore.code,
                type: "STORE",
                isActive: true,
            },
        });
        storeBId = store.id;
        const inventory = await prisma.inventory.create({
            data: {
                storeId: store.id,
                variantId: variantBId,
                stock: 9,
                reservedStock: 0,
            },
        });
        inventoryBId = inventory.id;
    });
});

afterAll(async () => {
    if (tenantBId) {
        await prisma.inventoryMovement.deleteMany({
            where: { inventoryId: inventoryBId },
        }).catch(() => undefined);
        await prisma.reservation.deleteMany({
            where: { variantId: variantBId },
        }).catch(() => undefined);
        if (orderBId) {
            await prisma.order.deleteMany({ where: { id: orderBId } })
                .catch(() => undefined);
        }
        await prisma.inventory.deleteMany({
            where: { id: inventoryBId },
        }).catch(() => undefined);
        await prisma.productVariant.deleteMany({
            where: { id: variantBId },
        }).catch(() => undefined);
        await prisma.product.deleteMany({
            where: { id: productBId },
        }).catch(() => undefined);
        await prisma.store.deleteMany({
            where: { id: storeBId },
        }).catch(() => undefined);
        await prisma.category.deleteMany({
            where: { id: categoryBId },
        }).catch(() => undefined);
        await prisma.tenant.deleteMany({
            where: { id: tenantBId },
        }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
});

describe("MIG-005: conciliación de tiendas e inventario", () => {
    it("conserva conteos, sumas, grupos e IDs heredados", async (ctx) => {
        if (!dbReady || !reconciled) return ctx.skip();

        const summary = await inspectInventoryMigration();
        expect(summary.storeCount).toBe(2);
        expect(summary.inventoryCount).toBe(5);
        expect(summary.stock).toBe(158);
        expect(summary.reservedStock).toBe(0);
        expect(summary.availableStock).toBe(158);
        expect(summary.storeGroups).toHaveLength(2);
        expect(summary.variantGroups).toHaveLength(4);
    });

    it("permite reutilizar código de tienda entre empresas", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const tenantStores = await inTenant(
            tenantBId,
            () => new StoreService().listStores({
                skip: 1,
                take: 10,
                includeInactive: true,
            } as never),
        );
        expect(tenantStores).toHaveLength(1);
        expect(tenantStores[0]?.code).toBe(legacyStoreCode);
    });

    it("PostgreSQL rechaza negativos y sobre-reserva sin corregirlos", async (ctx) => {
        if (!dbReady) return ctx.skip();

        await expect(inTenant(
            tenantBId,
            () => prisma.inventory.update({
                where: { id: inventoryBId },
                data: { reservedStock: 10 },
            }),
        )).rejects.toThrow();
        await expect(inTenant(
            tenantBId,
            () => prisma.inventory.update({
                where: { id: inventoryBId },
                data: { stock: -1 },
            }),
        )).rejects.toThrow();
        const current = await inTenant(
            tenantBId,
            () => prisma.inventory.findUnique({ where: { id: inventoryBId } }),
        );
        expect(current?.stock).toBe(9);
        expect(current?.reservedStock).toBe(0);
    });

    it("administración solo lista el saldo del tenant activo", async (ctx) => {
        if (!dbReady || !reconciled || legacyInventoryIds.length !== 5) {
            return ctx.skip();
        }

        const [tenantInventory, legacyInventory] = await Promise.all([
            inTenant(
                tenantBId,
                () => new InventoryService().listInventories({
                    includeZero: true,
                }),
            ),
            inTenant(
                LEGACY_TENANT_ID,
                () => new InventoryService().listInventories({
                    includeZero: true,
                }),
            ),
        ]);
        expect(tenantInventory).toHaveLength(1);
        expect(tenantInventory[0]?.stock).toBe(9);
        expect(legacyInventory.filter(
            (row) => legacyInventoryIds.includes(row.id),
        )).toHaveLength(5);
        expect(legacyInventory.some((row) => row.id === inventoryBId)).toBe(false);
    });

    it("POS consume B y marketplace publica B sin alterar A", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const legacyBefore = await inTenant(
            LEGACY_TENANT_ID,
            () => prisma.inventory.aggregate({
                where: { id: { in: legacyInventoryIds } },
                _sum: { stock: true },
            }),
        );
        const [dtoError, dto] = CreateOrderDto.create({
            sourceStoreId: storeBId,
            applyIgv: false,
            note: `Metodo de pago: Efectivo | POS-${tag}`,
            idempotencyKey: `MIG005-POS-${tag}`,
            items: [{
                variantId: variantBId,
                quantity: 1,
                unitPrice: 25,
            }],
        });
        expect(dtoError).toBeUndefined();
        const order = await inTenant(
            tenantBId,
            () => new OrderService().createOrder(dto!),
        );
        orderBId = order.id;

        const [tenantInventory, legacyAfter, tenantCatalog, legacyCatalog] =
            await Promise.all([
                inTenant(
                    tenantBId,
                    () => prisma.inventory.findUnique({
                        where: { id: inventoryBId },
                    }),
                ),
                inTenant(
                    LEGACY_TENANT_ID,
                    () => prisma.inventory.aggregate({
                        where: { id: { in: legacyInventoryIds } },
                        _sum: { stock: true },
                    }),
                ),
                inTenant(
                    tenantBId,
                    () => new ProductService().listPublicProducts({
                        skip: 1,
                        take: 10,
                        search: `MIG005 Product ${tag}`,
                        allowBackorder: true,
                    } as never),
                ),
                inTenant(
                    LEGACY_TENANT_ID,
                    () => new ProductService().listPublicProducts({
                        skip: 1,
                        take: 10,
                        search: `MIG005 Product ${tag}`,
                        allowBackorder: true,
                    } as never),
                ),
            ]);
        expect(tenantInventory?.stock).toBe(8);
        expect(legacyAfter._sum.stock).toBe(legacyBefore._sum.stock);
        expect(tenantCatalog.data).toHaveLength(1);
        expect(tenantCatalog.data[0]?.totalAvailableStock).toBe(8);
        expect(legacyCatalog.data).toHaveLength(0);
    });
});
