/**
 * Smoke test HTTP de los endpoints /api/sunat/* con la app corriendo + JWT.
 *
 * A diferencia de `sunat:smoke` (que pega directo al service), este ejercita la capa
 * HTTP completa: AuthMiddleware.validateJWT, el controller, el parseo de body y handleError.
 *
 * Uso:
 *   1) Levanta el backend en otra terminal:   npm run dev
 *   2) Corre el smoke:                         npm run sunat:http-smoke
 *
 * Qué hace:
 *   - Verifica que sin token el endpoint responde 401 (auth middleware).
 *   - Hace login (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD) y obtiene el JWT.
 *   - Crea una Order de prueba (reusa el primer Store + ProductVariant activos).
 *   - Emite una BOLETA en dryRun (arma XML/ZIP sin enviar a SUNAT) vía POST /orders/:id/boleta.
 *   - Verifica GET /orders/:id/comprobantes y GET /comprobantes/:id.
 *   - Limpia la Order y el comprobante creados (salvo SUNAT_HTTP_KEEP=1).
 *
 * Flags (env):
 *   SUNAT_HTTP_BASE   URL base del backend (default http://localhost:$PORT)
 *   SUNAT_HTTP_SEND=1 además del dryRun, hace un envío REAL a e-beta (consume correlativo)
 *   SUNAT_HTTP_KEEP=1 no borra la Order/comprobantes creados al final
 */
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";

const BASE = process.env.SUNAT_HTTP_BASE?.replace(/\/$/, "") ?? `http://localhost:${envs.PORT}`;
const DO_SEND = process.env.SUNAT_HTTP_SEND === "1";
const KEEP = process.env.SUNAT_HTTP_KEEP === "1";

type ApiResult = { status: number; body: any };

async function api(
    method: string,
    path: string,
    opts: { token?: string; body?: unknown } = {},
): Promise<ApiResult> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    const res = await fetch(`${BASE}${path}`, init);
    let body: any = null;
    const text = await res.text();
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }
    return { status: res.status, body };
}

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: unknown): void {
    if (cond) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
    }
}

async function crearOrdenDePrueba(): Promise<{ orderId: number; code: string }> {
    const store = await prisma.store.findFirst({ where: { isActive: true }, orderBy: { id: "asc" } });
    if (!store) throw new Error("No hay Store activo en la BD para la orden de prueba");

    const variant = await prisma.productVariant.findFirst({
        where: { isActive: true },
        orderBy: { id: "asc" },
    });
    if (!variant) throw new Error("No hay ProductVariant activo en la BD para la orden de prueba");

    const code = `TEST-SUNAT-${Date.now()}`;
    const unitPrice = Number(variant.price) > 0 ? Number(variant.price) : 100;
    const quantity = 1;
    const subtotal = Number((unitPrice * quantity).toFixed(2));

    const order = await prisma.order.create({
        data: {
            code,
            status: "PENDING",
            clientName: "CLIENTE DE PRUEBA SMOKE",
            sourceStoreId: store.id,
            subtotal,
            total: subtotal,
            items: {
                create: [{ variantId: variant.id, quantity, unitPrice, subtotal }],
            },
        },
    });

    console.log(`Orden de prueba creada: #${order.id} (${code}) store=${store.id} variant=${variant.id} precio=${unitPrice}`);
    return { orderId: order.id, code };
}

async function limpiar(orderId: number): Promise<void> {
    if (KEEP) {
        console.log(`SUNAT_HTTP_KEEP=1 → se conserva la Order #${orderId} y sus comprobantes.`);
        return;
    }
    const comps = await prisma.comprobante.findMany({ where: { orderId }, select: { id: true } });
    const compIds = comps.map((c) => c.id);
    if (compIds.length) {
        await prisma.sunatDispatch.deleteMany({ where: { comprobanteId: { in: compIds } } });
        await prisma.comprobanteItem.deleteMany({ where: { comprobanteId: { in: compIds } } });
        await prisma.comprobante.deleteMany({ where: { id: { in: compIds } } });
    }
    await prisma.orderItem.deleteMany({ where: { orderId } });
    await prisma.order.delete({ where: { id: orderId } });
    console.log(`Limpieza: eliminada Order #${orderId} y ${compIds.length} comprobante(s). (Nota: el correlativo de serie no se revierte.)`);
}

async function main(): Promise<void> {
    console.log(`Smoke HTTP SUNAT contra ${BASE}\n`);

    // 1) Auth middleware: sin token debe rechazar
    console.log("1) Auth middleware");
    const noAuth = await api("GET", "/api/sunat/orders/1/comprobantes");
    check("GET protegido sin token → 401", noAuth.status === 401, noAuth.status);

    // 2) Login
    console.log("2) Login");
    const email = envs.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const password = envs.SEED_ADMIN_PASSWORD?.trim();
    if (!email || !password) {
        throw new Error("Define SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD en .env (o corre npm run bootstrap:admin).");
    }
    const login = await api("POST", "/api/auth/login", { body: { email, password } });
    check("POST /api/auth/login → 200 con token", login.status === 200 && !!login.body?.token, login.body);
    const token: string | undefined = login.body?.token;
    if (!token) throw new Error("No se obtuvo token; aborta.");

    // 3) Fixture
    console.log("3) Orden de prueba");
    const { orderId } = await crearOrdenDePrueba();

    try {
        // 4) Listar comprobantes (vacío)
        console.log("4) GET comprobantes de la orden (vacío)");
        const listaVacia = await api("GET", `/api/sunat/orders/${orderId}/comprobantes`, { token });
        check("GET /orders/:id/comprobantes → 200 []", listaVacia.status === 200 && Array.isArray(listaVacia.body) && listaVacia.body.length === 0, listaVacia);

        // 5) Emitir boleta dryRun
        console.log("5) POST boleta (dryRun)");
        const boleta = await api("POST", `/api/sunat/orders/${orderId}/boleta`, {
            token,
            body: { dryRun: true },
        });
        check("POST /orders/:id/boleta dryRun → 201", boleta.status === 201, boleta);
        check("boleta.estado = BORRADOR", boleta.body?.estado === "BORRADOR", boleta.body?.estado);
        check("boleta tiene id/serie/numero", !!boleta.body?.id && !!boleta.body?.serie, boleta.body);
        const comprobanteId: number | undefined = boleta.body?.id;

        // 6) Obtener el comprobante creado
        if (comprobanteId) {
            console.log("6) GET comprobante por id");
            const obtenido = await api("GET", `/api/sunat/comprobantes/${comprobanteId}`, { token });
            check("GET /comprobantes/:id → 200", obtenido.status === 200 && obtenido.body?.id === comprobanteId, obtenido);
        }

        // 7) Validación de request inválido (factura sin RUC → 400)
        console.log("7) POST factura sin RUC (debe fallar 400)");
        const facturaMal = await api("POST", `/api/sunat/orders/${orderId}/factura`, {
            token,
            body: { dryRun: true },
        });
        check("POST /orders/:id/factura sin RUC → 400", facturaMal.status === 400, facturaMal);

        // 8) Envío real opcional
        if (DO_SEND) {
            console.log("8) POST boleta (envío REAL a e-beta)");
            const real = await api("POST", `/api/sunat/orders/${orderId}/boleta`, {
                token,
                body: { cliente: { tipoDoc: "1", numDoc: "00000000", nombre: "CLIENTE SMOKE" } },
            });
            check("POST boleta real → 201", real.status === 201, real);
            check("boleta real ACEPTADO/observaciones", ["ACEPTADO", "ACEPTADO_CON_OBSERVACIONES"].includes(real.body?.estado), real.body?.estado);
            console.log("   estado:", real.body?.estado, "| dispatches:", real.body?.dispatches?.[0]?.cdrDescription ?? real.body?.dispatches?.[0]?.status);
        } else {
            console.log("8) (envío real omitido; SUNAT_HTTP_SEND=1 para probarlo)");
        }
    } finally {
        console.log("\nLimpieza");
        await limpiar(orderId);
    }

    console.log(`\nResultado: ${passed} OK, ${failed} fallo(s).`);
    if (failed > 0) process.exit(1);
}

main()
    .catch((error) => {
        console.error("ERROR:", error instanceof Error ? error.message : error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
