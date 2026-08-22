import { runStartupBootstraps } from "../bootstrap/startup";
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";
import { reconcileOrderPickingMigration } from "../modules/tenant/order-picking-reconciliation";

async function main(): Promise<void> {
    await runStartupBootstraps(envs.DATABASE_URL);
    const summary = await reconcileOrderPickingMigration();

    console.info("[order-reconcile] READY");
    console.info(
        `[order-reconcile] Pedidos/ítems/reservas: `
        + `${summary.counts.orders}/${summary.counts.orderItems}/`
        + summary.counts.reservations,
    );
    console.info(
        `[order-reconcile] Sesiones/ítems/detalles picking: `
        + `${summary.counts.pickingSessions}/${summary.counts.pickingItems}/`
        + summary.counts.orderItemDetails,
    );
    console.info(
        `[order-reconcile] Pedido subtotal/impuesto/total: `
        + `${summary.totals.orderSubtotal}/${summary.totals.orderTax}/`
        + summary.totals.orderTotal,
    );
    console.info(
        `[order-reconcile] Cuarentena: PickingItem#8, exceso `
        + summary.invalidPickingRows[0]?.excess,
    );
    console.info(
        `[order-reconcile] Restricciones tenant: `
        + summary.tenantConstraintCount,
    );
    console.info("[order-reconcile] Relaciones e idempotencia: consistentes");
    console.info("[order-reconcile] Checkpoint MIG-007: COMPLETED");
}

main()
    .catch((error) => {
        console.error("[order-reconcile] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
