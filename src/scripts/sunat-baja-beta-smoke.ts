/**
 * Smoke de la Comunicacion de Baja (RA) contra e-beta REAL:
 * emite una FACTURA (sendBill) -> ACEPTADO, comunica su baja (sendSummary -> ticket)
 * y consulta el CDR hasta aceptar; la factura debe quedar ANULADO.
 * Valida el ultimo flujo de Fase B sin probar en beta.
 *
 *   npm run sunat:baja-beta
 *
 * Usa credenciales SUNAT_* de .env (default beta MODDATOS). Consume correlativos y deja
 * los registros creados (datos beta).
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
            code: `TEST-BAJA-${Date.now()}`,
            status: "PENDING",
            clientName: "CLIENTE DE PRUEBA SAC",
            clienteTipoDoc: "6",
            clienteNumDoc: "20000000001",
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
    console.log("Smoke Comunicacion de Baja (RA) contra e-beta REAL\n");

    const orderId = await crearOrden();

    // 1) Factura real -> ACEPTADO
    console.log("1) Emitir factura (sendBill real)");
    const factura = await svc.emitirDesdeOrder(orderId, "FACTURA", {
        cliente: { tipoDoc: "6", numDoc: "20000000001", nombre: "CLIENTE DE PRUEBA SAC" },
    });
    console.log(`   Factura ${factura.serie}-${factura.numero} -> ${factura.estado}`);
    check("factura ACEPTADA por e-beta", ["ACEPTADO", "ACEPTADO_CON_OBSERVACIONES"].includes(factura.estado), factura.estado);
    if (!["ACEPTADO", "ACEPTADO_CON_OBSERVACIONES"].includes(factura.estado)) {
        console.log(`\nResultado: ${passed} OK, ${failed} fallo(s).`); process.exit(1);
    }

    // 2) Comunicacion de Baja de la factura (con reintentos por 401 transitorio)
    console.log("2) Generar Comunicacion de Baja (sendSummary)");
    await sleep(8000);
    let baja = await svc.generarComunicacionBaja([{ comprobanteId: factura.id, motivo: "ERROR EN LOS DATOS DEL COMPROBANTE" }]);
    for (let i = 1; i <= 4 && baja.status === "ERROR"; i++) {
        console.log(`   Baja ERROR (${baja.faultString ?? "?"}); reintento ${i}/4 tras backoff...`);
        await sleep(10000);
        // Reintentar: la baja anterior quedo ERROR y libero al comprobante; se genera otra.
        baja = await svc.generarComunicacionBaja([{ comprobanteId: factura.id, motivo: "ERROR EN LOS DATOS DEL COMPROBANTE" }]);
    }
    console.log(`   Baja ${baja.fileName} status=${baja.status} ticket=${baja.ticket ?? "-"}`);
    check("Baja enviada con ticket", !!baja.ticket && baja.status === "PENDING", baja.status);

    // 3) Consultar CDR hasta que deje de estar en proceso (98)
    if (baja.ticket) {
        console.log("3) Consultar CDR de la baja");
        let consultada = baja;
        for (let i = 1; i <= 8 && consultada.status === "PENDING"; i++) {
            await sleep(8000);
            consultada = await svc.consultarBaja(baja.id);
            console.log(`   intento ${i}: status=${consultada.status} cdr=${consultada.cdrCode ?? "-"} ${consultada.cdrDescription ?? ""}`);
        }
        check("Baja ACEPTADA", ["ACCEPTED", "ACCEPTED_WITH_OBSERVATIONS"].includes(consultada.status), consultada.status);

        const facFinal = await prisma.comprobante.findUnique({ where: { id: factura.id }, select: { estado: true, serie: true, numero: true } });
        console.log(`   Factura ${facFinal?.serie}-${facFinal?.numero} estado final=${facFinal?.estado}`);
        check("Factura ANULADO tras la baja", facFinal?.estado === "ANULADO", facFinal?.estado);
    }

    console.log(`\nResultado: ${passed} OK, ${failed} fallo(s).`);
    console.log(`(Registros beta conservados: orden #${orderId}, factura ${factura.serie}-${factura.numero})`);
    if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
