import { Prisma, TenantKind, TenantMembershipRole, TenantMembershipStatus, TenantStatus } from "@prisma/client";
import { runStartupBootstraps } from "../bootstrap/startup";
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";

const LEGACY_TENANT_ID = "00000000-0000-4000-8000-000000000001";

class RollbackProbe extends Error {}

async function expectRollbackProbe(
    name: string,
    probe: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
    try {
        await prisma.$transaction(async (tx) => {
            await probe(tx);
            throw new RollbackProbe(name);
        });
    } catch (error) {
        if (error instanceof RollbackProbe) return;
        throw error;
    }
}

async function expectConstraintProbe(
    name: string,
    expectedMessage: RegExp,
    probe: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
    try {
        await prisma.$transaction(probe);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (expectedMessage.test(message)) return;
        throw new Error(`${name} falló con un error inesperado: ${message}`);
    }
    throw new Error(`${name} no fue rechazado por PostgreSQL`);
}

async function main(): Promise<void> {
    await runStartupBootstraps(envs.DATABASE_URL);

    const [
        legacyTenant,
        users,
        memberships,
        usersWithoutMembership,
        checkpoints,
        tenantAuditRows,
    ] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: LEGACY_TENANT_ID } }),
        prisma.user.count(),
        prisma.tenantMembership.count(),
        prisma.user.count({
            where: { tenantMemberships: { none: {} } },
        }),
        prisma.tenantMigrationCheckpoint.count({ where: { tenantId: LEGACY_TENANT_ID } }),
        prisma.$queryRaw<Array<{ count: bigint }>>(
            Prisma.sql`
                SELECT COUNT(*)::bigint AS count
                FROM "AuditLog"
                WHERE "tenantId" IS NOT NULL
            `,
        ),
    ]);
    if (!legacyTenant || legacyTenant.slug !== "legacy-main") {
        throw new Error("No existe el tenant heredado estable");
    }
    if (usersWithoutMembership !== 0 || memberships < users) {
        throw new Error(
            `Usuarios sin empresa: usuarios=${users}, membresías=${memberships}, sinMembresía=${usersWithoutMembership}`,
        );
    }
    if (checkpoints !== 9) {
        throw new Error(`Se esperaban 9 checkpoints MIG-003..MIG-011 y existen ${checkpoints}`);
    }

    const owner = await prisma.user.findFirst({
        where: { isActive: true },
        orderBy: { id: "asc" },
        select: { id: true },
    });
    if (!owner) {
        throw new Error("Se requiere al menos un usuario activo para probar membresías");
    }

    const suffix = Date.now().toString().slice(-9);
    const trialSlug = `verify-trial-${suffix}`;
    const activeSlug = `verify-active-${suffix}`;
    const ruc = `20${suffix}`;

    await expectRollbackProbe("creación trial/active", async (tx) => {
        const trial = await tx.tenant.create({
            data: {
                slug: trialSlug,
                name: "Verificación trial",
                kind: TenantKind.TRIAL,
                status: TenantStatus.TRIAL,
                databaseMode: "SHARED",
                trialStartedAt: new Date(),
                trialEndsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
            },
        });
        const active = await tx.tenant.create({
            data: {
                slug: activeSlug,
                name: "Verificación active",
                status: TenantStatus.ACTIVE,
                databaseMode: "SHARED",
                ruc,
                rucConfirmedAt: new Date(),
            },
        });
        if (
            trial.kind !== TenantKind.TRIAL
            || trial.ruc !== null
            || active.kind !== TenantKind.CUSTOMER
            || active.databaseMode !== "SHARED"
        ) {
            throw new Error("Los defaults de tenant no coinciden");
        }
    });

    await expectConstraintProbe(
        "RUC activo único",
        /Tenant_active_confirmed_ruc_key|Unique constraint/i,
        async (tx) => {
            await tx.tenant.create({
                data: {
                    slug: `${activeSlug}-a`,
                    name: "RUC A",
                    status: TenantStatus.ACTIVE,
                    ruc,
                    rucConfirmedAt: new Date(),
                },
            });
            await tx.tenant.create({
                data: {
                    slug: `${activeSlug}-b`,
                    name: "RUC B",
                    status: TenantStatus.ACTIVE,
                    ruc,
                    rucConfirmedAt: new Date(),
                },
            });
        },
    );

    await expectConstraintProbe(
        "ID de tenant inmutable",
        /Tenant\.id es inmutable/i,
        async (tx) => {
            const tenant = await tx.tenant.create({
                data: {
                    slug: `${trialSlug}-immutable`,
                    name: "ID inmutable",
                    kind: TenantKind.TRIAL,
                    status: TenantStatus.TRIAL,
                },
            });
            await tx.$executeRaw(
                Prisma.sql`
                    UPDATE "Tenant"
                    SET "id" = gen_random_uuid()
                    WHERE "id" = ${tenant.id}::uuid
                `,
            );
        },
    );

    await expectConstraintProbe(
        "último propietario protegido",
        /último propietario activo/i,
        async (tx) => {
            const tenant = await tx.tenant.create({
                data: {
                    slug: `${trialSlug}-owner`,
                    name: "Owner protegido",
                    kind: TenantKind.TRIAL,
                    status: TenantStatus.TRIAL,
                },
            });
            const membership = await tx.tenantMembership.create({
                data: {
                    tenantId: tenant.id,
                    userId: owner.id,
                    role: TenantMembershipRole.OWNER,
                    status: TenantMembershipStatus.ACTIVE,
                    activatedAt: new Date(),
                },
            });
            await tx.tenantMembership.update({
                where: { id: membership.id },
                data: {
                    status: TenantMembershipStatus.INACTIVE,
                    deactivatedAt: new Date(),
                },
            });
        },
    );

    console.info("[tenant-verify] READY");
    console.info(`[tenant-verify] Tenant inicial: ${legacyTenant.slug} (${legacyTenant.status})`);
    console.info(`[tenant-verify] Usuarios/membresías: ${users}/${memberships}`);
    console.info(`[tenant-verify] Checkpoints registrados: ${checkpoints}`);
    console.info(`[tenant-verify] Logs con contexto tenant: ${Number(tenantAuditRows[0]?.count ?? 0n)}`);
    console.info("[tenant-verify] TRIAL/ACTIVE, RUC único, ID inmutable y último OWNER verificados");
}

main()
    .catch((error) => {
        console.error("[tenant-verify] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
