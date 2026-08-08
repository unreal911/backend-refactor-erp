import { ComprobanteTipo, Prisma } from "@prisma/client";
import { TenantDataContext } from "../../tenant/tenant-data-context";

// Series por defecto por tipo de comprobante.
const DEFAULT_SERIE: Record<ComprobanteTipo, string> = {
    FACTURA: "F001",
    BOLETA: "B001",
    NOTA_CREDITO: "FC01",
    NOTA_DEBITO: "FD01",
};

export interface NextNumberResult {
    serieId: number;
    serie: string;
    numero: number;
    scopeKey: string;
}

// Reserva atomicamente el siguiente correlativo dentro de una transaccion.
export async function reserveNextNumber(
    tx: Prisma.TransactionClient,
    tipo: ComprobanteTipo,
    serie?: string,
    storeId?: number | null,
): Promise<NextNumberResult> {
    const tenantId = TenantDataContext.requireTenantId();
    const targetSerie = serie ?? DEFAULT_SERIE[tipo];
    const scopeKey = storeId ? `STORE-${storeId}` : "GLOBAL";
    if (storeId) {
        const store = await tx.store.findFirst({
            where: { id: storeId, tenantId, isActive: true },
            select: { id: true },
        });
        if (!store) throw new Error("El local fiscal no pertenece al tenant o está inactivo");
    }

    // El upsert cubre tambien la carrera de la primera numeracion de una serie.
    const row = await tx.comprobanteSerie.upsert({
        where: {
            tenantId_tipo_serie_scopeKey: {
                tenantId,
                tipo,
                serie: targetSerie,
                scopeKey,
            },
        },
        create: {
            tenantId,
            tipo,
            serie: targetSerie,
            scopeKey,
            storeId: storeId ?? null,
            correlativo: 1,
        },
        update: { correlativo: { increment: 1 } },
    });

    return { serieId: row.id, serie: row.serie, numero: row.correlativo, scopeKey };
}
