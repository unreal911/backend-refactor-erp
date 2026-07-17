import { prisma } from "../../data/prisma";
import { Prisma } from "@prisma/client";
import { CustomError } from "../../domain/errors/custom.error";
import { OrderStatusEnum } from "../../domain/dtos/update-order-status.dto";

// Acceso a datos genérico de pedidos: lectura de SystemSetting y locks de
// concurrencia (SELECT ... FOR UPDATE). Funciones puras de repositorio: reciben
// `dbClient`/`tx` y no dependen de estado de OrderService.

export async function getSystemSettingValue(key: string, dbClient: any = prisma): Promise<string | null> {
    const rowsRaw = await dbClient.$queryRaw(
        Prisma.sql`SELECT "value" FROM "SystemSetting" WHERE "key" = ${key} LIMIT 1`,
    );
    const rows = rowsRaw as Array<{ value: string }>;
    return rows?.[0]?.value ?? null;
}

export async function lockOrderRow(tx: any, orderId: number): Promise<void> {
    await tx.$executeRaw(
        Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`,
    );
}

// G3: bloquea la fila del pedido y re-valida que siga en un estado que permite
// separar (picking). Serializa las escrituras de `picked` contra una
// cancelacion/entrega concurrente (que tambien toma el lock), evitando marcar
// separada mercaderia de un pedido ya CANCELLED/RETURN_PENDING/DELIVERED.
export async function assertPickableUnderLock(tx: any, orderId: number): Promise<void> {
    await lockOrderRow(tx, orderId);
    const locked = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true },
    });
    const status = locked?.status as OrderStatusEnum | undefined;
    const pickable = [
        OrderStatusEnum.CONFIRMED,
        OrderStatusEnum.PREPARING,
        OrderStatusEnum.WAITING_TRANSFER,
        OrderStatusEnum.READY,
    ];
    if (!status || !pickable.includes(status)) {
        throw CustomError.badRequest('El pedido cambio de estado y no permite actualizar el picking. Refresca e intenta de nuevo.');
    }
}
