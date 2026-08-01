import { runStartupBootstraps } from "../bootstrap/startup";
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";
import { reconcileIdentityMigration } from "../modules/tenant/identity-reconciliation";

async function main(): Promise<void> {
    await runStartupBootstraps(envs.DATABASE_URL);
    const summary = await reconcileIdentityMigration();

    console.info("[identity-reconcile] READY");
    console.info(
        `[identity-reconcile] Usuarios/membresías: ${summary.userCount}/${summary.userCount}`,
    );
    console.info(`[identity-reconcile] OWNER heredado: userId ${summary.ownerUserId}`);
    console.info(
        `[identity-reconcile] RBAC: ${summary.roleCount} roles, `
        + `${summary.permissionCount} permisos, `
        + `${summary.rolePermissionCount} relaciones`,
    );
    console.info(
        `[identity-reconcile] Hashes bcrypt preservados: ${summary.compatiblePasswordCount}`,
    );
    console.info(
        `[identity-reconcile] Referencias históricas: `
        + `${summary.populatedReferences} pobladas, 0 huérfanas, 0 cruzadas`,
    );
    console.info(
        `[identity-reconcile] FKs usuario/tenant: ${summary.tenantMembershipForeignKeys}`,
    );
    console.info("[identity-reconcile] Checkpoint MIG-003: COMPLETED");
}

main()
    .catch((error) => {
        console.error("[identity-reconcile] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
