/**
 * Smoke del acople venta -> comprobante ("backend dueno").
 * Verifica que order.service.createOrder, al recibir comprobanteTipo, crea el Comprobante
 * en BORRADOR y que aparece en la bandeja (listarPendientes). No usa HTTP ni envia a SUNAT.
 *
 *   npm run sunat:coupling-smoke
 *
 * Limpia todo lo creado (orden, comprobante, reservas) y revierte el reservedStock.
 */
import { prisma } from "../data/prisma";
import { OrderService } from "../presentation/services/order.service";
import { ComprobanteService } from "../modules/sunat/services/comprobante.service";
import { CreateOrderDto } from "../domain/dtos/create-order.dto";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

async function main(): Promise<void> {
    const orderService = new OrderService();
    const comprobanteService = new ComprobanteService();

    // Fixture: un inventario con stock -> deriva store + variant (fulfillment = source => ruta de reserva).
    const inv = await prisma.inventory.findFirst({
        where: { stock: { gt: 0 }, variant: { isActive: true } },
        include: { variant: true },
        orderBy: { id: "asc" },
    });
    if (!inv) throw new Error("No hay inventario con stock > 0 para la prueba");
    const storeId = inv.storeId;
    const variantId = inv.variantId;
    const unitPrice = Number(inv.variant.price) > 0 ? Number(inv.variant.price) : 100;
    console.log(`Fixture: store=${storeId} variant=${variantId} stockPrevio=${inv.stock} reservedPrevio=${inv.reservedStock}`);

    // --- DTO: factura sin RUC debe fallar (validacion pura) ---
    console.log("\n1) DTO factura sin RUC");
    const [errFac] = CreateOrderDto.create({
        sourceStoreId: storeId,
        clientName: "Cliente Prueba",
        comprobanteTipo: "FACTURA",
        items: [{ variantId, quantity: 1, unitPrice }],
    });
    check("factura sin RUC -> error DTO", !!errFac, errFac);

    // --- DTO: boleta valida ---
    console.log("2) DTO boleta valida");
    const [errBol, dto] = CreateOrderDto.create({
        sourceStoreId: storeId,
        clientName: "Cliente Prueba Boleta",
        clienteTipoDoc: "1",
        clienteNumDoc: "00000000",
        comprobanteTipo: "BOLETA",
        note: "Prueba acople (no POS)",
        items: [{ variantId, quantity: 1, unitPrice }],
    });
    check("boleta -> DTO ok", !errBol && !!dto, errBol);
    if (!dto) throw new Error("DTO invalido, aborta");
    check("dto.comprobanteTipo = BOLETA", dto.comprobanteTipo === "BOLETA", dto.comprobanteTipo);

    // --- createOrder crea la venta + comprobante ---
    console.log("3) createOrder con comprobanteTipo=BOLETA");
    const order: any = await orderService.createOrder(dto);
    check("orden creada con id", !!order?.id, order?.id);
    check("orden persiste comprobanteTipo", order?.comprobanteTipo === "BOLETA", order?.comprobanteTipo);
    check("respuesta trae order.comprobante", !!order?.comprobante, order?.comprobante);
    check("comprobante.tipo = BOLETA", order?.comprobante?.tipo === "BOLETA", order?.comprobante?.tipo);
    check("comprobante.estado = BORRADOR", order?.comprobante?.estado === "BORRADOR", order?.comprobante?.estado);
    check("comprobante tiene serie-numero", !!order?.comprobante?.serie && order?.comprobante?.numero > 0, order?.comprobante);

    // --- La bandeja lo recoge ---
    console.log("4) listarPendientes incluye el lote de hoy");
    const hoy = new Date().toISOString().slice(0, 10);
    const pendientes = await comprobanteService.listarPendientes();
    const loteHoy = pendientes.find((l) => l.fecha === hoy);
    check("hay lote de hoy", !!loteHoy, pendientes.map((l) => l.fecha));
    check("lote de hoy tiene boletas >= 1", (loteHoy?.boletas ?? 0) >= 1, loteHoy);
    check("lote tiene total > 0", (loteHoy?.totalPrecioVenta ?? 0) > 0, loteHoy?.totalPrecioVenta);

    // --- Limpieza ---
    console.log("\nLimpieza");
    const orderId = order.id as number;
    const comps = await prisma.comprobante.findMany({ where: { orderId }, select: { id: true } });
    const compIds = comps.map((c) => c.id);
    if (compIds.length) {
        await prisma.sunatDispatch.deleteMany({ where: { comprobanteId: { in: compIds } } });
        await prisma.comprobanteItem.deleteMany({ where: { comprobanteId: { in: compIds } } });
        await prisma.comprobante.deleteMany({ where: { id: { in: compIds } } });
    }
    // Revertir reservedStock que createOrder incremento (ruta de reserva).
    for (const it of order.items ?? []) {
        const invId = (await prisma.inventory.findFirst({
            where: { storeId: it.fulfillmentStoreId || order.fulfillmentStoreId || order.sourceStoreId, variantId: it.variantId },
            select: { id: true },
        }))?.id;
        if (invId) {
            await prisma.inventory.update({ where: { id: invId }, data: { reservedStock: { decrement: it.quantity } } });
        }
    }
    await prisma.reservation.deleteMany({ where: { orderId } });
    await prisma.orderItem.deleteMany({ where: { orderId } });
    await prisma.order.delete({ where: { id: orderId } });
    console.log(`Eliminada Order #${orderId} + ${compIds.length} comprobante(s); reservedStock revertido. (correlativo de serie no se revierte)`);

    console.log(`\nResultado: ${passed} OK, ${failed} fallo(s).`);
    if (failed > 0) process.exit(1);
}

main()
    .catch((error) => { console.error("ERROR:", error instanceof Error ? error.message : error); process.exit(1); })
    .finally(() => prisma.$disconnect());
