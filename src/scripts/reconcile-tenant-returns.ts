import { runStartupBootstraps } from "../bootstrap/startup";
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";
import {
    reconcileReturnPaymentMigration,
} from "../modules/tenant/return-payment-reconciliation";

async function main(): Promise<void> {
    await runStartupBootstraps(envs.DATABASE_URL);
    const summary = await reconcileReturnPaymentMigration();

    console.info("[return-reconcile] READY");
    console.info(
        `[return-reconcile] Devoluciones/ítems: `
        + `${summary.counts.returns}/${summary.counts.returnItems}`,
    );
    console.info(
        `[return-reconcile] Cantidad/importe: `
        + `${summary.totals.returnQuantity}/${summary.totals.returnAmount}`,
    );
    console.info(
        `[return-reconcile] Notas/evidencias de pago: `
        + `${summary.paymentEvidence.notes}/${summary.paymentEvidence.parsed}`,
    );
    console.info(
        `[return-reconcile] Restricciones tenant/guardas: `
        + `${summary.tenantConstraintCount}/${summary.returnGuardCount}`,
    );
    console.info(
        "[return-reconcile] No se crearon transacciones de pago estructuradas",
    );
    console.info("[return-reconcile] Checkpoint MIG-008: COMPLETED");
}

main()
    .catch((error) => {
        console.error("[return-reconcile] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
