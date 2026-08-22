import { runStartupBootstraps } from "../bootstrap/startup";
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";
import { reconcileCatalogMigration } from "../modules/tenant/catalog-reconciliation";

async function main(): Promise<void> {
    await runStartupBootstraps(envs.DATABASE_URL);
    const checkMedia = process.argv.includes("--check-media");
    const summary = await reconcileCatalogMigration({ checkMedia });

    console.info("[catalog-reconcile] READY");
    console.info(
        `[catalog-reconcile] Categorías/colores/tallas: `
        + `${summary.categoryCount}/${summary.colorCount}/${summary.sizeCount}`,
    );
    console.info(
        `[catalog-reconcile] Productos/variantes/imágenes: `
        + `${summary.productCount}/${summary.variantCount}/${summary.imageCount}`,
    );
    console.info(
        `[catalog-reconcile] Modos heredados SIMPLE/SIZE_ONLY/MATRIX: `
        + `${summary.simpleProducts}/${summary.sizeOnlyProducts}/${summary.matrixProducts}`,
    );
    console.info(
        `[catalog-reconcile] Referencias Cloudinary: ${summary.mediaReferences}`
        + (
            summary.reachableMedia === null
                ? " (comprobación remota omitida)"
                : `, alcanzables ${summary.reachableMedia}`
        ),
    );
    console.info("[catalog-reconcile] Relaciones y variantKey: consistentes");
    console.info("[catalog-reconcile] Checkpoint MIG-004: COMPLETED");
}

main()
    .catch((error) => {
        console.error("[catalog-reconcile] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
