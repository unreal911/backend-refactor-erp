import { createHash } from "node:crypto";
import {
    Prisma,
    TenantMembershipRole,
    TenantMembershipStatus,
    TenantMigrationStatus,
} from "@prisma/client";
import { prisma } from "../../data/prisma";
import { LEGACY_TENANT_ID } from "./tenant-data-context";

const LEGACY_BASELINE = {
    users: 3,
    roles: 6,
    permissions: 47,
    rolePermissions: 78,
} as const;

const USER_REFERENCES = [
    ["InventoryMovement", "responsibleUserId"],
    ["StockTransfer", "createdById"],
    ["StockTransfer", "receivedById"],
    ["Reservation", "reservedById"],
    ["PickingSession", "assignedUserId"],
    ["Order", "sellerUserId"],
    ["Order", "pickerUserId"],
    ["Order", "dispenserUserId"],
    ["Order", "cancelledByUserId"],
    ["Order", "returnResponsibleUserId"],
    ["Order", "returnResponsibilityDelegatedById"],
    ["OrderItem", "removedById"],
    ["OrderReturn", "responsibleUserId"],
    ["PickingSharedResponsibility", "userId"],
    ["PickingSharedResponsibility", "assignedByUserId"],
    ["PickingResponsibilityRequest", "requesterUserId"],
    ["PickingResponsibilityRequest", "resolvedByUserId"],
    ["PickingItemContribution", "userId"],
    ["PickingUnpickRequest", "requesterUserId"],
    ["PickingUnpickRequest", "resolvedByUserId"],
    ["UserActivityLog", "userId"],
    ["AuditLog", "actorUserId"],
] as const;

type ReferenceStat = {
    table: string;
    column: string;
    populated: number;
    orphaned: number;
    crossTenant: number;
};

export type IdentityReconciliationSummary = {
    sourceUserIds: number[];
    ownerUserId: number;
    userCount: number;
    roleCount: number;
    permissionCount: number;
    rolePermissionCount: number;
    compatiblePasswordCount: number;
    referenceCount: number;
    populatedReferences: number;
    tenantMembershipForeignKeys: number;
    fingerprints: {
        users: string;
        passwordHashes: string;
        rolePermissionMatrix: string;
        references: string;
    };
};

function digest(value: unknown): string {
    return createHash("sha256")
        .update(JSON.stringify(value))
        .digest("hex");
}

function quoteIdentifier(value: string): string {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(value)) {
        throw new Error(`Identificador SQL no permitido: ${value}`);
    }
    return `"${value}"`;
}

function expectedMembershipRole(
    userId: number,
    ownerUserId: number,
    legacyRoleName: string,
): TenantMembershipRole {
    if (userId === ownerUserId) return TenantMembershipRole.OWNER;
    const normalized = legacyRoleName.trim().toUpperCase();
    if (normalized === "ADMIN" || normalized === "MANAGER") {
        return TenantMembershipRole.ADMIN;
    }
    if (normalized === "SELLER") return TenantMembershipRole.SELLER;
    return TenantMembershipRole.VIEWER;
}

async function inspectReference(
    table: string,
    column: string,
): Promise<ReferenceStat> {
    const tableName = quoteIdentifier(table);
    const columnName = quoteIdentifier(column);
    const rows = await prisma.$queryRawUnsafe<Array<{
        populated: bigint;
        orphaned: bigint;
        cross_tenant: bigint;
    }>>(
        `SELECT
            COUNT(*) FILTER (
                WHERE ref.${columnName} IS NOT NULL
            )::bigint AS populated,
            COUNT(*) FILTER (
                WHERE ref.${columnName} IS NOT NULL
                  AND actor."id" IS NULL
            )::bigint AS orphaned,
            COUNT(*) FILTER (
                WHERE ref.${columnName} IS NOT NULL
                  AND ref."tenantId" IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1
                      FROM "TenantMembership" membership
                      WHERE membership."userId" = ref.${columnName}
                        AND membership."tenantId" = ref."tenantId"
                  )
            )::bigint AS cross_tenant
         FROM ${tableName} ref
         LEFT JOIN "User" actor ON actor."id" = ref.${columnName}`,
    );
    const row = rows[0];
    return {
        table,
        column,
        populated: Number(row?.populated ?? 0n),
        orphaned: Number(row?.orphaned ?? 0n),
        crossTenant: Number(row?.cross_tenant ?? 0n),
    };
}

async function assertGlobalRbacClassification(): Promise<void> {
    const rows = await prisma.$queryRaw<Array<{
        table_name: string;
        description: string | null;
    }>>(Prisma.sql`
        SELECT table_name, obj_description(
            format('%I.%I', current_schema(), table_name)::regclass,
            'pg_class'
        ) AS description
        FROM (
            VALUES ('Role'), ('Permission'), ('RolePermission')
        ) classified(table_name)
    `);

    const missing = rows.filter(
        (row) => !String(row.description || "").includes("PLATFORM_GLOBAL"),
    );
    if (missing.length > 0) {
        throw new Error(
            `Catálogos RBAC sin clasificación global: ${missing.map((row) => row.table_name).join(", ")}`,
        );
    }
}

export async function inspectIdentityMigration(): Promise<IdentityReconciliationSummary> {
    const checkpoint = await prisma.tenantMigrationCheckpoint.findUnique({
        where: {
            tenantId_storyId: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-003",
            },
        },
        select: { details: true },
    });
    const checkpointDetails = checkpoint?.details as {
        sourceUserIds?: unknown;
    } | null;
    const sealedSourceUserIds = Array.isArray(checkpointDetails?.sourceUserIds)
        ? checkpointDetails.sourceUserIds.filter(
            (value): value is number => Number.isInteger(value) && Number(value) > 0,
        )
        : [];
    const users = await prisma.user.findMany({
        ...(sealedSourceUserIds.length > 0
            ? { where: { id: { in: sealedSourceUserIds } } }
            : {}),
        orderBy: { id: "asc" },
        include: {
            role: {
                select: {
                    id: true,
                    name: true,
                    isActive: true,
                },
            },
            tenantMemberships: {
                where: { tenantId: LEGACY_TENANT_ID },
                select: {
                    id: true,
                    role: true,
                    status: true,
                },
            },
        },
    });
    const roles = await prisma.role.findMany({
        orderBy: { id: "asc" },
        include: {
            rolePermissions: {
                orderBy: [{ permissionId: "asc" }, { id: "asc" }],
                include: {
                    permission: {
                        select: {
                            id: true,
                            code: true,
                            isActive: true,
                        },
                    },
                },
            },
        },
    });
    const [permissionCount, rolePermissionCount] = await Promise.all([
        prisma.permission.count(),
        prisma.rolePermission.count(),
    ]);

    if (
        users.length !== LEGACY_BASELINE.users
        || roles.length !== LEGACY_BASELINE.roles
        || permissionCount !== LEGACY_BASELINE.permissions
        || rolePermissionCount !== LEGACY_BASELINE.rolePermissions
    ) {
        throw new Error(
            "Los conteos RBAC no coinciden con la línea base "
            + `(User ${users.length}/${LEGACY_BASELINE.users}, `
            + `Role ${roles.length}/${LEGACY_BASELINE.roles}, `
            + `Permission ${permissionCount}/${LEGACY_BASELINE.permissions}, `
            + `RolePermission ${rolePermissionCount}/${LEGACY_BASELINE.rolePermissions})`,
        );
    }
    if (
        sealedSourceUserIds.length > 0
        && users.some((user) => !sealedSourceUserIds.includes(user.id))
    ) {
        throw new Error("Los IDs de usuario no coinciden con el alcance heredado sellado");
    }

    const normalizedEmails = new Map<string, number[]>();
    for (const user of users) {
        const normalized = user.email.trim().toLowerCase();
        normalizedEmails.set(
            normalized,
            [...(normalizedEmails.get(normalized) || []), user.id],
        );
    }
    const duplicates = [...normalizedEmails.values()].filter((ids) => ids.length > 1);
    if (duplicates.length > 0) {
        throw new Error(
            `Correos duplicados requieren decisión manual; grupos=${duplicates.length}`,
        );
    }

    const incompatiblePasswordUserIds = users
        .filter((user) => !/^\$2[aby]\$\d{2}\$.{53}$/.test(user.password))
        .map((user) => user.id);
    if (incompatiblePasswordUserIds.length > 0) {
        throw new Error(
            `Hashes incompatibles requieren restablecimiento explícito; userIds=${incompatiblePasswordUserIds.join(",")}`,
        );
    }

    for (const user of users) {
        if (user.tenantMemberships.length !== 1) {
            throw new Error(
                `El usuario ${user.id} no tiene exactamente una membresía heredada`,
            );
        }
        const membership = user.tenantMemberships[0]!;
        const expectedStatus = user.isActive
            ? TenantMembershipStatus.ACTIVE
            : TenantMembershipStatus.INACTIVE;
        if (membership.status !== expectedStatus) {
            throw new Error(
                `Estado de membresía incompatible para usuario ${user.id}`,
            );
        }
    }

    const owners = users.filter((user) => {
        const membership = user.tenantMemberships[0];
        return membership?.role === TenantMembershipRole.OWNER
            && membership.status === TenantMembershipStatus.ACTIVE;
    });
    if (owners.length !== 1) {
        throw new Error(`Se esperaba un OWNER heredado activo y existen ${owners.length}`);
    }
    const ownerUserId = owners[0]!.id;

    for (const user of users) {
        const expectedRole = expectedMembershipRole(
            user.id,
            ownerUserId,
            user.role.name,
        );
        if (user.tenantMemberships[0]!.role !== expectedRole) {
            throw new Error(
                `Mapeo de rol incompatible para usuario ${user.id}: `
                + `${user.tenantMemberships[0]!.role}/${expectedRole}`,
            );
        }
    }

    const references = await Promise.all(
        USER_REFERENCES.map(([table, column]) => inspectReference(table, column)),
    );
    const invalidReferences = references.filter(
        (reference) => reference.orphaned > 0 || reference.crossTenant > 0,
    );
    if (invalidReferences.length > 0) {
        throw new Error(
            `Referencias de usuario inválidas: ${
                invalidReferences
                    .map((reference) => `${reference.table}.${reference.column}`)
                    .join(", ")
            }`,
        );
    }

    const tenantMembershipForeignKeys = Number(
        (await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count
            FROM pg_constraint
            WHERE contype = 'f'
              AND confrelid = '"TenantMembership"'::regclass
        `))[0]?.count ?? 0n,
    );
    if (tenantMembershipForeignKeys < 21) {
        throw new Error(
            `Faltan referencias compuestas a membresía: ${tenantMembershipForeignKeys}/21`,
        );
    }
    await assertGlobalRbacClassification();

    const rolePermissionMatrix = roles.flatMap((role) =>
        role.rolePermissions.map((relation) => ({
            roleId: role.id,
            roleName: role.name,
            roleActive: role.isActive,
            permissionId: relation.permission.id,
            permissionCode: relation.permission.code,
            permissionActive: relation.permission.isActive,
        })),
    );
    const userFingerprintRows = users.map((user) => ({
        id: user.id,
        emailDigest: digest(user.email.trim().toLowerCase()),
        roleId: user.role.id,
        active: user.isActive,
    }));
    const passwordFingerprintRows = users.map((user) => ({
        id: user.id,
        passwordDigest: digest(user.password),
    }));

    return {
        sourceUserIds: users.map((user) => user.id),
        ownerUserId,
        userCount: users.length,
        roleCount: roles.length,
        permissionCount,
        rolePermissionCount,
        compatiblePasswordCount: users.length,
        referenceCount: references.length,
        populatedReferences: references.reduce(
            (total, reference) => total + reference.populated,
            0,
        ),
        tenantMembershipForeignKeys,
        fingerprints: {
            users: digest(userFingerprintRows),
            passwordHashes: digest(passwordFingerprintRows),
            rolePermissionMatrix: digest(rolePermissionMatrix),
            references: digest(references),
        },
    };
}

export async function reconcileIdentityMigration(): Promise<IdentityReconciliationSummary> {
    const checkpoint = await prisma.tenantMigrationCheckpoint.findUnique({
        where: {
            tenantId_storyId: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-003",
            },
        },
    });
    if (!checkpoint) {
        throw new Error("No existe el checkpoint MIG-003 para legacy-main");
    }

    const startedAt = checkpoint.startedAt ?? new Date();
    await prisma.tenantMigrationCheckpoint.update({
        where: { id: checkpoint.id },
        data: {
            status: TenantMigrationStatus.RUNNING,
            startedAt,
            completedAt: null,
        },
    });

    try {
        const summary = await inspectIdentityMigration();
        const completedAt = new Date();
        await prisma.tenantMigrationCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
                status: TenantMigrationStatus.COMPLETED,
                completedAt,
                details: {
                    version: 1,
                    transformation: "IN_PLACE",
                    tenantId: LEGACY_TENANT_ID,
                    policy: "docs/migration/identity-reconciliation-policy.md",
                    baselineReport:
                        "legacy-baseline-2026-07-29T16-27-05-069Z.json",
                    postMigrationReport:
                        "legacy-baseline-2026-07-29T16-29-38-688Z.json",
                    ...summary,
                } as Prisma.InputJsonObject,
            },
        });
        return summary;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.tenantMigrationCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
                status: TenantMigrationStatus.FAILED,
                completedAt: null,
                details: {
                    version: 1,
                    policy: "docs/migration/identity-reconciliation-policy.md",
                    failure: message.slice(0, 500),
                },
            },
        }).catch(() => undefined);
        throw error;
    }
}
