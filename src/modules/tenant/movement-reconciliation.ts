import { createHash } from "node:crypto";
import {
    InventoryMovementType,
    Prisma,
    TenantMigrationStatus,
} from "@prisma/client";
import { prisma } from "../../data/prisma";
import { LEGACY_TENANT_ID } from "./tenant-data-context";

const LEGACY_MOVEMENT_BASELINE = {
    movements: 387,
    transfers: 0,
    transferItems: 0,
    quantity: 1106,
    previousStock: 36288,
    newStock: 36446,
    discontinuities: 36,
    absoluteGap: 126,
    netGap: 0,
} as const;

type SealedMovementIds = {
    movementIds: number[];
    transferIds: number[];
    transferItemIds: number[];
};

type MovementGroup = {
    type: InventoryMovementType;
    count: number;
    quantity: number;
    stockDelta: number;
};

type LocationGroup = {
    storeId: number;
    inventoryId: number;
    count: number;
    quantity: number;
    stockDelta: number;
};

type ChainDifference = {
    inventoryId: number;
    count: number;
    absoluteGap: number;
    netGap: number;
};

export type MovementReconciliationSummary = SealedMovementIds & {
    movementCount: number;
    transferCount: number;
    transferItemCount: number;
    quantity: number;
    previousStock: number;
    newStock: number;
    movementGroups: MovementGroup[];
    locationGroups: LocationGroup[];
    discontinuityCount: number;
    absoluteGap: number;
    netGap: number;
    chainDifferences: ChainDifference[];
    finalBalanceDifferences: number;
    arithmeticViolations: number;
    crossTenantReferences: number;
    approvedDifferences: Array<{
        code: "APPROVED_LEGACY_HISTORY_GAP";
        affectedRows: number;
        absoluteGap: number;
        netGap: number;
    }>;
    fingerprints: {
        movements: string;
        transfers: string;
        transferItems: string;
        groups: string;
        logicalHistory: string;
    };
};

function digest(value: unknown): string {
    return createHash("sha256")
        .update(JSON.stringify(value))
        .digest("hex");
}

function readSealedIds(details: Prisma.JsonValue | null): SealedMovementIds | null {
    if (!details || typeof details !== "object" || Array.isArray(details)) {
        return null;
    }
    const record = details as Record<string, unknown>;
    const parse = (key: string): number[] => Array.isArray(record[key])
        ? record[key].filter(
            (value): value is number =>
                Number.isInteger(value) && Number(value) > 0,
        )
        : [];
    const movementIds = parse("movementIds");
    if (movementIds.length === 0) return null;
    return {
        movementIds,
        transferIds: parse("transferIds"),
        transferItemIds: parse("transferItemIds"),
    };
}

function expectedStockDelta(
    type: InventoryMovementType,
    quantity: number,
): number {
    switch (type) {
        case InventoryMovementType.IN:
        case InventoryMovementType.TRANSFER_IN:
        case InventoryMovementType.ADJUSTMENT:
            return quantity;
        case InventoryMovementType.OUT:
        case InventoryMovementType.TRANSFER_OUT:
            return -quantity;
        case InventoryMovementType.RESERVED:
        case InventoryMovementType.UNRESERVED:
            return 0;
    }
}

export async function inspectMovementMigration(): Promise<MovementReconciliationSummary> {
    const checkpoint = await prisma.tenantMigrationCheckpoint.findUnique({
        where: {
            tenantId_storyId: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-006",
            },
        },
        select: { details: true },
    });
    const sealed = readSealedIds(checkpoint?.details ?? null);
    const [movements, transfers, transferItems] = await Promise.all([
        prisma.inventoryMovement.findMany({
            where: {
                tenantId: LEGACY_TENANT_ID,
                ...(sealed ? { id: { in: sealed.movementIds } } : {}),
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            include: {
                inventory: {
                    include: {
                        store: true,
                        variant: true,
                    },
                },
                responsibleUser: true,
                transfer: true,
                reservation: true,
            },
        }),
        prisma.stockTransfer.findMany({
            where: {
                tenantId: LEGACY_TENANT_ID,
                ...(sealed ? { id: { in: sealed.transferIds } } : {}),
            },
            orderBy: { id: "asc" },
        }),
        prisma.stockTransferItem.findMany({
            where: {
                tenantId: LEGACY_TENANT_ID,
                ...(sealed ? { id: { in: sealed.transferItemIds } } : {}),
            },
            orderBy: { id: "asc" },
            include: {
                transfer: true,
                variant: true,
            },
        }),
    ]);

    if (
        movements.length !== LEGACY_MOVEMENT_BASELINE.movements
        || transfers.length !== LEGACY_MOVEMENT_BASELINE.transfers
        || transferItems.length !== LEGACY_MOVEMENT_BASELINE.transferItems
    ) {
        throw new Error(
            `Conteos históricos inesperados: movimientos ${movements.length}/387, `
            + `transferencias ${transfers.length}/0, ítems ${transferItems.length}/0`,
        );
    }

    const quantity = movements.reduce(
        (sum, movement) => sum + movement.quantity,
        0,
    );
    const previousStock = movements.reduce(
        (sum, movement) => sum + movement.previousStock,
        0,
    );
    const newStock = movements.reduce(
        (sum, movement) => sum + movement.newStock,
        0,
    );
    if (
        quantity !== LEGACY_MOVEMENT_BASELINE.quantity
        || previousStock !== LEGACY_MOVEMENT_BASELINE.previousStock
        || newStock !== LEGACY_MOVEMENT_BASELINE.newStock
    ) {
        throw new Error(
            `Totales históricos inesperados: cantidad ${quantity}/1106, `
            + `anterior ${previousStock}/36288, nuevo ${newStock}/36446`,
        );
    }

    const arithmeticViolations = movements.filter((movement) =>
        movement.newStock - movement.previousStock
            !== expectedStockDelta(movement.type, movement.quantity)
    ).length;
    if (arithmeticViolations > 0) {
        throw new Error(
            `Existen ${arithmeticViolations} movimientos con aritmética inválida`,
        );
    }

    const crossTenantReferences = movements.filter((movement) =>
        movement.inventory.tenantId !== movement.tenantId
        || movement.inventory.store.tenantId !== movement.tenantId
        || movement.inventory.variant.tenantId !== movement.tenantId
        || (
            movement.responsibleUserId !== null
            && movement.responsibleUser === null
        )
        || (
            movement.transferId !== null
            && movement.transfer?.tenantId !== movement.tenantId
        )
        || (
            movement.reservationId !== null
            && movement.reservation?.tenantId !== movement.tenantId
        )
    ).length + transferItems.filter((item) =>
        item.transfer.tenantId !== item.tenantId
        || item.variant.tenantId !== item.tenantId
    ).length;
    if (crossTenantReferences > 0) {
        throw new Error(
            `Existen ${crossTenantReferences} referencias cruzadas o huérfanas`,
        );
    }

    const byType = new Map<InventoryMovementType, MovementGroup>();
    const byLocation = new Map<string, LocationGroup>();
    const byInventory = new Map<number, typeof movements>();
    for (const movement of movements) {
        const stockDelta = movement.newStock - movement.previousStock;
        const typeGroup = byType.get(movement.type) ?? {
            type: movement.type,
            count: 0,
            quantity: 0,
            stockDelta: 0,
        };
        typeGroup.count += 1;
        typeGroup.quantity += movement.quantity;
        typeGroup.stockDelta += stockDelta;
        byType.set(movement.type, typeGroup);

        const key = `${movement.inventory.storeId}:${movement.inventoryId}`;
        const locationGroup = byLocation.get(key) ?? {
            storeId: movement.inventory.storeId,
            inventoryId: movement.inventoryId,
            count: 0,
            quantity: 0,
            stockDelta: 0,
        };
        locationGroup.count += 1;
        locationGroup.quantity += movement.quantity;
        locationGroup.stockDelta += stockDelta;
        byLocation.set(key, locationGroup);

        const inventoryMovements = byInventory.get(movement.inventoryId) ?? [];
        inventoryMovements.push(movement);
        byInventory.set(movement.inventoryId, inventoryMovements);
    }

    const chainDifferences: ChainDifference[] = [];
    let discontinuityCount = 0;
    let absoluteGap = 0;
    let netGap = 0;
    let finalBalanceDifferences = 0;
    for (const [inventoryId, rows] of byInventory) {
        let count = 0;
        let inventoryAbsoluteGap = 0;
        let inventoryNetGap = 0;
        for (let index = 1; index < rows.length; index += 1) {
            const previous = rows[index - 1];
            const current = rows[index];
            if (!previous || !current) continue;
            const gap = current.previousStock - previous.newStock;
            if (gap === 0) continue;
            count += 1;
            inventoryAbsoluteGap += Math.abs(gap);
            inventoryNetGap += gap;
        }
        if (count > 0) {
            chainDifferences.push({
                inventoryId,
                count,
                absoluteGap: inventoryAbsoluteGap,
                netGap: inventoryNetGap,
            });
        }
        discontinuityCount += count;
        absoluteGap += inventoryAbsoluteGap;
        netGap += inventoryNetGap;
        const tail = rows.at(-1);
        if (tail && tail.newStock !== tail.inventory.stock) {
            finalBalanceDifferences += 1;
        }
    }
    if (
        discontinuityCount !== LEGACY_MOVEMENT_BASELINE.discontinuities
        || absoluteGap !== LEGACY_MOVEMENT_BASELINE.absoluteGap
        || netGap !== LEGACY_MOVEMENT_BASELINE.netGap
        || finalBalanceDifferences !== 0
    ) {
        throw new Error(
            `Diferencia histórica no aprobada: saltos ${discontinuityCount}/36, `
            + `brecha absoluta ${absoluteGap}/126, neta ${netGap}/0, `
            + `saldos finales ${finalBalanceDifferences}/0`,
        );
    }

    const movementGroups = [...byType.values()].sort(
        (left, right) => left.type.localeCompare(right.type),
    );
    const locationGroups = [...byLocation.values()].sort(
        (left, right) =>
            left.storeId - right.storeId
            || left.inventoryId - right.inventoryId,
    );
    const movementRows = movements.map((movement) => ({
        id: movement.id,
        tenantId: movement.tenantId,
        type: movement.type,
        quantity: movement.quantity,
        previousStock: movement.previousStock,
        newStock: movement.newStock,
        note: movement.note,
        createdAt: movement.createdAt.toISOString(),
        responsibleUserId: movement.responsibleUserId,
        inventoryId: movement.inventoryId,
        transferId: movement.transferId,
        reservationId: movement.reservationId,
    }));
    const transferRows = transfers.map((transfer) => ({
        id: transfer.id,
        tenantId: transfer.tenantId,
        code: transfer.code,
        status: transfer.status,
        note: transfer.note,
        createdAt: transfer.createdAt.toISOString(),
        updatedAt: transfer.updatedAt.toISOString(),
        createdById: transfer.createdById,
        receivedById: transfer.receivedById,
        fromStoreId: transfer.fromStoreId,
        toStoreId: transfer.toStoreId,
        orderId: transfer.orderId,
    }));
    const transferItemRows = transferItems.map((item) => ({
        id: item.id,
        tenantId: item.tenantId,
        quantity: item.quantity,
        createdAt: item.createdAt.toISOString(),
        transferId: item.transferId,
        variantId: item.variantId,
    }));

    return {
        movementIds: movements.map((movement) => movement.id),
        transferIds: transfers.map((transfer) => transfer.id),
        transferItemIds: transferItems.map((item) => item.id),
        movementCount: movements.length,
        transferCount: transfers.length,
        transferItemCount: transferItems.length,
        quantity,
        previousStock,
        newStock,
        movementGroups,
        locationGroups,
        discontinuityCount,
        absoluteGap,
        netGap,
        chainDifferences,
        finalBalanceDifferences,
        arithmeticViolations,
        crossTenantReferences,
        approvedDifferences: [{
            code: "APPROVED_LEGACY_HISTORY_GAP",
            affectedRows: discontinuityCount,
            absoluteGap,
            netGap,
        }],
        fingerprints: {
            movements: digest(movementRows),
            transfers: digest(transferRows),
            transferItems: digest(transferItemRows),
            groups: digest({ movementGroups, locationGroups }),
            logicalHistory: digest({
                movementRows,
                transferRows,
                transferItemRows,
            }),
        },
    };
}

export async function reconcileMovementMigration(): Promise<MovementReconciliationSummary> {
    const [checkpoint, inventoryCheckpoint] = await Promise.all([
        prisma.tenantMigrationCheckpoint.findUnique({
            where: {
                tenantId_storyId: {
                    tenantId: LEGACY_TENANT_ID,
                    storyId: "MIG-006",
                },
            },
        }),
        prisma.tenantMigrationCheckpoint.findUnique({
            where: {
                tenantId_storyId: {
                    tenantId: LEGACY_TENANT_ID,
                    storyId: "MIG-005",
                },
            },
        }),
    ]);
    if (!checkpoint) throw new Error("No existe el checkpoint MIG-006");
    if (inventoryCheckpoint?.status !== TenantMigrationStatus.COMPLETED) {
        throw new Error("MIG-005 debe estar COMPLETED antes de MIG-006");
    }

    await prisma.tenantMigrationCheckpoint.update({
        where: { id: checkpoint.id },
        data: {
            status: TenantMigrationStatus.RUNNING,
            startedAt: checkpoint.startedAt ?? new Date(),
            completedAt: null,
        },
    });
    try {
        const summary = await inspectMovementMigration();
        await prisma.tenantMigrationCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
                status: TenantMigrationStatus.COMPLETED,
                completedAt: new Date(),
                details: {
                    version: 1,
                    transformation: "IN_PLACE",
                    tenantId: LEGACY_TENANT_ID,
                    policy:
                        "docs/migration/movement-reconciliation-policy.md",
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
                    policy:
                        "docs/migration/movement-reconciliation-policy.md",
                    failure: message.slice(0, 500),
                },
            },
        }).catch(() => undefined);
        throw error;
    }
}
