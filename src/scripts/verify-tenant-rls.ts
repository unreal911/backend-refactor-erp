import { runStartupBootstraps } from "../bootstrap/startup";
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";
import { verifyTenantRls } from "../modules/tenant/tenant-rls-verification";

async function main(): Promise<void> {
    await runStartupBootstraps(envs.DATABASE_URL);
    const summary = await verifyTenantRls();
    console.info("[tenant-rls] READY");
    console.info(
        `[tenant-rls] RLS habilitado y forzado: ${summary.tablesWithForcedRls}/39`,
    );
    console.info(`[tenant-rls] Politicas: ${summary.policies}/39`);
    console.info(
        `[tenant-rls] Rol: ${summary.role.name}; superuser=${summary.role.superuser}; bypassrls=${summary.role.bypassRls}; tablas propias=${summary.role.ownedTables}`,
    );
    console.info(
        `[tenant-rls] Sin contexto: ${summary.noContextRows} filas; escritura bloqueada=${summary.noContextWriteBlocked}`,
    );
    console.info(
        `[tenant-rls] A/B: ${summary.companyARows}/${summary.companyBRows}; mutaciones cruzadas=${summary.crossTenantUpdates}`,
    );
    console.info(
        `[tenant-rls] Contexto LOCAL limpiado al reutilizar pool: ${summary.poolContextCleared}`,
    );
    console.info(
        `[tenant-rls] Prisma bajo rol RLS: filas=${summary.prismaScopedRows}; mutaciones cruzadas=${summary.prismaCrossTenantUpdates}`,
    );
}

main()
    .catch((error) => {
        console.error("[tenant-rls] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
