import { prisma } from "./prisma";

const LEGACY_TENANT_ID = "00000000-0000-4000-8000-000000000001";

export async function seedLegacyTenantMemberships(): Promise<void> {
    const checkpoint = await prisma.tenantMigrationCheckpoint.findUnique({
        where: {
            tenantId_storyId: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-003",
            },
        },
        select: {
            id: true,
            status: true,
            details: true,
        },
    });
    const details = checkpoint?.details as {
        sourceUserIds?: unknown;
    } | null;
    let sealedSourceUserIds = Array.isArray(details?.sourceUserIds)
        ? details.sourceUserIds.filter(
            (value): value is number => Number.isInteger(value) && Number(value) > 0,
        )
        : null;
    if (checkpoint?.status === "COMPLETED" && !sealedSourceUserIds?.length) {
        throw new Error("MIG-003 completado sin sourceUserIds verificables");
    }

    // Una instalación nueva aplica todas las migraciones antes del primer seed,
    // por lo que MIG-003 todavía no tenía usuarios que sellar. La primera
    // ejecución con usuarios fija el alcance una sola vez para no incorporar
    // silenciosamente cuentas creadas después.
    if (checkpoint && !sealedSourceUserIds?.length) {
        const sourceUsers = await prisma.user.findMany({
            orderBy: { id: "asc" },
            select: { id: true },
        });
        if (sourceUsers.length > 0) {
            sealedSourceUserIds = sourceUsers.map((user) => user.id);
            await prisma.tenantMigrationCheckpoint.update({
                where: { id: checkpoint.id },
                data: {
                    details: {
                        ...((details as Record<string, unknown> | null) ?? {}),
                        sourceUserIds: sealedSourceUserIds,
                        sourceUserIdsSealedBy: "seedLegacyTenantMemberships",
                    },
                },
            });
        }
    }

    await prisma.$executeRawUnsafe(
        `WITH ranked_users AS (
            SELECT
                u."id",
                u."isActive",
                r."name" AS role_name,
                COALESCE(
                    MIN(u."id") FILTER (
                        WHERE u."isActive" = true AND upper(r."name") = 'ADMIN'
                    ) OVER (),
                    MIN(u."id") FILTER (WHERE u."isActive" = true) OVER (),
                    MIN(u."id") OVER ()
                ) AS owner_user_id
            FROM "User" u
            JOIN "Role" r ON r."id" = u."roleId"
            WHERE $2::int[] IS NULL OR u."id" = ANY($2::int[])
        )
        INSERT INTO "TenantMembership" (
            "tenantId",
            "userId",
            "role",
            "status",
            "activatedAt",
            "deactivatedAt",
            "updatedAt"
        )
        SELECT
            $1::uuid,
            "id",
            CASE
                WHEN "id" = owner_user_id THEN 'OWNER'::"TenantMembershipRole"
                WHEN upper(role_name) = 'ADMIN' THEN 'ADMIN'::"TenantMembershipRole"
                WHEN upper(role_name) = 'MANAGER' THEN 'MANAGER'::"TenantMembershipRole"
                WHEN upper(role_name) = 'SELLER' THEN 'SELLER'::"TenantMembershipRole"
                WHEN upper(role_name) = 'WAREHOUSE' THEN 'WAREHOUSE'::"TenantMembershipRole"
                WHEN upper(role_name) = 'PICKER' THEN 'PICKER'::"TenantMembershipRole"
                ELSE 'VIEWER'::"TenantMembershipRole"
            END,
            CASE
                WHEN "isActive" THEN 'ACTIVE'::"TenantMembershipStatus"
                ELSE 'INACTIVE'::"TenantMembershipStatus"
            END,
            CASE WHEN "isActive" THEN CURRENT_TIMESTAMP ELSE NULL END,
            CASE WHEN "isActive" THEN NULL ELSE CURRENT_TIMESTAMP END,
            CURRENT_TIMESTAMP
        FROM ranked_users
        ON CONFLICT ("userId", "tenantId") DO NOTHING`,
        LEGACY_TENANT_ID,
        sealedSourceUserIds,
    );
}
