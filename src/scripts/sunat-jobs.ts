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
import {
    prisma,
    runTenantDatabaseTransaction,
} from "../data/prisma";
import { platformPrisma } from "../data/platform-prisma";
import { ComprobanteService } from "../modules/sunat/services/comprobante.service";

const service = new ComprobanteService();

type SunatJobPayload = {
    tenantId: string;
    command: "resumen" | "tickets";
    date?: string;
};

function validateJobPayload(input: {
    tenantId?: unknown;
    command?: unknown;
    date?: unknown;
}): SunatJobPayload {
    const tenantId = String(input.tenantId ?? "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
        throw new Error("El payload del job requiere un tenantId UUID valido");
    }
    if (input.command !== "resumen" && input.command !== "tickets") {
        throw new Error(
            "Uso: sunat-jobs.ts <resumen [YYYY-MM-DD] | tickets>",
        );
    }

    const date = input.date === undefined
        ? undefined
        : String(input.date).trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("La fecha del job debe usar el formato YYYY-MM-DD");
    }
    if (input.command === "tickets" && date) {
        throw new Error("El job tickets no recibe fecha");
    }
    return {
        tenantId,
        command: input.command,
        ...(date ? { date } : {}),
    };
}

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

async function resolveJobTenant(): Promise<{ id: string; slug: string }> {
    const selector = String(
        process.env.SUNAT_TENANT_ID
        ?? process.env.SUNAT_TENANT_SLUG
        ?? "",
    ).trim();
    if (selector) {
        const tenant = await platformPrisma.tenant.findFirst({
            where: {
                OR: [{ id: selector }, { slug: selector }],
                status: { in: ["TRIAL", "ACTIVE"] },
            },
            select: { id: true, slug: true },
        });
        if (!tenant) {
            throw new Error(
                `La empresa SUNAT '${selector}' no existe o no esta activa`,
            );
        }
        return tenant;
    }

    const tenants = await platformPrisma.tenant.findMany({
        where: { status: { in: ["TRIAL", "ACTIVE"] } },
        select: { id: true, slug: true },
        orderBy: { createdAt: "asc" },
        take: 2,
    });
    if (tenants.length !== 1) {
        throw new Error(
            "Define SUNAT_TENANT_SLUG o SUNAT_TENANT_ID para ejecutar el job en una empresa",
        );
    }
    return tenants[0]!;
}

async function main(): Promise<void> {
    const [cmd, arg] = process.argv.slice(2);
    const tenant = await resolveJobTenant();
    const payload = validateJobPayload({
        tenantId: tenant.id,
        command: cmd,
        date: arg,
    });
    console.log(`Empresa SUNAT: ${tenant.slug} (${tenant.id})`);
    await runTenantDatabaseTransaction(payload.tenantId, async () => {
        switch (payload.command) {
            case "resumen":
                await cmdResumen(payload.date);
                break;
            case "tickets":
                await cmdTickets();
                break;
        }
    });
}

main()
    .catch((error) => {
        console.error("ERROR:", error instanceof Error ? error.message : error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
