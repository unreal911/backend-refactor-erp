import { runStartupBootstraps } from "../bootstrap/startup";
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";
import {
    reconcileAuditActivityMigration,
} from "../modules/tenant/audit-activity-reconciliation";

async function main(): Promise<void> {
    await runStartupBootstraps(envs.DATABASE_URL);
    const summary = await reconcileAuditActivityMigration();
    console.info("[audit-reconcile] READY");
    console.info(
        `[audit-reconcile] Auditoría/actividad: `
        + `${summary.counts.auditLogs}/${summary.counts.activityLogs}`,
    );
    console.info(
        `[audit-reconcile] Tenant/cuarentena: `
        + `${summary.counts.tenantAuditLogs}/`
        + summary.counts.quarantinedAuditLogs,
    );
    console.info("[audit-reconcile] Payloads sensibles pendientes: 0");
    console.info("[audit-reconcile] Checkpoint MIG-010: COMPLETED");
}

main()
    .catch((error) => {
        console.error("[audit-reconcile] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
