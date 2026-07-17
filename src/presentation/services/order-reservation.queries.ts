import { Prisma } from "@prisma/client";

// Primitivas de reserva atomica anti-carrera (extraidas del god object).
// El WHERE condicional se re-evalua bajo el lock de fila -> dos reservas
// concurrentes no sobre-reservan. Operan sobre la tx que reciben.

/**
 * Incrementa reservedStock solo si hay disponible suficiente (stock - reservado
 * >= qty). Devuelve el numero de filas afectadas (0 = no cupo).
 */
export async function reserveInventoryConditional(tx: any, inventoryId: number, quantity: number): Promise<number> {
    const updated = await tx.$executeRaw(
        Prisma.sql`
            UPDATE "Inventory"
            SET "reservedStock" = "reservedStock" + ${quantity}
            WHERE "id" = ${inventoryId}
              AND "stock" - "reservedStock" >= ${quantity}
        `,
    );
    return Number(updated || 0);
}

/**
 * Incrementa OrderItem.reserved sin pasar de la cantidad pedida; deja status
 * PENDING y fija fulfillmentStoreId solo si estaba vacio (COALESCE). Devuelve
 * filas afectadas (0 = la linea ya estaba llena por otra operacion).
 */
export async function reserveOrderItemConditional(
    tx: any,
    orderItemId: number,
    quantity: number,
    fulfillmentStoreId: number,
): Promise<number> {
    const updated = await tx.$executeRaw(
        Prisma.sql`
            UPDATE "OrderItem"
            SET "reserved" = "reserved" + ${quantity},
                "status" = 'PENDING',
                "fulfillmentStoreId" = COALESCE("fulfillmentStoreId", ${fulfillmentStoreId})
            WHERE "id" = ${orderItemId}
              AND "reserved" + ${quantity} <= "quantity"
        `,
    );
    return Number(updated || 0);
}

/**
 * Revierte un incremento de reservedStock (nunca deja negativo). Se usa cuando
 * la reserva de inventario se aplico pero la de la linea fallo (carrera), y
 * tambien al liberar reserva de una linea.
 */
export async function revertInventoryReservation(tx: any, inventoryId: number, quantity: number): Promise<void> {
    await tx.$executeRaw(
        Prisma.sql`
            UPDATE "Inventory"
            SET "reservedStock" = GREATEST(0, "reservedStock" - ${quantity})
            WHERE "id" = ${inventoryId}
        `,
    );
}

/**
 * Baja OrderItem.reserved (nunca negativo) y deja la linea en PENDING. Usado al
 * liberar reserva de la linea.
 */
export async function releaseOrderItemReservation(tx: any, orderItemId: number, quantity: number): Promise<void> {
    await tx.$executeRaw(
        Prisma.sql`
            UPDATE "OrderItem"
            SET "reserved" = GREATEST(0, "reserved" - ${quantity}),
                "status" = 'PENDING'
            WHERE "id" = ${orderItemId}
        `,
    );
}

/**
 * C4: tras liberar, el separado (picked) no puede superar lo que queda reservado.
 * Recorta picked al nuevo reserved de la linea.
 */
export async function clampOrderItemPickedToReserved(tx: any, orderItemId: number): Promise<void> {
    await tx.$executeRaw(
        Prisma.sql`
            UPDATE "OrderItem"
            SET "picked" = LEAST("picked", "reserved")
            WHERE "id" = ${orderItemId}
        `,
    );
}

/**
 * Recorta el detalle de picking de la linea al maximo reservado y devuelve el
 * pickingItemId afectado (0 si no habia detalle) para recalcular su total.
 */
export async function clampPickingDetailToReserved(tx: any, orderItemId: number, maxReserved: number): Promise<number> {
    const rows = await tx.$queryRaw(
        Prisma.sql`
            UPDATE "PickingOrderItemDetail"
            SET "pickedQuantity" = LEAST("pickedQuantity", ${maxReserved}),
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "orderItemId" = ${orderItemId}
            RETURNING "pickingItemId"
        `,
    ) as Array<{ pickingItemId: number | null }>;
    return Number(rows?.[0]?.pickingItemId || 0);
}
