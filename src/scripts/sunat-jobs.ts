/**
 * Jobs SUNAT para ejecutar por cron / tarea programada. Llaman al service directo (sin HTTP).
 *
 *   npm run sunat:resumen [-- YYYY-MM-DD]   Genera el Resumen Diario de las boletas del dia
 *                                           (BORRADOR via resumen) y espera el CDR del ticket.
 *   npm run sunat:tickets                    Consulta todos los tickets PENDING pendientes
 *                                           (resumenes y comunicaciones de baja en proceso).
 *
 * Pensados para agendar, p.ej. cron:
 *   - Cierre del dia (23:30): npm run sunat:resumen
 *   - Polling de tickets 98 cada ~10 min: npm run sunat:tickets
 *
 * Nota e-beta: getStatus puede devolver 98 (en proceso); el job reintenta con backoff.
 */
import { prisma } from "../data/prisma";
import { ComprobanteService } from "../modules/sunat/services/comprobante.service";

const service = new ComprobanteService();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Reintenta consultar el ticket de un resumen hasta que SUNAT deje de responder 98 (en proceso).
async function esperarCdrResumen(id: number, intentos = 6, delayMs = 8000): Promise<void> {
    for (let i = 1; i <= intentos; i++) {
        const r = await service.consultarResumen(id);
        if (r.status !== "PENDING") {
            console.log(`  Resumen #${id}: ${r.status} (CDR ${r.cdrCode ?? "-"}) ${r.cdrDescription ?? ""}`);
            return;
        }
        console.log(`  Resumen #${id}: aun en proceso (98), intento ${i}/${intentos}...`);
        if (i < intentos) await sleep(delayMs);
    }
    console.log(`  Resumen #${id}: sigue en proceso; se reintentara en la proxima corrida.`);
}

async function cmdResumen(fecha?: string): Promise<void> {
    console.log(`Generando Resumen Diario${fecha ? ` para ${fecha}` : " (hoy)"}...`);
    const resumen = await service.generarResumenDiario(fecha);
    console.log(`Resumen #${resumen.id} ${resumen.fileName} ticket=${resumen.ticket ?? "-"} status=${resumen.status}`);
    if (resumen.status === "PENDING" && resumen.ticket) {
        await esperarCdrResumen(resumen.id);
    }
}

async function cmdTickets(): Promise<void> {
    const resumenes = await prisma.resumenDiario.findMany({
        where: { status: "PENDING", ticket: { not: null } },
        select: { id: true },
        orderBy: { id: "asc" },
    });
    const bajas = await prisma.comunicacionBaja.findMany({
        where: { status: "PENDING", ticket: { not: null } },
        select: { id: true },
        orderBy: { id: "asc" },
    });

    console.log(`Tickets pendientes: ${resumenes.length} resumen(es), ${bajas.length} baja(s).`);

    for (const { id } of resumenes) {
        const r = await service.consultarResumen(id);
        console.log(`  Resumen #${id}: ${r.status}${r.status === "PENDING" ? " (aun en proceso)" : ` CDR ${r.cdrCode ?? "-"}`}`);
    }
    for (const { id } of bajas) {
        const b = await service.consultarBaja(id);
        console.log(`  Baja #${id}: ${b.status}${b.status === "PENDING" ? " (aun en proceso)" : ` CDR ${b.cdrCode ?? "-"}`}`);
    }
}

async function main(): Promise<void> {
    const [cmd, arg] = process.argv.slice(2);
    switch (cmd) {
        case "resumen":
            await cmdResumen(arg);
            break;
        case "tickets":
            await cmdTickets();
            break;
        default:
            console.error("Uso: sunat-jobs.ts <resumen [YYYY-MM-DD] | tickets>");
            process.exit(1);
    }
}

main()
    .catch((error) => {
        console.error("ERROR:", error instanceof Error ? error.message : error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
