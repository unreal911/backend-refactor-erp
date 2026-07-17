import { prisma } from "../../data/prisma";
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
