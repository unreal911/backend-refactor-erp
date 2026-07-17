import { prisma } from "../../data/prisma";
import { Prisma } from "@prisma/client";
import {
    PickingItemContributionRow,
    PickingOrderItemDetailRow,
    PickingResponsibilityRequestRow,
    PickingSharedResponsibilityRow,
    PickingUnpickRequestRow,
} from "./order.types";

// Acceso a datos raw-SQL de picking (responsables compartidos, solicitudes,
// contribuciones, detalle por item) + mapeadores row->Map. Funciones puras de
// repositorio: reciben `dbClient` (prisma o tx) y no dependen de estado de OrderService.

export async function listPickingSharedResponsibilityRows(orderId: number, dbClient: any = prisma): Promise<PickingSharedResponsibilityRow[]> {
    const rows = await dbClient.$queryRaw(
        Prisma.sql`
            SELECT
                psr."id",
                psr."orderId",
                psr."userId",
                psr."assignedByUserId",
                psr."source",
                psr."note",
                psr."createdAt",
                psr."updatedAt",
                u."firstName" AS "userFirstName",
                u."lastName" AS "userLastName",
                u."email" AS "userEmail",
                assigner."firstName" AS "assignedByFirstName",
                assigner."lastName" AS "assignedByLastName",
                assigner."email" AS "assignedByEmail"
            FROM "PickingSharedResponsibility" psr
            INNER JOIN "User" u ON u."id" = psr."userId"
            LEFT JOIN "User" assigner ON assigner."id" = psr."assignedByUserId"
            WHERE psr."orderId" = ${orderId}
              AND psr."isActive" = true
            ORDER BY psr."createdAt" ASC
        `,
    );
    return rows as PickingSharedResponsibilityRow[];
}

export async function listPickingResponsibilityRequestRows(orderId: number, dbClient: any = prisma): Promise<PickingResponsibilityRequestRow[]> {
    const rows = await dbClient.$queryRaw(
        Prisma.sql`
            SELECT
                prr."id",
                prr."orderId",
                prr."requesterUserId",
                prr."mode",
                prr."status",
                prr."note",
                prr."resolvedByUserId",
                prr."resolvedAt",
                prr."createdAt",
                prr."updatedAt",
                requester."firstName" AS "requesterFirstName",
                requester."lastName" AS "requesterLastName",
                requester."email" AS "requesterEmail",
                resolver."firstName" AS "resolvedByFirstName",
                resolver."lastName" AS "resolvedByLastName",
                resolver."email" AS "resolvedByEmail"
            FROM "PickingResponsibilityRequest" prr
            INNER JOIN "User" requester ON requester."id" = prr."requesterUserId"
            LEFT JOIN "User" resolver ON resolver."id" = prr."resolvedByUserId"
            WHERE prr."orderId" = ${orderId}
            ORDER BY prr."createdAt" DESC
        `,
    );
    return rows as PickingResponsibilityRequestRow[];
}

export async function isActiveSharedResponsible(orderId: number, userId: number, dbClient: any = prisma): Promise<boolean> {
    const rows = await dbClient.$queryRaw(
        Prisma.sql`
            SELECT "id"
            FROM "PickingSharedResponsibility"
            WHERE "orderId" = ${orderId}
              AND "userId" = ${userId}
              AND "isActive" = true
            LIMIT 1
        `,
    ) as Array<{ id: number }>;
    return rows.length > 0;
}

export async function upsertSharedPickingResponsibility(
    orderId: number,
    userId: number,
    assignedByUserId: number,
    source: 'DELEGATION' | 'REQUEST_APPROVAL',
    note?: string,
    dbClient: any = prisma,
): Promise<void> {
    const existingRows = await dbClient.$queryRaw(
        Prisma.sql`
            SELECT "id"
            FROM "PickingSharedResponsibility"
            WHERE "orderId" = ${orderId}
              AND "userId" = ${userId}
            LIMIT 1
        `,
    ) as Array<{ id: number }>;

    if (existingRows.length > 0) {
        await dbClient.$executeRaw(
            Prisma.sql`
                UPDATE "PickingSharedResponsibility"
                SET "isActive" = true,
                    "assignedByUserId" = ${assignedByUserId},
                    "source" = ${source},
                    "note" = ${note ?? null},
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE "id" = ${existingRows[0]!.id}
            `,
        );
        return;
    }

    await dbClient.$executeRaw(
        Prisma.sql`
            INSERT INTO "PickingSharedResponsibility" (
                "orderId",
                "userId",
                "assignedByUserId",
                "source",
                "note",
                "isActive"
            )
            VALUES (
                ${orderId},
                ${userId},
                ${assignedByUserId},
                ${source},
                ${note ?? null},
                true
            )
        `,
    );
}

export async function listPickingItemContributionRows(orderId: number, dbClient: any = prisma): Promise<PickingItemContributionRow[]> {
    const rows = await dbClient.$queryRaw(
        Prisma.sql`
            SELECT
                pic."id",
                pic."orderId",
                pic."pickingItemId",
                pic."userId",
                pic."quantity",
                pic."createdAt",
                pic."updatedAt",
                u."firstName" AS "userFirstName",
                u."lastName" AS "userLastName",
                u."email" AS "userEmail"
            FROM "PickingItemContribution" pic
            INNER JOIN "User" u ON u."id" = pic."userId"
            WHERE pic."orderId" = ${orderId}
              AND pic."quantity" > 0
            ORDER BY pic."pickingItemId" ASC, pic."createdAt" ASC
        `,
    );
    return rows as PickingItemContributionRow[];
}

export async function listPickingUnpickRequestRows(orderId: number, dbClient: any = prisma): Promise<PickingUnpickRequestRow[]> {
    const rows = await dbClient.$queryRaw(
        Prisma.sql`
            SELECT
                pur."id",
                pur."orderId",
                pur."pickingItemId",
                pur."requesterUserId",
                pur."quantity",
                pur."status",
                pur."note",
                pur."resolvedByUserId",
                pur."resolvedAt",
                pur."createdAt",
                pur."updatedAt",
                requester."firstName" AS "requesterFirstName",
                requester."lastName" AS "requesterLastName",
                requester."email" AS "requesterEmail",
                resolver."firstName" AS "resolvedByFirstName",
                resolver."lastName" AS "resolvedByLastName",
                resolver."email" AS "resolvedByEmail"
            FROM "PickingUnpickRequest" pur
            INNER JOIN "User" requester ON requester."id" = pur."requesterUserId"
            LEFT JOIN "User" resolver ON resolver."id" = pur."resolvedByUserId"
            WHERE pur."orderId" = ${orderId}
            ORDER BY pur."createdAt" DESC
        `,
    );
    return rows as PickingUnpickRequestRow[];
}

export async function listPickingOrderItemDetailRows(orderId: number, dbClient: any = prisma): Promise<PickingOrderItemDetailRow[]> {
    const rows = await dbClient.$queryRaw(
        Prisma.sql`
            SELECT
                "id",
                "orderId",
                "orderItemId",
                "pickingItemId",
                "variantId",
                "pickedQuantity",
                "createdAt",
                "updatedAt"
            FROM "PickingOrderItemDetail"
            WHERE "orderId" = ${orderId}
            ORDER BY "orderItemId" ASC
        `,
    );
    return rows as PickingOrderItemDetailRow[];
}

export async function recalculatePickingItemPickedQuantityFromDetails(
    orderId: number,
    pickingItemId: number,
    dbClient: any = prisma,
): Promise<number> {
    const rows = await dbClient.$queryRaw(
        Prisma.sql`
            SELECT COALESCE(SUM("pickedQuantity"), 0) AS "pickedQuantity"
            FROM "PickingOrderItemDetail"
            WHERE "orderId" = ${orderId}
              AND "pickingItemId" = ${pickingItemId}
        `,
    ) as Array<{ pickedQuantity: number }>;

    const nextPickedQuantity = Math.max(0, Number(rows?.[0]?.pickedQuantity || 0));
    await dbClient.pickingItem.update({
        where: { id: pickingItemId },
        data: { pickedQuantity: nextPickedQuantity },
    });

    return nextPickedQuantity;
}

export function buildPickingOrderItemDetailMap(rows: PickingOrderItemDetailRow[]): Map<number, PickingOrderItemDetailRow> {
    const map = new Map<number, PickingOrderItemDetailRow>();

    for (const row of rows) {
        const orderItemId = Number(row?.orderItemId || 0);
        if (!Number.isInteger(orderItemId) || orderItemId < 1) continue;
        map.set(orderItemId, row);
    }

    return map;
}

export function buildPickingItemContributionMap(rows: PickingItemContributionRow[]) {
    const map = new Map<number, Array<{
        id: number;
        user: { id: number; firstName: string; lastName: string; email: string };
        quantity: number;
        createdAt: Date;
        updatedAt: Date;
    }>>();

    for (const row of rows) {
        const pickingItemId = Number(row.pickingItemId || 0);
        if (!Number.isInteger(pickingItemId) || pickingItemId < 1) continue;

        const entry = {
            id: Number(row.id),
            user: {
                id: Number(row.userId),
                firstName: String(row.userFirstName || ''),
                lastName: String(row.userLastName || ''),
                email: String(row.userEmail || ''),
            },
            quantity: Math.max(0, Number(row.quantity || 0)),
            createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
            updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
        };

        const bucket = map.get(pickingItemId) || [];
        bucket.push(entry);
        map.set(pickingItemId, bucket);
    }

    return map;
}

export function buildPendingUnpickRequestMap(rows: PickingUnpickRequestRow[]) {
    const map = new Map<number, Array<{
        id: number;
        pickingItemId: number;
        requester: { id: number; firstName: string; lastName: string; email: string };
        quantity: number;
        note: string | null;
        createdAt: Date;
    }>>();

    for (const row of rows) {
        const status = String(row.status || '').toUpperCase();
        if (status !== 'PENDING') continue;

        const pickingItemId = Number(row.pickingItemId || 0);
        if (!Number.isInteger(pickingItemId) || pickingItemId < 1) continue;

        const entry = {
            id: Number(row.id),
            pickingItemId,
            requester: {
                id: Number(row.requesterUserId),
                firstName: String(row.requesterFirstName || ''),
                lastName: String(row.requesterLastName || ''),
                email: String(row.requesterEmail || ''),
            },
            quantity: Math.max(0, Number(row.quantity || 0)),
            note: row.note || null,
            createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        };

        const bucket = map.get(pickingItemId) || [];
        bucket.push(entry);
        map.set(pickingItemId, bucket);
    }

    return map;
}

export async function getPickingItemUserContribution(
    orderId: number,
    pickingItemId: number,
    userId: number,
    dbClient: any = prisma,
): Promise<number> {
    const rows = await dbClient.$queryRaw(
        Prisma.sql`
            SELECT "quantity"
            FROM "PickingItemContribution"
            WHERE "orderId" = ${orderId}
              AND "pickingItemId" = ${pickingItemId}
              AND "userId" = ${userId}
            LIMIT 1
        `,
    ) as Array<{ quantity: number }>;

    return Math.max(0, Number(rows?.[0]?.quantity || 0));
}

export async function updatePickingItemUserContribution(
    orderId: number,
    pickingItemId: number,
    userId: number,
    deltaQuantity: number,
    dbClient: any = prisma,
): Promise<number> {
    const normalizedDelta = Number(deltaQuantity);
    if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
        return getPickingItemUserContribution(orderId, pickingItemId, userId, dbClient);
    }

    const existingRows = await dbClient.$queryRaw(
        Prisma.sql`
            SELECT "id", "quantity"
            FROM "PickingItemContribution"
            WHERE "orderId" = ${orderId}
              AND "pickingItemId" = ${pickingItemId}
              AND "userId" = ${userId}
            LIMIT 1
        `,
    ) as Array<{ id: number; quantity: number }>;

    if (!existingRows.length) {
        const initialQuantity = Math.max(0, Math.round(normalizedDelta));
        if (initialQuantity <= 0) {
            return 0;
        }
        await dbClient.$executeRaw(
            Prisma.sql`
                INSERT INTO "PickingItemContribution" (
                    "orderId",
                    "pickingItemId",
                    "userId",
                    "quantity"
                )
                VALUES (
                    ${orderId},
                    ${pickingItemId},
                    ${userId},
                    ${initialQuantity}
                )
            `,
        );
        return initialQuantity;
    }

    const currentQuantity = Math.max(0, Number(existingRows[0]!.quantity || 0));
    const nextQuantity = Math.max(0, currentQuantity + Math.round(normalizedDelta));
    await dbClient.$executeRaw(
        Prisma.sql`
            UPDATE "PickingItemContribution"
            SET "quantity" = ${nextQuantity},
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${existingRows[0]!.id}
        `,
    );

    return nextQuantity;
}
