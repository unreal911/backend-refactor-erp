import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from "vitest";
import { prisma, runTenantDatabaseTransaction } from "../src/data/prisma";
import { PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY } from "../src/data/system-config-keys";
import { CreateOrderDto } from "../src/domain/dtos/create-order.dto";
import { DelegatePickingResponsibilityDto } from "../src/domain/dtos/delegate-picking-responsibility.dto";
import { RequestPickingResponsibilityDto } from "../src/domain/dtos/request-picking-responsibility.dto";
import {
    OrderStatusEnum,
    UpdateOrderStatusDto,
} from "../src/domain/dtos/update-order-status.dto";
import {
    inspectOrderPickingMigration,
    reconcileOrderPickingMigration,
} from "../src/modules/tenant/order-picking-reconciliation";
import { LEGACY_TENANT_ID } from "../src/modules/tenant/tenant-data-context";
import { OrderService } from "../src/presentation/services/order.service";

const tag = Date.now().toString(36);
let dbReady = false;
let reconciled = false;
let closureApplied = false;
let tenantBId = "";
let membership1Id = "";
let membership2Id = "";
let user1Id = 0;
let user2Id = 0;
let categoryBId = 0;
let productBId = 0;
let variantBId = 0;
let sourceStoreBId = 0;
let remoteStoreBId = 0;
let sourceInventoryBId = 0;
let remoteInventoryBId = 0;
let legacyCode = "";
let legacyIdempotencyKey = "";
const orderIds: number[] = [];

async function inTenant<T>(
    tenantId: string,
    callback: () => Promise<T>,
): Promise<T> {
    return runTenantDatabaseTransaction(tenantId, () => callback());
}

function createDto(
    quantity: number,
    idempotencyKey: string,
    fulfillmentStoreId?: number,
): CreateOrderDto {
    const [error, dto] = CreateOrderDto.create({
        sourceStoreId: sourceStoreBId,
        sellerUserId: user1Id,
        applyIgv: false,
        note: `MIG007 ECOMMERCE ${tag}`,
        idempotencyKey,
        items: [{
            variantId: variantBId,
            quantity,
            unitPrice: 25,
            ...(fulfillmentStoreId ? { fulfillmentStoreId } : {}),
        }],
    });
    if (error || !dto) throw new Error(error ?? "DTO de pedido inválido");
    return dto;
}

function statusDto(status: OrderStatusEnum): UpdateOrderStatusDto {
    const [error, dto] = UpdateOrderStatusDto.create({ status });
    if (error || !dto) throw new Error(error ?? "Estado inválido");
    return dto;
}

beforeAll(async () => {
    const [migration, closure, checkpoint, memberships, legacyOrder] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
            `SELECT migration_name
             FROM "_prisma_migrations"
             WHERE migration_name = '20260729180000_guard_picking_quantities'
               AND finished_at IS NOT NULL`,
        ).catch(() => []),
        prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
            `SELECT migration_name
             FROM "_prisma_migrations"
             WHERE migration_name =
                   '20260729220000_close_non_sunat_backfill'
               AND finished_at IS NOT NULL`,
        ).catch(() => []),
        prisma.tenantMigrationCheckpoint.findFirst({
            where: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-007",
                status: "COMPLETED",
            },
        }).catch(() => null),
        prisma.tenantMembership.findMany({
            where: {
                tenantId: LEGACY_TENANT_ID,
                status: "ACTIVE",
            },
            orderBy: { userId: "asc" },
            take: 2,
            select: { userId: true },
        }).catch(() => []),
        prisma.order.findFirst({
            where: {
                tenantId: LEGACY_TENANT_ID,
                idempotencyKey: { not: null },
            },
            orderBy: { id: "asc" },
            select: { code: true, idempotencyKey: true },
        }).catch(() => null),
    ]);
    const details = checkpoint?.details as {
        version?: unknown;
        orderIds?: unknown;
    } | null;
    reconciled = details?.version === 1 && Array.isArray(details.orderIds);
    closureApplied = closure.length === 1;
    dbReady = migration.length === 1
        && memberships.length === 2
        && Boolean(legacyOrder);
    if (!dbReady || !legacyOrder) return;

    user1Id = memberships[0]!.userId;
    user2Id = memberships[1]!.userId;
    legacyCode = legacyOrder.code;
    legacyIdempotencyKey = legacyOrder.idempotencyKey!;

    const tenant = await prisma.tenant.create({
        data: {
            slug: `mig007-${tag}`,
            name: `MIG007 ${tag}`,
            status: "SUSPENDED",
        },
    });
    tenantBId = tenant.id;
    const [membership1, membership2] = await Promise.all([
        prisma.tenantMembership.create({
            data: {
                tenantId: tenantBId,
                userId: user1Id,
                role: "ADMIN",
                status: "ACTIVE",
                activatedAt: new Date(),
            },
        }),
        prisma.tenantMembership.create({
            data: {
                tenantId: tenantBId,
                userId: user2Id,
                role: "SELLER",
                status: "ACTIVE",
                activatedAt: new Date(),
            },
        }),
    ]);
    membership1Id = membership1.id;
    membership2Id = membership2.id;

    await inTenant(tenantBId, async () => {
        const category = await prisma.category.create({
            data: { name: `MIG007 Category ${tag}` },
        });
        categoryBId = category.id;
        const product = await prisma.product.create({
            data: {
                name: `MIG007 Product ${tag}`,
                categoryId: category.id,
                variants: {
                    create: {
                        sku: `MIG007-SKU-${tag}`,
                        price: 25,
                        variantKey: "0-0",
                    },
                },
            },
            include: { variants: true },
        });
        productBId = product.id;
        variantBId = product.variants[0]!.id;
        const [source, remote] = await Promise.all([
            prisma.store.create({
                data: {
                    name: `MIG007 Source ${tag}`,
                    code: `MIG007-S-${tag}`,
                },
            }),
            prisma.store.create({
                data: {
                    name: `MIG007 Remote ${tag}`,
                    code: `MIG007-R-${tag}`,
                },
            }),
        ]);
        sourceStoreBId = source.id;
        remoteStoreBId = remote.id;
        const [sourceInventory, remoteInventory] = await Promise.all([
            prisma.inventory.create({
                data: {
                    storeId: source.id,
                    variantId: variantBId,
                    stock: 50,
                    reservedStock: 0,
                },
            }),
            prisma.inventory.create({
                data: {
                    storeId: remote.id,
                    variantId: variantBId,
                    stock: 40,
                    reservedStock: 0,
                },
            }),
        ]);
        sourceInventoryBId = sourceInventory.id;
        remoteInventoryBId = remoteInventory.id;
    });

    await prisma.$executeRawUnsafe(
        `INSERT INTO "SystemSetting" (
            "tenantId", "key", "value", "createdAt", "updatedAt"
         )
         VALUES ($1::uuid, $2, 'true', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT ("tenantId", "key")
         DO UPDATE SET "value"='true', "updatedAt"=CURRENT_TIMESTAMP`,
        tenantBId,
        PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY,
    );
});

afterAll(async () => {
    if (tenantBId) {
        for (const table of [
            "PickingUnpickRequest",
            "PickingItemContribution",
            "PickingOrderItemDetail",
            "PickingResponsibilityRequest",
            "PickingSharedResponsibility",
        ]) {
            await prisma.$executeRawUnsafe(
                `DELETE FROM "${table}" WHERE "tenantId"=$1::uuid`,
                tenantBId,
            ).catch(() => undefined);
        }
        await prisma.inventoryMovement.deleteMany({
            where: { tenantId: tenantBId },
        }).catch(() => undefined);
        await prisma.pickingItem.deleteMany({
            where: { tenantId: tenantBId },
        }).catch(() => undefined);
        await prisma.pickingSession.deleteMany({
            where: { tenantId: tenantBId },
        }).catch(() => undefined);
        await prisma.reservation.deleteMany({
            where: { tenantId: tenantBId },
        }).catch(() => undefined);
        await prisma.orderItem.deleteMany({
            where: { tenantId: tenantBId },
        }).catch(() => undefined);
        await prisma.stockTransferItem.deleteMany({
            where: { tenantId: tenantBId },
        }).catch(() => undefined);
        await prisma.stockTransfer.deleteMany({
            where: { tenantId: tenantBId },
        }).catch(() => undefined);
        await prisma.order.deleteMany({
            where: { tenantId: tenantBId },
        }).catch(() => undefined);
        await prisma.inventory.deleteMany({
            where: { tenantId: tenantBId },
        }).catch(() => undefined);
        if (variantBId) {
            await prisma.productVariant.deleteMany({
                where: { id: variantBId },
            }).catch(() => undefined);
        }
        if (productBId) {
            await prisma.product.deleteMany({
                where: { id: productBId },
            }).catch(() => undefined);
        }
        await prisma.store.deleteMany({
            where: { tenantId: tenantBId },
        }).catch(() => undefined);
        if (categoryBId) {
            await prisma.category.deleteMany({
                where: { id: categoryBId },
            }).catch(() => undefined);
        }
        await prisma.$executeRawUnsafe(
            `DELETE FROM "SystemSetting" WHERE "tenantId"=$1::uuid`,
            tenantBId,
        ).catch(() => undefined);
        await prisma.$executeRawUnsafe(
            `DELETE FROM "AuditLog" WHERE "tenantId"=$1::uuid`,
            tenantBId,
        ).catch(() => undefined);
        await prisma.$executeRawUnsafe(
            `DELETE FROM "UserActivityLog" WHERE "tenantId"=$1::uuid`,
            tenantBId,
        ).catch(() => undefined);
        await prisma.tenantMembership.deleteMany({
            where: { id: { in: [membership1Id, membership2Id] } },
        }).catch(() => undefined);
        await prisma.tenant.deleteMany({
            where: { id: tenantBId },
        }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
});

describe("MIG-007: conciliación de pedidos, reservas y picking", () => {
    it("preserva conteos, estados, importes y la cuarentena histórica", async (ctx) => {
        if (!dbReady || !reconciled) return ctx.skip();

        const summary = await inspectOrderPickingMigration();
        expect(summary.counts).toEqual({
            orders: 42,
            orderItems: 106,
            reservations: 161,
            pickingSessions: 14,
            pickingItems: 14,
            sharedResponsibilities: 0,
            responsibilityRequests: 0,
            contributions: 1,
            unpickRequests: 0,
            orderItemDetails: 99,
        });
        expect(summary.totals.orderTotal).toBe("4750.48");
        expect(summary.totals.itemQuantity).toBe(265);
        expect(summary.totals.itemReserved).toBe(235);
        expect(summary.totals.itemPicked).toBe(121);
        expect(summary.totals.itemShortage).toBe(12);
        expect(summary.removedItems).toEqual({
            count: 4,
            withReason: 4,
            withNote: 0,
            withResponsible: 4,
            withResponsibleName: 4,
        });
        expect(summary.crossTenantReferences).toBe(0);
        expect(summary.tenantConstraintCount).toBe(38);
        expect(summary.invalidPickingRows).toEqual([{
            id: 8,
            orderId: 17,
            quantity: 13,
            pickedQuantity: 21,
            excess: 8,
        }]);
        expect(summary.pickingGuardValidated).toBe(closureApplied);
    });

    it("conserva la fila en cuarentena y bloquea nuevos excesos", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const historical = await inTenant(
            LEGACY_TENANT_ID,
            () => prisma.pickingItem.findUnique({ where: { id: 8 } }),
        );
        if (closureApplied) {
            expect(historical).toBeNull();
            const archived = await prisma.$queryRawUnsafe<Array<{
                quantity: number;
                pickedQuantity: number;
            }>>(
                `SELECT
                    ("originalData"->>'quantity')::int AS quantity,
                    ("originalData"->>'pickedQuantity')::int
                        AS "pickedQuantity"
                 FROM "TenantMigrationQuarantine"
                 WHERE "storyId"='MIG-011'
                   AND "sourceTable"='PickingItem'
                   AND "sourceKey"='8'`,
            );
            expect(archived).toEqual([{
                quantity: 13,
                pickedQuantity: 21,
            }]);
        } else {
            expect(historical?.quantity).toBe(13);
            expect(historical?.pickedQuantity).toBe(21);
        }

        const order = await inTenant(
            tenantBId,
            () => prisma.order.create({
                data: {
                    code: `MIG007-GUARD-${tag}`,
                    status: "CONFIRMED",
                    sourceStoreId: sourceStoreBId,
                    sellerUserId: user1Id,
                },
            }),
        );
        orderIds.push(order.id);
        const session = await inTenant(
            tenantBId,
            () => prisma.pickingSession.create({
                data: {
                    orderId: order.id,
                    status: "IN_PROGRESS",
                    assignedUserId: user1Id,
                },
            }),
        );
        await expect(inTenant(
            tenantBId,
            () => prisma.pickingItem.create({
                data: {
                    sessionId: session.id,
                    variantId: variantBId,
                    quantity: 1,
                    pickedQuantity: 2,
                },
            }),
        )).rejects.toThrow(/PickingItem_quantity_bounds_check|constraint/i);
        expect(await inTenant(
            tenantBId,
            () => prisma.pickingItem.count({
                where: { sessionId: session.id },
            }),
        )).toBe(0);
    });

    it("reutiliza código e idempotencyKey entre empresas, no dentro de una", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const order = await inTenant(
            tenantBId,
            () => prisma.order.create({
                data: {
                    code: legacyCode,
                    idempotencyKey: legacyIdempotencyKey,
                    sourceStoreId: sourceStoreBId,
                    sellerUserId: user1Id,
                },
            }),
        );
        orderIds.push(order.id);
        expect(order.code).toBe(legacyCode);
        expect(order.idempotencyKey).toBe(legacyIdempotencyKey);

        await expect(inTenant(
            tenantBId,
            () => prisma.order.create({
                data: {
                    code: legacyCode,
                    idempotencyKey: `MIG007-OTHER-${tag}`,
                    sourceStoreId: sourceStoreBId,
                },
            }),
        )).rejects.toThrow(/unique|constraint/i);
        await expect(inTenant(
            tenantBId,
            () => prisma.order.create({
                data: {
                    code: `MIG007-OTHER-${tag}`,
                    idempotencyKey: legacyIdempotencyKey,
                    sourceStoreId: sourceStoreBId,
                },
            }),
        )).rejects.toThrow(/unique|constraint/i);

        const legacyStore = await inTenant(
            LEGACY_TENANT_ID,
            () => prisma.store.findFirstOrThrow(),
        );
        await expect(inTenant(
            tenantBId,
            () => prisma.order.create({
                data: {
                    code: `MIG007-CROSS-${tag}`,
                    sourceStoreId: legacyStore.id,
                },
            }),
        )).rejects.toThrow(/tenant|constraint/i);
    });

    it("reanuda PENDING, PREPARING, READY y entrega sin doble reserva", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const dto = createDto(3, `MIG007-LIFE-${tag}`);
        const first = await inTenant(
            tenantBId,
            () => new OrderService().createOrder(dto),
        );
        orderIds.push(first.id);
        expect(first.status).toBe("PENDING");
        const replay = await inTenant(
            tenantBId,
            () => new OrderService().createOrder(dto),
        );
        expect(replay.id).toBe(first.id);
        expect(await inTenant(
            tenantBId,
            () => prisma.reservation.count({
                where: { orderId: first.id },
            }),
        )).toBe(1);
        expect((await inTenant(
            tenantBId,
            () => prisma.inventory.findUnique({
                where: { id: sourceInventoryBId },
            }),
        ))?.reservedStock).toBe(3);

        await inTenant(
            tenantBId,
            () => new OrderService().updateOrderStatus(
                first.id,
                statusDto(OrderStatusEnum.CONFIRMED),
                user1Id,
            ),
        );
        const picking = await inTenant(
            tenantBId,
            () => new OrderService().startOrderPicking(first.id, user1Id),
        );
        expect((await inTenant(
            tenantBId,
            () => prisma.order.findUnique({ where: { id: first.id } }),
        ))?.status).toBe("PREPARING");
        expect(picking.pickingSession?.status).toBe("IN_PROGRESS");

        const orderItem = await inTenant(
            tenantBId,
            () => prisma.orderItem.findFirstOrThrow({
                where: { orderId: first.id },
            }),
        );
        await inTenant(
            tenantBId,
            () => new OrderService().updatePickingOrderItem(
                first.id,
                orderItem.id,
                3,
                user1Id,
            ),
        );
        const ready = await inTenant(
            tenantBId,
            () => new OrderService().completeOrderPicking(
                first.id,
                user1Id,
            ),
        );
        expect(ready.status).toBe("READY");
        const delivered = await inTenant(
            tenantBId,
            () => new OrderService().updateOrderStatus(
                first.id,
                statusDto(OrderStatusEnum.DELIVERED),
                user1Id,
            ),
        );
        expect(delivered.status).toBe("DELIVERED");
        const [inventory, reservation, session] = await inTenant(
            tenantBId,
            () => Promise.all([
                prisma.inventory.findUnique({
                    where: { id: sourceInventoryBId },
                }),
                prisma.reservation.findFirst({
                    where: { orderId: first.id },
                }),
                prisma.pickingSession.findUnique({
                    where: { orderId: first.id },
                }),
            ]),
        );
        expect(inventory?.stock).toBe(47);
        expect(inventory?.reservedStock).toBe(0);
        expect(reservation?.status).toBe("COMPLETED");
        expect(session?.status).toBe("COMPLETED");
    });

    it("reanuda WAITING_TRANSFER y la cancela liberando su reserva", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const order = await inTenant(
            tenantBId,
            () => new OrderService().createOrder(
                createDto(4, `MIG007-REMOTE-${tag}`, remoteStoreBId),
            ),
        );
        orderIds.push(order.id);
        expect(order.status).toBe("WAITING_TRANSFER");
        expect((await inTenant(
            tenantBId,
            () => prisma.inventory.findUnique({
                where: { id: remoteInventoryBId },
            }),
        ))?.reservedStock).toBe(4);

        const cancelled = await inTenant(
            tenantBId,
            () => new OrderService().updateOrderStatus(
                order.id,
                statusDto(OrderStatusEnum.CANCELLED),
                user1Id,
            ),
        );
        expect(cancelled.status).toBe("CANCELLED");
        expect((await inTenant(
            tenantBId,
            () => prisma.inventory.findUnique({
                where: { id: remoteInventoryBId },
            }),
        ))?.reservedStock).toBe(0);
        expect((await inTenant(
            tenantBId,
            () => prisma.reservation.findFirst({
                where: { orderId: order.id },
            }),
        ))?.status).toBe("RELEASED");
    });

    it("reanuda RETURN_PENDING y cierra la devolución operativa", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const order = await inTenant(
            tenantBId,
            () => new OrderService().createOrder(
                createDto(2, `MIG007-RETURN-${tag}`),
            ),
        );
        orderIds.push(order.id);
        await inTenant(
            tenantBId,
            () => new OrderService().updateOrderStatus(
                order.id,
                statusDto(OrderStatusEnum.CONFIRMED),
                user1Id,
            ),
        );
        await inTenant(
            tenantBId,
            () => new OrderService().startOrderPicking(order.id, user1Id),
        );
        const item = await inTenant(
            tenantBId,
            () => prisma.orderItem.findFirstOrThrow({
                where: { orderId: order.id },
            }),
        );
        await inTenant(
            tenantBId,
            () => new OrderService().updatePickingOrderItem(
                order.id,
                item.id,
                1,
                user1Id,
            ),
        );
        const pendingReturn = await inTenant(
            tenantBId,
            () => new OrderService().updateOrderStatus(
                order.id,
                statusDto(OrderStatusEnum.CANCELLED),
                user1Id,
            ),
        );
        expect(pendingReturn.status).toBe("RETURN_PENDING");
        const closed = await inTenant(
            tenantBId,
            () => new OrderService().updateOrderStatus(
                order.id,
                statusDto(OrderStatusEnum.CANCELLED),
                user1Id,
            ),
        );
        expect(closed.status).toBe("CANCELLED");
        expect(closed.returnedAt).toBeTruthy();
    });

    it("no duplica solicitudes ni responsabilidades compartidas", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const order = await inTenant(
            tenantBId,
            () => new OrderService().createOrder(
                createDto(1, `MIG007-RESP-${tag}`),
            ),
        );
        orderIds.push(order.id);
        await inTenant(
            tenantBId,
            () => new OrderService().updateOrderStatus(
                order.id,
                statusDto(OrderStatusEnum.CONFIRMED),
                user1Id,
            ),
        );
        const [requestError, requestDto] =
            RequestPickingResponsibilityDto.create({
                mode: "SHARED",
                note: `MIG007 ${tag}`,
            });
        expect(requestError).toBeUndefined();
        await inTenant(
            tenantBId,
            () => new OrderService().requestPickingResponsibility(
                order.id,
                requestDto!,
                user2Id,
            ),
        );
        await expect(inTenant(
            tenantBId,
            () => new OrderService().requestPickingResponsibility(
                order.id,
                requestDto!,
                user2Id,
            ),
        )).rejects.toThrow(/solicitud pendiente/i);
        const pendingCount = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
            `SELECT COUNT(*)::int AS count
             FROM "PickingResponsibilityRequest"
             WHERE "tenantId"=$1::uuid
               AND "orderId"=$2
               AND "status"='PENDING'`,
            tenantBId,
            order.id,
        );
        expect(pendingCount[0]?.count).toBe(1);

        const [delegateError, delegateDto] =
            DelegatePickingResponsibilityDto.create({
                userId: user2Id,
                mode: "SHARED",
                note: `MIG007 ${tag}`,
            });
        expect(delegateError).toBeUndefined();
        await inTenant(
            tenantBId,
            () => new OrderService().delegatePickingResponsibility(
                order.id,
                delegateDto!,
                user1Id,
            ),
        );
        await inTenant(
            tenantBId,
            () => new OrderService().delegatePickingResponsibility(
                order.id,
                delegateDto!,
                user1Id,
            ),
        );
        const sharedCount = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
            `SELECT COUNT(*)::int AS count
             FROM "PickingSharedResponsibility"
             WHERE "tenantId"=$1::uuid
               AND "orderId"=$2
               AND "userId"=$3`,
            tenantBId,
            order.id,
            user2Id,
        );
        expect(sharedCount[0]?.count).toBe(1);
    });

    it("la reejecución conserva huellas y no duplica filas", async (ctx) => {
        if (!dbReady || !reconciled) return ctx.skip();

        const before = await inspectOrderPickingMigration();
        const tenantRowsBefore = await inTenant(
            tenantBId,
            () => Promise.all([
                prisma.order.count(),
                prisma.orderItem.count(),
                prisma.reservation.count(),
                prisma.pickingSession.count(),
                prisma.pickingItem.count(),
            ]),
        );
        await reconcileOrderPickingMigration();
        await reconcileOrderPickingMigration();
        const after = await inspectOrderPickingMigration();
        const tenantRowsAfter = await inTenant(
            tenantBId,
            () => Promise.all([
                prisma.order.count(),
                prisma.orderItem.count(),
                prisma.reservation.count(),
                prisma.pickingSession.count(),
                prisma.pickingItem.count(),
            ]),
        );

        expect(after.fingerprints).toEqual(before.fingerprints);
        expect(after.orderIds).toEqual(before.orderIds);
        expect(tenantRowsAfter).toEqual(tenantRowsBefore);
    });
});
