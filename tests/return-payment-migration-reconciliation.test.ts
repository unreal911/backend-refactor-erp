import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from "vitest";
import { prisma, runTenantDatabaseTransaction } from "../src/data/prisma";
import {
    inspectReturnPaymentMigration,
    parseLegacyPaymentEvidence,
    reconcileReturnPaymentMigration,
} from "../src/modules/tenant/return-payment-reconciliation";
import { LEGACY_TENANT_ID } from "../src/modules/tenant/tenant-data-context";
import { OrderService } from "../src/presentation/services/order.service";

const tag = Date.now().toString(36);
let dbReady = false;
let reconciled = false;
let tenantBId = "";
let membershipId = "";
let userId = 0;
let categoryId = 0;
let productId = 0;
let variantId = 0;
let storeId = 0;
let inventoryId = 0;
let legacyOrderId = 0;
let legacyStoreId = 0;
const orderIds: number[] = [];

async function inTenant<T>(
    tenantId: string,
    callback: () => Promise<T>,
): Promise<T> {
    return runTenantDatabaseTransaction(tenantId, () => callback());
}

async function createDeliveredOrder(
    quantity: number,
    unitPrice: number,
    note?: string | null,
) {
    const order = await inTenant(
        tenantBId,
        () => prisma.order.create({
            data: {
                code: `MIG008-${tag}-${orderIds.length + 1}`,
                status: "DELIVERED",
                subtotal: quantity * unitPrice,
                tax: 0,
                total: quantity * unitPrice,
                note,
                sourceStoreId: storeId,
                fulfillmentStoreId: storeId,
                sellerUserId: userId,
                items: {
                    create: {
                        variantId,
                        fulfillmentStoreId: storeId,
                        quantity,
                        reserved: quantity,
                        picked: quantity,
                        unitPrice,
                        subtotal: quantity * unitPrice,
                        status: "PICKED",
                    },
                },
            },
            include: { items: true },
        }),
    );
    orderIds.push(order.id);
    return order;
}

beforeAll(async () => {
    const [migration, checkpoint, membership, legacyOrder, legacyStore] =
        await Promise.all([
            prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
                `SELECT migration_name
                 FROM "_prisma_migrations"
                 WHERE migration_name =
                   '20260729190000_guard_return_quantities'
                   AND finished_at IS NOT NULL`,
            ).catch(() => []),
            prisma.tenantMigrationCheckpoint.findFirst({
                where: {
                    tenantId: LEGACY_TENANT_ID,
                    storyId: "MIG-008",
                    status: "COMPLETED",
                },
            }).catch(() => null),
            prisma.tenantMembership.findFirst({
                where: {
                    tenantId: LEGACY_TENANT_ID,
                    status: "ACTIVE",
                },
                orderBy: { userId: "asc" },
                select: { userId: true },
            }).catch(() => null),
            prisma.order.findFirst({
                where: { tenantId: LEGACY_TENANT_ID },
                orderBy: { id: "asc" },
                select: { id: true },
            }).catch(() => null),
            prisma.store.findFirst({
                where: { tenantId: LEGACY_TENANT_ID },
                orderBy: { id: "asc" },
                select: { id: true },
            }).catch(() => null),
        ]);
    const details = checkpoint?.details as {
        version?: unknown;
        fingerprints?: unknown;
    } | null;
    reconciled = details?.version === 1
        && Boolean(details.fingerprints);
    dbReady = migration.length === 1
        && Boolean(membership)
        && Boolean(legacyOrder)
        && Boolean(legacyStore);
    if (!dbReady || !membership || !legacyOrder || !legacyStore) return;

    userId = membership.userId;
    legacyOrderId = legacyOrder.id;
    legacyStoreId = legacyStore.id;
    const tenant = await prisma.tenant.create({
        data: {
            slug: `mig008-${tag}`,
            name: `MIG008 ${tag}`,
            status: "SUSPENDED",
        },
    });
    tenantBId = tenant.id;
    const createdMembership = await prisma.tenantMembership.create({
        data: {
            tenantId: tenantBId,
            userId,
            role: "ADMIN",
            status: "ACTIVE",
            activatedAt: new Date(),
        },
    });
    membershipId = createdMembership.id;

    await inTenant(tenantBId, async () => {
        const category = await prisma.category.create({
            data: { name: `MIG008 Category ${tag}` },
        });
        categoryId = category.id;
        const product = await prisma.product.create({
            data: {
                name: `MIG008 Product ${tag}`,
                categoryId,
                variants: {
                    create: {
                        sku: `MIG008-SKU-${tag}`,
                        price: 15,
                        variantKey: "0-0",
                    },
                },
            },
            include: { variants: true },
        });
        productId = product.id;
        variantId = product.variants[0]!.id;
        const store = await prisma.store.create({
            data: {
                name: `MIG008 Store ${tag}`,
                code: `MIG008-${tag}`,
            },
        });
        storeId = store.id;
        const inventory = await prisma.inventory.create({
            data: {
                storeId,
                variantId,
                stock: 10,
                reservedStock: 0,
            },
        });
        inventoryId = inventory.id;
    });
});

afterAll(async () => {
    if (tenantBId) {
        await inTenant(tenantBId, async () => {
            await prisma.inventoryMovement.deleteMany()
                .catch(() => undefined);
            await prisma.orderReturnItem.deleteMany()
                .catch(() => undefined);
            await prisma.orderReturn.deleteMany()
                .catch(() => undefined);
            await prisma.orderItem.deleteMany()
                .catch(() => undefined);
            await prisma.order.deleteMany()
                .catch(() => undefined);
            await prisma.inventory.deleteMany()
                .catch(() => undefined);
            if (variantId) {
                await prisma.productVariant.deleteMany({
                    where: { id: variantId },
                }).catch(() => undefined);
            }
            if (productId) {
                await prisma.product.deleteMany({
                    where: { id: productId },
                }).catch(() => undefined);
            }
            await prisma.store.deleteMany()
                .catch(() => undefined);
            if (categoryId) {
                await prisma.category.deleteMany({
                    where: { id: categoryId },
                }).catch(() => undefined);
            }
        });
        await prisma.tenantMembership.deleteMany({
            where: { id: membershipId },
        }).catch(() => undefined);
        await prisma.tenant.deleteMany({
            where: { id: tenantBId },
        }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
});

describe("MIG-008: devoluciones y evidencia de pago heredada", () => {
    it("preserva la línea base sin inventar pagos estructurados", async (ctx) => {
        if (!dbReady || !reconciled) return ctx.skip();

        const summary = await inspectReturnPaymentMigration();
        expect(summary.counts).toEqual({
            orders: 42,
            orderItems: 106,
            returns: 0,
            returnItems: 0,
            restockedReturns: 0,
            spoilageReturns: 0,
        });
        expect(summary.totals).toEqual({
            returnedQuantity: 0,
            returnQuantity: 0,
            returnAmount: "0.00",
        });
        expect(summary.paymentEvidence).toMatchObject({
            notes: 40,
            parsed: 18,
            withMethod: 18,
            withReference: 18,
            withAmount: 18,
            withChange: 18,
            ordersWithoutPaymentEvidence: 24,
            structuredPaymentTables: 0,
            methodGroups: [{ method: "Efectivo", count: 18 }],
        });
        expect(summary.returnGroups).toEqual([]);
        expect(summary.reconciliationViolations).toBe(0);
        expect(summary.crossTenantReferences).toBe(0);
        expect(summary.tenantConstraintCount).toBe(6);
        expect(summary.returnGuardCount).toBe(3);
    });

    it("interpreta evidencia sin modificar la nota original", () => {
        const note =
            "Metodo de pago: Efectivo | Ref: TEST-REF | "
            + "Monto recibido: S/ 80.50 | Vuelto: 5,25";
        expect(parseLegacyPaymentEvidence(note)).toEqual({
            method: "Efectivo",
            reference: "TEST-REF",
            amountLabel: "monto recibido",
            amount: "S/ 80.50",
            amountCents: 8050,
            changeLabel: "vuelto",
            change: "5,25",
            changeCents: 525,
        });
        expect(parseLegacyPaymentEvidence(
            "CHANNEL: ECOMMERCE | ORIGIN: WEB",
        )).toBeNull();
        expect(note).toContain("Ref: TEST-REF");
    });

    it("devuelve parcialmente, rechaza el exceso y completa el total", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const paymentNote =
            "Metodo de pago: Efectivo | Ref: TEST-PARTIAL | "
            + "Monto recibido: 60.00 | Vuelto: 10.00";
        const order = await createDeliveredOrder(5, 10, paymentNote);
        const item = order.items[0]!;
        const service = new OrderService();

        const first = await inTenant(
            tenantBId,
            () => service.registerOrderReturn(
                order.id,
                {
                    reason: "defecto",
                    note: "empaque abierto",
                    items: [{ orderItemId: item.id, quantity: 2 }],
                },
                userId,
            ),
        );
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({
            orderId: order.id,
            storeId,
            reason: "defecto",
            note: "empaque abierto",
            restock: true,
            responsibleUserId: userId,
            totalQuantity: 2,
        });
        expect(Number(first[0]!.totalAmount)).toBe(20);
        expect(first[0]!.items).toHaveLength(1);
        expect(first[0]!.items[0]).toMatchObject({
            orderItemId: item.id,
            variantId,
            quantity: 2,
        });
        expect(Number(first[0]!.items[0]!.subtotal)).toBe(20);

        const afterPartial = await inTenant(
            tenantBId,
            () => Promise.all([
                prisma.inventory.findUniqueOrThrow({
                    where: { id: inventoryId },
                }),
                prisma.orderItem.findUniqueOrThrow({
                    where: { id: item.id },
                }),
                prisma.order.findUniqueOrThrow({
                    where: { id: order.id },
                }),
                prisma.inventoryMovement.findMany({
                    where: { inventoryId },
                    orderBy: { id: "asc" },
                }),
            ]),
        );
        expect(afterPartial[0].stock).toBe(12);
        expect(afterPartial[1].returnedQuantity).toBe(2);
        expect(afterPartial[2].returnedAt).toBeNull();
        expect(afterPartial[2].note).toBe(paymentNote);
        expect(afterPartial[3]).toHaveLength(1);
        expect(afterPartial[3][0]).toMatchObject({
            type: "IN",
            quantity: 2,
            previousStock: 10,
            newStock: 12,
            responsibleUserId: userId,
        });

        await expect(inTenant(
            tenantBId,
            () => service.registerOrderReturn(
                order.id,
                {
                    reason: "exceso",
                    items: [{ orderItemId: item.id, quantity: 4 }],
                },
                userId,
            ),
        )).rejects.toThrow(/solo quedan 3/i);
        expect((await inTenant(
            tenantBId,
            () => prisma.inventory.findUniqueOrThrow({
                where: { id: inventoryId },
            }),
        )).stock).toBe(12);

        await inTenant(
            tenantBId,
            () => service.registerOrderReturn(
                order.id,
                {
                    reason: "completa",
                    items: [{ orderItemId: item.id, quantity: 3 }],
                },
                userId,
            ),
        );
        const completed = await inTenant(
            tenantBId,
            () => Promise.all([
                prisma.inventory.findUniqueOrThrow({
                    where: { id: inventoryId },
                }),
                prisma.orderItem.findUniqueOrThrow({
                    where: { id: item.id },
                }),
                prisma.order.findUniqueOrThrow({
                    where: { id: order.id },
                }),
                prisma.orderReturn.findMany({
                    where: { orderId: order.id },
                    orderBy: { id: "asc" },
                }),
                prisma.inventoryMovement.findMany({
                    where: { inventoryId },
                    orderBy: { id: "asc" },
                }),
            ]),
        );
        expect(completed[0].stock).toBe(15);
        expect(completed[1].returnedQuantity).toBe(5);
        expect(completed[2].returnedAt).not.toBeNull();
        expect(completed[3].map((row) => row.totalQuantity)).toEqual([2, 3]);
        expect(completed[3].reduce(
            (sum, row) => sum + Number(row.totalAmount),
            0,
        )).toBe(50);
        expect(completed[4].map((row) => row.quantity)).toEqual([2, 3]);
    });

    it("registra merma sin reponer inventario ni crear movimiento", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const order = await createDeliveredOrder(2, 15, null);
        const item = order.items[0]!;
        const before = await inTenant(
            tenantBId,
            () => Promise.all([
                prisma.inventory.findUniqueOrThrow({
                    where: { id: inventoryId },
                }),
                prisma.inventoryMovement.count({
                    where: { inventoryId },
                }),
            ]),
        );
        const returns = await inTenant(
            tenantBId,
            () => new OrderService().registerOrderReturn(
                order.id,
                {
                    reason: "producto roto",
                    note: "merma comprobada",
                    restock: false,
                    items: [{ orderItemId: item.id, quantity: 2 }],
                },
                userId,
            ),
        );
        const after = await inTenant(
            tenantBId,
            () => Promise.all([
                prisma.inventory.findUniqueOrThrow({
                    where: { id: inventoryId },
                }),
                prisma.inventoryMovement.count({
                    where: { inventoryId },
                }),
                prisma.orderItem.findUniqueOrThrow({
                    where: { id: item.id },
                }),
                prisma.order.findUniqueOrThrow({
                    where: { id: order.id },
                }),
            ]),
        );
        expect(returns).toHaveLength(1);
        expect(returns[0]).toMatchObject({
            restock: false,
            reason: "producto roto",
            totalQuantity: 2,
        });
        expect(Number(returns[0]!.totalAmount)).toBe(30);
        expect(after[0].stock).toBe(before[0].stock);
        expect(after[1]).toBe(before[1]);
        expect(after[2].returnedQuantity).toBe(2);
        expect(after[3].returnedAt).not.toBeNull();
        expect(after[3].note).toBeNull();
    });

    it("aplica guardas SQL y aislamiento entre empresas", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const order = await createDeliveredOrder(
            1,
            12,
            "CHANNEL: ECOMMERCE | ORIGIN: WEB",
        );
        const item = order.items[0]!;

        await expect(inTenant(
            tenantBId,
            () => prisma.orderItem.update({
                where: { id: item.id },
                data: { returnedQuantity: 2 },
            }),
        )).rejects.toThrow(/OrderItem_returned_quantity_check|constraint/i);
        await expect(inTenant(
            tenantBId,
            () => prisma.orderReturn.create({
                data: {
                    orderId: order.id,
                    storeId,
                    reason: "inválida",
                    totalQuantity: 0,
                    totalAmount: 0,
                },
            }),
        )).rejects.toThrow(/OrderReturn_totals_check|constraint/i);
        await expect(inTenant(
            tenantBId,
            () => prisma.orderReturn.create({
                data: {
                    orderId: legacyOrderId,
                    storeId: legacyStoreId,
                    reason: "cruzada",
                    totalQuantity: 1,
                    totalAmount: 1,
                },
            }),
        )).rejects.toThrow(/tenant|constraint|diferentes/i);

        const visibleFromLegacy = await inTenant(
            LEGACY_TENANT_ID,
            () => prisma.orderReturn.findMany({
                where: { orderId: order.id },
            }),
        );
        expect(visibleFromLegacy).toEqual([]);
        expect((await inTenant(
            tenantBId,
            () => prisma.orderItem.findUniqueOrThrow({
                where: { id: item.id },
            }),
        )).returnedQuantity).toBe(0);
    });

    it("la reejecución conserva huellas y no toca el tenant de prueba", async (ctx) => {
        if (!dbReady || !reconciled) return ctx.skip();

        const before = await inspectReturnPaymentMigration();
        const tenantRowsBefore = await inTenant(
            tenantBId,
            () => Promise.all([
                prisma.orderReturn.count(),
                prisma.orderReturnItem.count(),
                prisma.inventoryMovement.count(),
            ]),
        );
        await reconcileReturnPaymentMigration();
        await reconcileReturnPaymentMigration();
        const after = await inspectReturnPaymentMigration();
        const tenantRowsAfter = await inTenant(
            tenantBId,
            () => Promise.all([
                prisma.orderReturn.count(),
                prisma.orderReturnItem.count(),
                prisma.inventoryMovement.count(),
            ]),
        );

        expect(after.fingerprints).toEqual(before.fingerprints);
        expect(after.returnIds).toEqual(before.returnIds);
        expect(after.returnItemIds).toEqual(before.returnItemIds);
        expect(tenantRowsAfter).toEqual(tenantRowsBefore);
    });
});
