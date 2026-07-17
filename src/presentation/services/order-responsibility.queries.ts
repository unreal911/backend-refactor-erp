import { prisma } from "../../data/prisma";
import { Prisma } from "@prisma/client";
import { CustomError } from "../../domain/errors/custom.error";
import {
    PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY,
    RETURN_RESPONSIBILITY_MANAGEMENT_KEY,
} from "../../data/system-config-keys";
import { PickingResponsibilityContext } from "./order.types";
import {
    mapPickingResponsibilityRequestRows,
    mapPickingSharedResponsibilityRows,
    parseBooleanSetting,
} from "./order.helpers";
import { getSystemSettingValue } from "./order.queries";
import {
    isActiveSharedResponsible,
    listPickingResponsibilityRequestRows,
    listPickingSharedResponsibilityRows,
} from "./order-picking.queries";

/**
 * Consultas/guards del flujo de responsabilidad de picking y devolución.
 * Funciones puras sobre `dbClient` (extraídas del god object OrderService).
 */

export async function isReturnResponsibilityManagementEnabled(dbClient: any = prisma): Promise<boolean> {
    try {
        const setting = await getSystemSettingValue(RETURN_RESPONSIBILITY_MANAGEMENT_KEY, dbClient);
        return parseBooleanSetting(setting, true);
    } catch {
        return true;
    }
}

export async function isPickingResponsibilityFlowEnabled(dbClient: any = prisma): Promise<boolean> {
    try {
        const setting = await getSystemSettingValue(PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY, dbClient);
        return parseBooleanSetting(setting, false);
    } catch {
        return false;
    }
}

export async function buildPickingResponsibilityContext(
    orderId: number,
    primaryResponsibleUser: any | null,
    dbClient: any = prisma,
): Promise<PickingResponsibilityContext> {
    const enabled = await isPickingResponsibilityFlowEnabled(dbClient);
    const [sharedRows, requestRows] = await Promise.all([
        listPickingSharedResponsibilityRows(orderId, dbClient),
        listPickingResponsibilityRequestRows(orderId, dbClient),
    ]);

    const primaryResponsible = primaryResponsibleUser
        ? {
            id: Number(primaryResponsibleUser.id),
            firstName: String(primaryResponsibleUser.firstName || ''),
            lastName: String(primaryResponsibleUser.lastName || ''),
            email: String(primaryResponsibleUser.email || ''),
        }
        : null;

    return {
        enabled,
        primaryResponsible,
        sharedResponsibles: mapPickingSharedResponsibilityRows(sharedRows),
        pendingRequests: mapPickingResponsibilityRequestRows(requestRows),
    };
}

export async function canUserOperatePicking(
    orderId: number,
    actorUserId: number,
    primaryResponsibleUserId?: number | null,
    dbClient: any = prisma,
): Promise<boolean> {
    const flowEnabled = await isPickingResponsibilityFlowEnabled(dbClient);
    if (!flowEnabled) {
        return true;
    }

    if (Number(primaryResponsibleUserId || 0) === Number(actorUserId)) {
        return true;
    }

    return isActiveSharedResponsible(orderId, actorUserId, dbClient);
}

export async function ensurePrimaryPickerCanDelegate(
    orderId: number,
    actorUserId: number,
    orderDetailInclude: any,
    dbClient: any = prisma,
): Promise<any> {
    const order = await dbClient.order.findUnique({
        where: { id: orderId },
        include: orderDetailInclude,
    });

    if (!order) {
        throw CustomError.notFound(`El pedido con ID ${orderId} no existe`);
    }

    const flowEnabled = await isPickingResponsibilityFlowEnabled(dbClient);
    if (!flowEnabled) {
        return order;
    }

    const primaryUserId = Number(order.pickerUserId || 0);
    if (!primaryUserId) {
        throw CustomError.badRequest('La orden no tiene responsable principal de picking');
    }

    if (primaryUserId !== Number(actorUserId)) {
        throw CustomError.forbidden('Solo el responsable principal puede delegar picking');
    }

    return order;
}

// --- CRUD raw de solicitudes de responsabilidad (PickingResponsibilityRequest) ---

export interface ResponsibilityRequestRow {
    id: number;
    requesterUserId: number;
    mode: string;
    status: string;
}

export async function findPendingResponsibilityRequestId(
    orderId: number,
    requesterUserId: number,
    mode: string,
    dbClient: any = prisma,
): Promise<number | null> {
    const rows = await dbClient.$queryRaw(
        Prisma.sql`
            SELECT "id"
            FROM "PickingResponsibilityRequest"
            WHERE "orderId" = ${orderId}
              AND "requesterUserId" = ${requesterUserId}
              AND "status" = 'PENDING'
              AND "mode" = ${mode}
            LIMIT 1
        `,
    ) as Array<{ id: number }>;
    return rows?.[0]?.id ?? null;
}

export async function insertResponsibilityRequest(
    orderId: number,
    requesterUserId: number,
    mode: string,
    note: string | null | undefined,
    dbClient: any = prisma,
): Promise<void> {
    await dbClient.$executeRaw(
        Prisma.sql`
            INSERT INTO "PickingResponsibilityRequest" ("orderId", "requesterUserId", "mode", "status", "note")
            VALUES (${orderId}, ${requesterUserId}, ${mode}, 'PENDING', ${note ?? null})
        `,
    );
}

export async function getResponsibilityRequestById(
    orderId: number,
    requestId: number,
    dbClient: any = prisma,
): Promise<ResponsibilityRequestRow | null> {
    const rows = await dbClient.$queryRaw(
        Prisma.sql`
            SELECT "id", "requesterUserId", "mode", "status"
            FROM "PickingResponsibilityRequest"
            WHERE "id" = ${requestId}
              AND "orderId" = ${orderId}
            LIMIT 1
        `,
    ) as Array<ResponsibilityRequestRow>;
    return rows?.[0] ?? null;
}

// Aprueba TODAS las solicitudes PENDING de un solicitante en la orden (usado al
// delegar/transferir: la delegacion satisface la solicitud pendiente si existia).
export async function approveResponsibilityRequestsByRequester(
    orderId: number,
    requesterUserId: number,
    resolvedByUserId: number,
    dbClient: any = prisma,
): Promise<void> {
    await dbClient.$executeRaw(
        Prisma.sql`
            UPDATE "PickingResponsibilityRequest"
            SET "status" = 'APPROVED',
                "resolvedByUserId" = ${resolvedByUserId},
                "resolvedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "orderId" = ${orderId}
              AND "requesterUserId" = ${requesterUserId}
              AND "status" = 'PENDING'
        `,
    );
}

export async function resolveResponsibilityRequestById(
    requestId: number,
    status: 'APPROVED' | 'REJECTED',
    resolvedByUserId: number,
    dbClient: any = prisma,
): Promise<void> {
    await dbClient.$executeRaw(
        Prisma.sql`
            UPDATE "PickingResponsibilityRequest"
            SET "status" = ${status},
                "resolvedByUserId" = ${resolvedByUserId},
                "resolvedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${requestId}
        `,
    );
}

// Al cerrar un pedido (CANCELLED/DELIVERED): desactiva responsables compartidos y
// cancela solicitudes pendientes (responsabilidad y unpick). Corre dentro de la tx.
export async function cancelPickingArtifactsOnOrderClose(
    orderId: number,
    resolvedByUserId: number | null,
    tx: any,
): Promise<void> {
    await tx.$executeRaw(
        Prisma.sql`
            UPDATE "PickingSharedResponsibility"
            SET "isActive" = false,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "orderId" = ${orderId}
              AND "isActive" = true
        `,
    );
    await tx.$executeRaw(
        Prisma.sql`
            UPDATE "PickingResponsibilityRequest"
            SET "status" = 'CANCELLED',
                "resolvedByUserId" = ${resolvedByUserId},
                "resolvedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "orderId" = ${orderId}
              AND "status" = 'PENDING'
        `,
    );
    await tx.$executeRaw(
        Prisma.sql`
            UPDATE "PickingUnpickRequest"
            SET "status" = 'CANCELLED',
                "resolvedByUserId" = ${resolvedByUserId},
                "resolvedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "orderId" = ${orderId}
              AND "status" = 'PENDING'
        `,
    );
}
