import { runStartupBootstraps } from "../bootstrap/startup";
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";
import { reconcileInventoryMigration } from "../modules/tenant/inventory-reconciliation";

async function main(): Promise<void> {
    await runStartupBootstraps(envs.DATABASE_URL);
    const summary = await reconcileInventoryMigration();

    console.info("[inventory-reconcile] READY");
    console.info(
        `[inventory-reconcile] Tiendas/saldos: `
        + `${summary.storeCount}/${summary.inventoryCount}`,
    );
    console.info(
        `[inventory-reconcile] Stock/reservado/disponible: `
        + `${summary.stock}/${summary.reservedStock}/${summary.availableStock}`,
    );
    console.info(
        `[inventory-reconcile] Grupos tienda/variante: `
        + `${summary.storeGroups.length}/${summary.variantGroups.length}`,
    );
    console.info(
        `[inventory-reconcile] Referencias históricas a tienda: `
        + summary.storeReferenceCount,
    );
    console.info("[inventory-reconcile] Saldos y relaciones: consistentes");
    console.info("[inventory-reconcile] Checkpoint MIG-005: COMPLETED");
}

main()
    .catch((error) => {
        console.error("[inventory-reconcile] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
