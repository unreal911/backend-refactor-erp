/**
 * Smoke de las ACCIONES de la Fase B contra e-beta REAL (envia a SUNAT):
 * emite una boleta (sendBill) -> ACEPTADO, le emite una Nota de Credito (queda BORRADOR),
 * genera el Resumen Diario (sendSummary -> ticket) y consulta el CDR hasta aceptar.
 * Valida el flujo NC-sobre-boleta end-to-end (lo unico de Fase B sin probar en beta).
 *
 *   npm run sunat:acciones-beta
 *
 * Usa credenciales SUNAT_* de .env (default beta MODDATOS). Consume correlativos y deja
 * los registros creados (no borra: son datos beta). Nota: barre TODAS las boletas/notas
 * BORRADOR del dia en el resumen (comportamiento real).
 */
import { prisma } from "../data/prisma";
import { ComprobanteService } from "../modules/sunat/services/comprobante.service";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

async function crearOrden(): Promise<number> {
    const store = await prisma.store.findFirst({ where: { isActive: true }, orderBy: { id: "asc" } });
    const variant = await prisma.productVariant.findFirst({ where: { isActive: true }, orderBy: { id: "asc" } });
    if (!store || !variant) throw new Error("Falta store/variant activo");
    const unitPrice = Number(variant.price) > 0 ? Number(variant.price) : 100;
    const order = await prisma.order.create({
        data: {
            code: `TEST-ACC-${Date.now()}`,
            status: "PENDING",
            clientName: "CLIENTE ACCIONES BETA",
            sourceStoreId: store.id,
            subtotal: unitPrice,
            total: unitPrice,
            items: { create: [{ variantId: variant.id, quantity: 1, unitPrice, subtotal: unitPrice }] },
        },
    });
    console.log(`Orden fixture #${order.id} (${order.code})`);
    return order.id;
}

async function main(): Promise<void> {
    const svc = new ComprobanteService();
    console.log("Smoke acciones SUNAT contra e-beta REAL\n");

    const orderId = await crearOrden();

    // 1) Boleta real -> ACEPTADO
    console.log("1) Emitir boleta (sendBill real)");
    const boleta = await svc.emitirDesdeOrder(orderId, "BOLETA", {
        cliente: { tipoDoc: "1", numDoc: "00000000", nombre: "CLIENTE ACCIONES" },
    });
    console.log(`   Boleta ${boleta.serie}-${boleta.numero} -> ${boleta.estado}`);
    check("boleta ACEPTADA por e-beta", ["ACEPTADO", "ACEPTADO_CON_OBSERVACIONES"].includes(boleta.estado), boleta.estado);
    if (!["ACEPTADO", "ACEPTADO_CON_OBSERVACIONES"].includes(boleta.estado)) {
        console.error("   Sin boleta aceptada no se puede continuar con la NC.");
        console.log(`\nResultado: ${passed} OK, ${failed} fallo(s).`); process.exit(1);
    }

    // 2) Nota de credito sobre la boleta -> BORRADOR (va por Resumen)
    console.log("2) Emitir Nota de Credito sobre la boleta");
    const nc = await svc.emitirNota(boleta.id, "NOTA_CREDITO", {
        codigoMotivo: "01",
        descripcionMotivo: "ANULACION DE LA OPERACION",
    });
    console.log(`   NC ${nc.serie}-${nc.numero} -> ${nc.estado}`);
    check("NC tipo NOTA_CREDITO", nc.tipo === "NOTA_CREDITO", nc.tipo);
    check("NC queda BORRADOR (para Resumen)", nc.estado === "BORRADOR", nc.estado);

    // 3) Generar Resumen Diario (con reintentos por 401 transitorio tras sendBill)
    console.log("3) Generar Resumen Diario (sendSummary)");
    await sleep(8000); // el gateway e-beta responde 401 si sendSummary va inmediato tras sendBill
    let resumen = await svc.generarResumenDiario();
    for (let i = 1; i <= 4 && resumen.status === "ERROR"; i++) {
        console.log(`   Resumen ERROR (${resumen.faultString ?? "?"}); reintento ${i}/4 tras backoff...`);
        await sleep(10000);
        resumen = await svc.generarResumenDiario();
    }
    console.log(`   Resumen ${resumen.fileName} status=${resumen.status} ticket=${resumen.ticket ?? "-"}`);
    check("Resumen enviado con ticket", !!resumen.ticket && resumen.status === "PENDING", resumen.status);

    // 4) Consultar CDR hasta que deje de estar en proceso (98)
    if (resumen.ticket) {
        console.log("4) Consultar CDR del resumen");
        let consultado = resumen;
        for (let i = 1; i <= 8 && consultado.status === "PENDING"; i++) {
            await sleep(8000);
            consultado = await svc.consultarResumen(resumen.id);
            console.log(`   intento ${i}: status=${consultado.status} cdr=${consultado.cdrCode ?? "-"} ${consultado.cdrDescription ?? ""}`);
        }
        check("Resumen ACEPTADO", ["ACCEPTED", "ACCEPTED_WITH_OBSERVATIONS"].includes(consultado.status), consultado.status);

        // 5) La NC quedo aceptada
        const ncFinal = await prisma.comprobante.findUnique({ where: { id: nc.id }, select: { estado: true, serie: true, numero: true } });
        console.log(`   NC ${ncFinal?.serie}-${ncFinal?.numero} estado final=${ncFinal?.estado}`);
        check("NC ACEPTADA tras el resumen", ["ACEPTADO", "ACEPTADO_CON_OBSERVACIONES"].includes(ncFinal?.estado ?? ""), ncFinal?.estado);
    }

    console.log(`\nResultado: ${passed} OK, ${failed} fallo(s).`);
    console.log(`(Registros beta conservados: orden #${orderId}, boleta ${boleta.serie}-${boleta.numero}, NC ${nc.serie}-${nc.numero})`);
    if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
