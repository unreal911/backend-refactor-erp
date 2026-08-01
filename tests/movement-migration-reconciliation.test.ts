import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from "vitest";
import { prisma, runTenantDatabaseTransaction } from "../src/data/prisma";
import { CreateStockTransferDto } from "../src/domain/dtos/create-stock-transfer.dto";
import {
    inspectMovementMigration,
    reconcileMovementMigration,
} from "../src/modules/tenant/movement-reconciliation";
import { LEGACY_TENANT_ID } from "../src/modules/tenant/tenant-data-context";
import { InventoryService } from "../src/presentation/services/inventory.service";

const tag = Date.now().toString(36);
let dbReady = false;
let reconciled = false;
let userId = 0;
let tenantBId = "";
let tenantCId = "";
let membershipBId = "";
let categoryBId = 0;
let productBId = 0;
let variantBId = 0;
let originBId = 0;
let destinationBId = 0;
let originInventoryBId = 0;
const storeCIds: number[] = [];
const transferIds: number[] = [];

async function inTenant<T>(
    tenantId: string,
    callback: () => Promise<T>,
): Promise<T> {
    return runTenantDatabaseTransaction(tenantId, () => callback());
}

function transferDto(quantity: number): CreateStockTransferDto {
    const [error, dto] = CreateStockTransferDto.create({
        fromStoreId: originBId,
        toStoreId: destinationBId,
        items: [{ variantId: variantBId, quantity }],
        note: `MIG006 ${tag}`,
    });
    if (error || !dto) throw new Error(error ?? "DTO de transferencia inválido");
    return dto;
}

beforeAll(async () => {
    const [migration, checkpoint, membership] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
            `SELECT migration_name
             FROM "_prisma_migrations"
             WHERE migration_name = '20260729150000_tenant_scope_commerce'
               AND finished_at IS NOT NULL`,
        ).catch(() => []),
        prisma.tenantMigrationCheckpoint.findFirst({
            where: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-006",
                status: "COMPLETED",
            },
        }).catch(() => null),
        prisma.tenantMembership.findFirst({
            where: {
                tenantId: LEGACY_TENANT_ID,
                status: "ACTIVE",
            },
            select: { userId: true },
        }).catch(() => null),
    ]);
    dbReady = migration.length === 1 && Boolean(membership);
    const details = checkpoint?.details as {
        version?: unknown;
        movementIds?: unknown;
    } | null;
    reconciled = details?.version === 1 && Array.isArray(details.movementIds);
    if (!dbReady || !membership) return;
    userId = membership.userId;

    const [tenantB, tenantC] = await Promise.all([
        prisma.tenant.create({
            data: {
                slug: `mig006-b-${tag}`,
                name: `MIG006 B ${tag}`,
                status: "SUSPENDED",
            },
        }),
        prisma.tenant.create({
            data: {
                slug: `mig006-c-${tag}`,
                name: `MIG006 C ${tag}`,
                status: "SUSPENDED",
            },
        }),
    ]);
    tenantBId = tenantB.id;
    tenantCId = tenantC.id;
    const membershipB = await prisma.tenantMembership.create({
        data: {
            tenantId: tenantBId,
            userId,
            role: "ADMIN",
            status: "ACTIVE",
            activatedAt: new Date(),
        },
    });
    membershipBId = membershipB.id;

    await inTenant(tenantBId, async () => {
        const category = await prisma.category.create({
            data: { name: `MIG006 Category ${tag}` },
        });
        categoryBId = category.id;
        const product = await prisma.product.create({
            data: {
                name: `MIG006 Product ${tag}`,
                categoryId: category.id,
                variants: {
                    create: {
                        sku: `MIG006-SKU-${tag}`,
                        price: 30,
                        variantKey: "0-0",
                    },
                },
            },
            include: { variants: true },
        });
        productBId = product.id;
        variantBId = product.variants[0]!.id;
        const [origin, destination] = await Promise.all([
            prisma.store.create({
                data: {
                    name: `MIG006 Origin ${tag}`,
                    code: `MIG006-O-${tag}`,
                },
            }),
            prisma.store.create({
                data: {
                    name: `MIG006 Destination ${tag}`,
                    code: `MIG006-D-${tag}`,
                },
            }),
        ]);
        originBId = origin.id;
        destinationBId = destination.id;
        const inventory = await prisma.inventory.create({
            data: {
                storeId: origin.id,
                variantId: variantBId,
                stock: 20,
                reservedStock: 0,
            },
        });
        originInventoryBId = inventory.id;
    });

    await inTenant(tenantCId, async () => {
        const stores = await Promise.all([
            prisma.store.create({
                data: {
                    name: `MIG006 C1 ${tag}`,
                    code: `MIG006-C1-${tag}`,
                },
            }),
            prisma.store.create({
                data: {
                    name: `MIG006 C2 ${tag}`,
                    code: `MIG006-C2-${tag}`,
                },
            }),
        ]);
        storeCIds.push(...stores.map((store) => store.id));
    });
});

afterAll(async () => {
    if (tenantBId || tenantCId) {
        const tenantIds = [tenantBId, tenantCId].filter(Boolean);
        await prisma.inventoryMovement.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await prisma.stockTransferItem.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await prisma.stockTransfer.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await prisma.inventory.deleteMany({
            where: { tenantId: { in: tenantIds } },
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
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        if (categoryBId) {
            await prisma.category.deleteMany({
                where: { id: categoryBId },
            }).catch(() => undefined);
        }
        if (membershipBId) {
            await prisma.tenantMembership.deleteMany({
                where: { id: membershipBId },
            }).catch(() => undefined);
        }
        await prisma.tenant.deleteMany({
            where: { id: { in: tenantIds } },
        }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
});

describe("MIG-006: conciliación de movimientos y transferencias", () => {
    it("preserva el historial y registra la diferencia heredada aprobada", async (ctx) => {
        if (!dbReady || !reconciled) return ctx.skip();

        const summary = await inspectMovementMigration();
        expect(summary.movementCount).toBe(387);
        expect(summary.transferCount).toBe(0);
        expect(summary.transferItemCount).toBe(0);
        expect(summary.quantity).toBe(1106);
        expect(summary.previousStock).toBe(36288);
        expect(summary.newStock).toBe(36446);
        expect(summary.movementGroups).toEqual([
            { type: "ADJUSTMENT", count: 2, quantity: 14, stockDelta: 14 },
            { type: "IN", count: 12, quantity: 264, stockDelta: 264 },
            { type: "OUT", count: 59, quantity: 120, stockDelta: -120 },
            { type: "RESERVED", count: 160, quantity: 395, stockDelta: 0 },
            { type: "UNRESERVED", count: 154, quantity: 313, stockDelta: 0 },
        ]);
        expect(summary.discontinuityCount).toBe(36);
        expect(summary.absoluteGap).toBe(126);
        expect(summary.netGap).toBe(0);
        expect(summary.finalBalanceDifferences).toBe(0);
        expect(summary.arithmeticViolations).toBe(0);
        expect(summary.crossTenantReferences).toBe(0);
        expect(summary.approvedDifferences[0]?.code)
            .toBe("APPROVED_LEGACY_HISTORY_GAP");
    });

    it("permite el mismo código de transferencia entre tenants y bloquea cruces", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const code = `MIG006-SHARED-${tag}`;
        const transferB = await inTenant(tenantBId, () =>
            prisma.stockTransfer.create({
                data: {
                    code,
                    fromStoreId: originBId,
                    toStoreId: destinationBId,
                },
            }));
        transferIds.push(transferB.id);
        const transferC = await inTenant(tenantCId, () =>
            prisma.stockTransfer.create({
                data: {
                    code,
                    fromStoreId: storeCIds[0]!,
                    toStoreId: storeCIds[1]!,
                },
            }));
        transferIds.push(transferC.id);
        expect(transferB.code).toBe(transferC.code);

        await expect(inTenant(tenantBId, () =>
            prisma.stockTransfer.create({
                data: {
                    code,
                    fromStoreId: originBId,
                    toStoreId: destinationBId,
                },
            }))).rejects.toThrow(/unique|único|constraint/i);

        const legacyStore = await inTenant(
            LEGACY_TENANT_ID,
            () => prisma.store.findFirstOrThrow(),
        );
        await expect(inTenant(tenantBId, () =>
            prisma.stockTransfer.create({
                data: {
                    code: `MIG006-CROSS-${tag}`,
                    fromStoreId: legacyStore.id,
                    toStoreId: destinationBId,
                },
            }))).rejects.toThrow(/tenant|constraint/i);
    });

    it("crea, consulta y recibe una transferencia sin mezclar empresas", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const transfer = await inTenant(
            tenantBId,
            () => new InventoryService().createStockTransfer(
                transferDto(6),
                userId,
            ),
        );
        expect(transfer?.status).toBe("PENDING");
        transferIds.push(transfer!.id);

        const [sourceAfterDispatch, tenantBTransfers, legacyTransfers] =
            await Promise.all([
                inTenant(tenantBId, () => prisma.inventory.findUnique({
                    where: { id: originInventoryBId },
                })),
                inTenant(
                    tenantBId,
                    () => new InventoryService().listTransfers(),
                ),
                inTenant(
                    LEGACY_TENANT_ID,
                    () => new InventoryService().listTransfers(),
                ),
            ]);
        expect(sourceAfterDispatch?.stock).toBe(14);
        expect(tenantBTransfers.some((row) => row.id === transfer!.id)).toBe(true);
        expect(legacyTransfers.some((row) => row.id === transfer!.id)).toBe(false);

        const received = await inTenant(
            tenantBId,
            () => new InventoryService().receiveStockTransfer(
                transfer!.id,
                userId,
            ),
        );
        expect(received.transfer?.status).toBe("RECEIVED");
        const destination = await inTenant(
            tenantBId,
            () => prisma.inventory.findUnique({
                where: {
                    storeId_variantId: {
                        storeId: destinationBId,
                        variantId: variantBId,
                    },
                },
            }),
        );
        expect(destination?.stock).toBe(6);
        const movements = await inTenant(
            tenantBId,
            () => prisma.inventoryMovement.findMany({
                where: { transferId: transfer!.id },
                orderBy: { id: "asc" },
            }),
        );
        expect(movements.map((row) => row.type))
            .toEqual(["TRANSFER_OUT", "TRANSFER_IN"]);

        await expect(inTenant(
            tenantBId,
            () => new InventoryService().receiveStockTransfer(
                transfer!.id,
                userId,
            ),
        )).rejects.toThrow(/ya fue recibida/i);
        expect(await inTenant(
            tenantBId,
            () => prisma.inventoryMovement.count({
                where: { transferId: transfer!.id },
            }),
        )).toBe(2);
    });

    it("cancela una pendiente, repone el origen y no permite recibirla", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const transfer = await inTenant(
            tenantBId,
            () => new InventoryService().createStockTransfer(
                transferDto(4),
                userId,
            ),
        );
        transferIds.push(transfer!.id);
        expect((await inTenant(
            tenantBId,
            () => prisma.inventory.findUnique({
                where: { id: originInventoryBId },
            }),
        ))?.stock).toBe(10);

        const cancelled = await inTenant(
            tenantBId,
            () => new InventoryService().cancelStockTransfer(
                transfer!.id,
                userId,
            ),
        );
        expect(cancelled?.status).toBe("CANCELLED");
        expect((await inTenant(
            tenantBId,
            () => prisma.inventory.findUnique({
                where: { id: originInventoryBId },
            }),
        ))?.stock).toBe(14);
        const movements = await inTenant(
            tenantBId,
            () => prisma.inventoryMovement.findMany({
                where: { transferId: transfer!.id },
                orderBy: { id: "asc" },
            }),
        );
        expect(movements.map((row) => row.type))
            .toEqual(["TRANSFER_OUT", "ADJUSTMENT"]);
        expect(movements[1]?.newStock).toBe(14);

        await expect(inTenant(
            tenantBId,
            () => new InventoryService().cancelStockTransfer(
                transfer!.id,
                userId,
            ),
        )).rejects.toThrow(/ya fue cancelada/i);
        await expect(inTenant(
            tenantBId,
            () => new InventoryService().receiveStockTransfer(
                transfer!.id,
                userId,
            ),
        )).rejects.toThrow(/fue cancelada/i);
        expect(await inTenant(
            tenantBId,
            () => prisma.inventoryMovement.count({
                where: { transferId: transfer!.id },
            }),
        )).toBe(2);
    });

    it("serializa la carrera recibir/cancelar y conserva las unidades", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const transfer = await inTenant(
            tenantBId,
            () => new InventoryService().createStockTransfer(
                transferDto(2),
                userId,
            ),
        );
        transferIds.push(transfer!.id);
        const results = await Promise.allSettled([
            inTenant(
                tenantBId,
                () => new InventoryService().receiveStockTransfer(
                    transfer!.id,
                    userId,
                ),
            ),
            inTenant(
                tenantBId,
                () => new InventoryService().cancelStockTransfer(
                    transfer!.id,
                    userId,
                ),
            ),
        ]);
        expect(results.filter((result) => result.status === "fulfilled"))
            .toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected"))
            .toHaveLength(1);

        const [currentTransfer, balances] = await inTenant(
            tenantBId,
            () => Promise.all([
                prisma.stockTransfer.findUnique({
                    where: { id: transfer!.id },
                }),
                prisma.inventory.aggregate({ _sum: { stock: true } }),
            ]),
        );
        expect(["RECEIVED", "CANCELLED"]).toContain(currentTransfer?.status);
        expect(balances._sum.stock).toBe(20);
        expect(await inTenant(
            tenantBId,
            () => prisma.inventoryMovement.count({
                where: { transferId: transfer!.id },
            }),
        )).toBe(2);
    });

    it("la reejecución conserva huellas y no duplica filas operativas", async (ctx) => {
        if (!dbReady || !reconciled) return ctx.skip();

        const before = await inspectMovementMigration();
        const tenantRowsBefore = await inTenant(
            tenantBId,
            () => Promise.all([
                prisma.inventoryMovement.count(),
                prisma.stockTransfer.count(),
                prisma.stockTransferItem.count(),
            ]),
        );
        await reconcileMovementMigration();
        await reconcileMovementMigration();
        const after = await inspectMovementMigration();
        const tenantRowsAfter = await inTenant(
            tenantBId,
            () => Promise.all([
                prisma.inventoryMovement.count(),
                prisma.stockTransfer.count(),
                prisma.stockTransferItem.count(),
            ]),
        );

        expect(after.fingerprints).toEqual(before.fingerprints);
        expect(after.movementIds).toEqual(before.movementIds);
        expect(tenantRowsAfter).toEqual(tenantRowsBefore);
    });
});
