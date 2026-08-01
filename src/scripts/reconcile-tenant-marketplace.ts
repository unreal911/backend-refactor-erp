import { runStartupBootstraps } from "../bootstrap/startup";
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";
import {
    reconcileMarketplaceConfigMigration,
} from "../modules/tenant/marketplace-config-reconciliation";

async function main(): Promise<void> {
    await runStartupBootstraps(envs.DATABASE_URL);
    const summary = await reconcileMarketplaceConfigMigration();

    console.info("[marketplace-reconcile] READY");
    console.info(
        `[marketplace-reconcile] Clientes/métodos/configuraciones: `
        + `${summary.counts.marketplaceCustomers}/`
        + `${summary.counts.paymentMethods}/`
        + summary.counts.systemSettings,
    );
    console.info(
        `[marketplace-reconcile] Hashes bcrypt compatibles: `
        + summary.passwordEvidence.bcryptCompatible,
    );
    console.info(
        `[marketplace-reconcile] Métodos permitidos válidos: `
        + summary.allowedPaymentMethodIds.length,
    );
    console.info(
        `[marketplace-reconcile] Claves dinámicas inventariadas: `
        + summary.unknownSettings.length,
    );
    console.info("[marketplace-reconcile] Checkpoint MIG-009: COMPLETED");
}

main()
    .catch((error) => {
        console.error("[marketplace-reconcile] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
