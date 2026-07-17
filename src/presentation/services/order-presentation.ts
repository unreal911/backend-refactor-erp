import { OrderStatusEnum } from "../../domain/dtos/update-order-status.dto";
import {
    detectSalesChannel,
    mapPickingItemStatus,
    mapPublicOrderStatus,
    mapSimpleUser,
    sanitizeOrderVariantsForPresentation,
} from "./order.helpers";

// Presentación y "forma de orden": cálculo de cantidades por item/variante y
// armado de la respuesta de pedido para admin/picking. Funciones puras: operan
// sobre el objeto `order` ya cargado, sin acceso a BD ni estado de OrderService.

export function mapOrderItemStatusFromPicked(pickedQuantity: number, requestedQuantity: number): 'PENDING' | 'PARTIAL' | 'PICKED' {
    if (pickedQuantity <= 0) return 'PENDING';
    if (pickedQuantity >= requestedQuantity) return 'PICKED';
    return 'PARTIAL';
}

export function getOrderItemsForVariant(order: any, variantId: number): any[] {
    if (!order || !Array.isArray(order.items)) {
        return [];
    }

    return order.items
        .filter((item: any) => Number(item?.variantId) === Number(variantId))
        .sort((a: any, b: any) => Number(a?.id || 0) - Number(b?.id || 0));
}

export function getRequestedQuantityForVariant(order: any, variantId: number): number {
    return getOrderItemsForVariant(order, variantId)
        .reduce((sum: number, item: any) => sum + Math.max(0, Number(item?.quantity || 0)), 0);
}

export function allocateQuantityAcrossOrderItems(orderItems: any[], totalQuantity: number): Map<number, number> {
    const allocations = new Map<number, number>();
    let remaining = Math.max(0, Number(totalQuantity || 0));

    for (const item of orderItems) {
        const requestedQuantity = Math.max(0, Number(item?.quantity || 0));
        const orderItemId = Number(item?.id || 0);
        const allocatedQuantity = Math.max(0, Math.min(requestedQuantity, remaining));

        if (orderItemId > 0) {
            allocations.set(orderItemId, allocatedQuantity);
        }

        remaining = Math.max(0, remaining - allocatedQuantity);
        if (remaining <= 0) {
            // no-op: mantenemos el recorrido para asignar 0 explicito en las lineas restantes
        }
    }

    return allocations;
}

/**
 * Reservado por linea para la vista de picking. La VERDAD es `OrderItem.reserved`
 * (reserve/release lo mantienen atomico por item, y es lo que valida
 * `reserveRemoteStock`). Con variante compartida NO se debe repartir el total de
 * forma voraz: eso "adelantaba" la reserva a las primeras filas y pintaba las
 * ultimas como pendientes aunque estuvieran llenas (=> el error al pulsar +).
 * Solo si NO hay tracking por linea (todo 0 pero existen reservas legacy) se
 * cae al reparto voraz como respaldo.
 */
export function resolveReservedByOrderItem(variantOrderItems: any[], totalReservedForVariant: number): Map<number, number> {
    const sumPerItem = variantOrderItems.reduce(
        (sum: number, item: any) => sum + Math.max(0, Number(item?.reserved || 0)),
        0,
    );

    if (sumPerItem === 0 && Number(totalReservedForVariant || 0) > 0) {
        return allocateQuantityAcrossOrderItems(variantOrderItems, totalReservedForVariant);
    }

    const allocations = new Map<number, number>();
    for (const item of variantOrderItems) {
        const orderItemId = Number(item?.id || 0);
        if (orderItemId > 0) {
            allocations.set(orderItemId, Math.max(0, Number(item?.reserved || 0)));
        }
    }
    return allocations;
}

export function resolvePickedQuantity(orderItem: any, order?: any): number {
    const pickedFromOrderItem = Math.max(0, Number(orderItem?.picked || 0));
    const orderItemsForVariant = getOrderItemsForVariant(order, Number(orderItem?.variantId || 0));
    if (orderItemsForVariant.length > 1) {
        return pickedFromOrderItem;
    }

    if (pickedFromOrderItem > 0) {
        return pickedFromOrderItem;
    }

    const sessionItems = order?.pickingSession?.items || [];
    const pickedFromSession = sessionItems.find(
        (sessionItem: any) => Number(sessionItem.variantId) === Number(orderItem?.variantId),
    );
    return Number(pickedFromSession?.pickedQuantity || 0);
}

export function getReservedQuantityForVariant(order: any, variantId: number): number {
    if (!order || !Array.isArray(order.reservations)) {
        return 0;
    }

    return order.reservations
        .filter((reservation: any) =>
            Number(reservation?.variantId) === Number(variantId) &&
            (reservation.status === 'ACTIVE' || reservation.status === 'COMPLETED'))
        .reduce((sum: number, reservation: any) => sum + Math.max(0, Number(reservation.quantity || 0)), 0);
}

export function resolveMaxPickableQuantity(order: any, variantId: number, requestedQuantity: number): number {
    const safeRequested = Math.max(0, Number(requestedQuantity || 0));
    if (safeRequested <= 0) {
        return 0;
    }

    const reservedByVariant = getReservedQuantityForVariant(order, variantId);
    return Math.max(0, Math.min(safeRequested, reservedByVariant));
}

export function getOrderItemMaxPickableQuantity(order: any, orderItem: any): number {
    const requestedQuantity = Math.max(0, Number(orderItem?.quantity || 0));
    if (requestedQuantity <= 0) {
        return 0;
    }

    const reservedQuantity = Math.max(0, Number(orderItem?.reserved || 0));
    if (reservedQuantity > 0) {
        return Math.min(requestedQuantity, reservedQuantity);
    }

    const reservedByVariant = getReservedQuantityForVariant(order, Number(orderItem?.variantId || 0));
    if (reservedByVariant <= 0) {
        return 0;
    }

    return Math.min(requestedQuantity, reservedByVariant);
}

export function buildFallbackPickedAllocationByOrderItemId(order: any, sessionItems: any[]): Map<number, number> {
    const fallback = new Map<number, number>();
    const orderItems = Array.isArray(order?.items)
        ? [...order.items].sort((a: any, b: any) => Number(a?.id || 0) - Number(b?.id || 0))
        : [];
    const orderItemsByVariant = new Map<number, any[]>();

    for (const item of orderItems) {
        const variantId = Number(item?.variantId || 0);
        if (!Number.isInteger(variantId) || variantId < 1) continue;
        const bucket = orderItemsByVariant.get(variantId) || [];
        bucket.push(item);
        orderItemsByVariant.set(variantId, bucket);
    }

    for (const [variantId, variantOrderItems] of orderItemsByVariant.entries()) {
        const hasPersistedPicked = variantOrderItems.some((item: any) => Number(item?.picked || 0) > 0);

        if (hasPersistedPicked) {
            for (const item of variantOrderItems) {
                const orderItemId = Number(item?.id || 0);
                if (!Number.isInteger(orderItemId) || orderItemId < 1) continue;
                fallback.set(orderItemId, Math.max(0, Number(item?.picked || 0)));
            }
            continue;
        }

        const sessionItem = sessionItems.find((candidate: any) => Number(candidate?.variantId || 0) === variantId);
        const pickedFromSession = Math.max(0, Number(sessionItem?.pickedQuantity || 0));
        const pickedAllocations = allocateQuantityAcrossOrderItems(variantOrderItems, pickedFromSession);

        pickedAllocations.forEach((quantity, orderItemId) => {
            fallback.set(orderItemId, Math.max(0, Number(quantity || 0)));
        });
    }

    return fallback;
}

/**
 * Generar codigo unico para el pedido
 * Formato: ORD-{YYYYMMDD}-{RANDOM}
 */
export function generateOrderCode(): string {
    const now = new Date();
    const dateString = now.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `ORD-${dateString}-${random}`;
}

export function mapOrderWithPickingSummary(order: any) {
    const allItems = Array.isArray(order?.items) ? order.items : [];
    // Los items eliminados (soft-delete) NO forman parte del pedido operativo:
    // se excluyen de items/totales/picking y se exponen aparte en removedItems.
    const items = allItems.filter((item: any) => !item.removedAt);
    const totalRequested = items.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
    const totalPicked = items.reduce((sum: number, item: any) => {
        const pickedQuantity = resolvePickedQuantity(item, order);
        return sum + Math.min(Number(item.quantity || 0), pickedQuantity);
    }, 0);

    const progress = totalRequested > 0 ? Math.round((totalPicked / totalRequested) * 100) : 0;
    const mapItem = (item: any) => {
        const requestedQuantity = Number(item.quantity || 0);
        const reservedQuantity = Number(item.reserved || 0);
        const pendingStockQuantity = Math.max(0, requestedQuantity - reservedQuantity);
        const pickedQuantity = resolvePickedQuantity(item, order);
        const maxPickableQuantity = Math.max(0, Math.min(requestedQuantity, reservedQuantity));
        const pendingPickingQuantity = Math.max(0, requestedQuantity - pickedQuantity);
        const storedUnitPrice = Number(item.unitPrice || 0);
        const variantPrice = Number(item?.variant?.price || 0);
        const unitPrice = storedUnitPrice > 0 ? storedUnitPrice : Math.max(0, variantPrice);
        const storedSubtotal = Number(item.subtotal || 0);
        const subtotal = storedSubtotal > 0 ? storedSubtotal : requestedQuantity * unitPrice;

        return {
            ...item,
            unitPrice,
            subtotal,
            requestedQuantity,
            reservedQuantity,
            maxPickableQuantity,
            pendingStockQuantity,
            pickedQuantity,
            pendingQuantity: pendingPickingQuantity,
            pendingPickingQuantity,
            pickingStatus: mapPickingItemStatus(pickedQuantity, requestedQuantity),
            removed: Boolean(item.removedAt),
        };
    };
    const mappedItems = items.map(mapItem);
    const removedMappedItems = allItems
        .filter((item: any) => item.removedAt)
        .map(mapItem);
    const computedSubtotal = mappedItems
        .reduce((sum: number, item: any) => sum + Number(item.subtotal || 0), 0);
    const orderSubtotal = Number(order?.subtotal || 0);
    const orderTax = Number(order?.tax || 0);
    const orderTotal = Number(order?.total || 0);
    const subtotal = orderSubtotal > 0 ? orderSubtotal : computedSubtotal;
    const tax = orderTax > 0 ? orderTax : 0;
    const total = orderTotal > 0 ? orderTotal : subtotal + tax;

    return {
        ...order,
        subtotal,
        tax,
        total,
        items: mappedItems,
        removedItems: removedMappedItems,
        pickingSummary: {
            totalRequested,
            totalPicked,
            progress,
        },
    };
}

export function mapOrderWithPresentationData(order: any) {
    const sanitizedOrder = sanitizeOrderVariantsForPresentation(order);
    const responsible = sanitizedOrder.sellerUser || sanitizedOrder.pickerUser || sanitizedOrder.dispenserUser || null;
    const responsibleRole = sanitizedOrder.sellerUser
        ? 'SELLER'
        : sanitizedOrder.pickerUser
            ? 'PICKER'
            : sanitizedOrder.dispenserUser
                ? 'DISPENSER'
                : null;
    const returnFallbackUser = sanitizedOrder.returnResponsibleUser
        || sanitizedOrder.cancelledByUser
        || sanitizedOrder.dispenserUser
        || sanitizedOrder.pickerUser
        || sanitizedOrder.sellerUser
        || null;
    const returnCancelledByUser = sanitizedOrder.cancelledByUser || returnFallbackUser;
    const hasReturnDelegation = Boolean(sanitizedOrder.returnResponsibilityDelegatedById || sanitizedOrder.returnResponsibilityDelegatedBy);
    const rawReturnStatus = sanitizedOrder.returnResponsibilityStatus || null;
    const shouldTreatInitialReturnAsAccepted = (sanitizedOrder.status as OrderStatusEnum) === OrderStatusEnum.RETURN_PENDING
        && !hasReturnDelegation
        && returnFallbackUser
        && (!rawReturnStatus || rawReturnStatus === 'PENDING');
    const returnAcceptanceStatus = shouldTreatInitialReturnAsAccepted
        ? 'ACCEPTED'
        : rawReturnStatus;

    const baseMappedOrder = {
        ...sanitizedOrder,
        salesChannel: detectSalesChannel(sanitizedOrder.note, sanitizedOrder.code),
        primaryResponsible: responsible
            ? {
                id: responsible.id,
                firstName: responsible.firstName,
                lastName: responsible.lastName,
                role: responsibleRole,
            }
            : null,
        returnWorkflow: sanitizedOrder.returnRequestedAt || returnFallbackUser || returnAcceptanceStatus
            ? {
                requestedAt: sanitizedOrder.returnRequestedAt || null,
                returnedAt: sanitizedOrder.returnedAt || null,
                acceptanceStatus: returnAcceptanceStatus,
                acceptedAt: sanitizedOrder.returnResponsibilityAcceptedAt
                    || (shouldTreatInitialReturnAsAccepted ? sanitizedOrder.returnRequestedAt || sanitizedOrder.updatedAt || null : null),
                cancelledBy: mapSimpleUser(returnCancelledByUser),
                responsible: mapSimpleUser(returnFallbackUser),
                delegatedBy: mapSimpleUser(sanitizedOrder.returnResponsibilityDelegatedBy),
            }
            : null,
    };

    return mapOrderWithPickingSummary(baseMappedOrder);
}

export function buildMarketplaceOrderResponse(order: any) {
    const items = Array.isArray(order.items) ? order.items : [];
    const totalRequested = items.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
    const totalReserved = items.reduce((sum: number, item: any) => sum + Number(item.reserved || 0), 0);
    return {
        ...mapOrderWithPresentationData(order),
        stockSummary: {
            totalRequested,
            totalReserved,
            totalPending: Math.max(0, totalRequested - totalReserved),
        },
        reviewMessage: 'Proforma sujeta a confirmacion de disponibilidad',
    };
}

export function mapMarketplaceOrderSummaries(orders: Array<any>) {
    return orders.map((order) => {
        const totalRequested = (order.items || []).reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
        const totalReserved = (order.items || []).reduce((sum: number, item: any) => sum + Number(item.reserved || 0), 0);
        const pendingUnits = Math.max(0, totalRequested - totalReserved);
        const hasPending = pendingUnits > 0;

        return {
            code: order.code,
            status: order.status,
            publicStatus: mapPublicOrderStatus(order.status as OrderStatusEnum),
            createdAt: order.createdAt,
            totals: {
                subtotal: Number(order.subtotal || 0),
                tax: Number(order.tax || 0),
                total: Number(order.total || 0),
            },
            requestedUnits: totalRequested,
            reservedUnits: totalReserved,
            pendingUnits,
            hasPending,
            reviewMessage: hasPending
                ? 'Proforma en revision: hay cantidades pendientes por confirmar'
                : 'Proforma confirmada para preparacion',
        };
    });
}
