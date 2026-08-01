import { runStartupBootstraps } from "../bootstrap/startup";
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";
import { reconcileMovementMigration } from "../modules/tenant/movement-reconciliation";

async function main(): Promise<void> {
    await runStartupBootstraps(envs.DATABASE_URL);
    const summary = await reconcileMovementMigration();

    console.info("[movement-reconcile] READY");
    console.info(
        `[movement-reconcile] Movimientos/transferencias/ítems: `
        + `${summary.movementCount}/${summary.transferCount}/`
        + summary.transferItemCount,
    );
    console.info(
        `[movement-reconcile] Cantidad/anterior/nuevo: `
        + `${summary.quantity}/${summary.previousStock}/${summary.newStock}`,
    );
    console.info(
        `[movement-reconcile] Tipos/ubicaciones: `
        + `${summary.movementGroups.length}/${summary.locationGroups.length}`,
    );
    console.info(
        `[movement-reconcile] Brecha heredada aprobada: `
        + `${summary.discontinuityCount} saltos, absoluta `
        + `${summary.absoluteGap}, neta ${summary.netGap}`,
    );
    console.info("[movement-reconcile] Saldos finales y relaciones: consistentes");
    console.info("[movement-reconcile] Checkpoint MIG-006: COMPLETED");
}

main()
    .catch((error) => {
        console.error("[movement-reconcile] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
