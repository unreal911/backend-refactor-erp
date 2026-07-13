import { ComprobanteTipo, Prisma } from "@prisma/client";

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
}

// Reserva atomicamente el siguiente correlativo dentro de una transaccion.
export async function reserveNextNumber(
    tx: Prisma.TransactionClient,
    tipo: ComprobanteTipo,
    serie?: string,
): Promise<NextNumberResult> {
    const targetSerie = serie ?? DEFAULT_SERIE[tipo];

    // upsert de la serie
    const existing = await tx.comprobanteSerie.findUnique({
        where: { tipo_serie: { tipo, serie: targetSerie } },
    });

    const row = existing
        ? await tx.comprobanteSerie.update({
              where: { id: existing.id },
              data: { correlativo: { increment: 1 } },
          })
        : await tx.comprobanteSerie.create({
              data: { tipo, serie: targetSerie, correlativo: 1 },
          });

    return { serieId: row.id, serie: row.serie, numero: row.correlativo };
}
