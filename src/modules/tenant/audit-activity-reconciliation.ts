import { createHash } from "node:crypto";
import { Prisma, TenantMigrationStatus } from "@prisma/client";
import { prisma } from "../../data/prisma";
import { LEGACY_TENANT_ID } from "./tenant-data-context";

export const MIG010_CUTOFF = new Date("2026-07-29T16:27:05.069Z");

type SnapshotRow = { id: number; data: string };
type Group = { value: string; count: number };

const EXPECTED = {
    auditCount: 30418,
    activityCount: 509,
    auditFingerprint:
        "9c5d5ad50eb4b6c32bf2f96f44cb9fb26216f0605d56e9a38ac2c7471e832c13",
    activityFingerprint:
        "07c922d8473214bc43e870c453d83e6e74bf30ed64136b1cd35a91fd47005b4e",
    auditScopes: [
        { value: "QUARANTINE", count: 607 },
        { value: "TENANT", count: 29811 },
    ],
    auditMethods: [
        { value: "GET", count: 29610 },
        { value: "PATCH", count: 258 },
        { value: "POST", count: 542 },
        { value: "PUT", count: 8 },
    ],
    activityModules: [
        { value: "INVENTORY", count: 16 },
        { value: "ORDERS", count: 317 },
        { value: "PICKING", count: 157 },
        { value: "POS", count: 19 },
    ],
} as const;

const REDACTED_KEYS =
    /(password|token|secret|authorization|cookie|apikey|api_key|access|refresh|card|cvv|p12|pfx|cert|email|phone|telefono|address|direccion|document|dni|ruc)/i;

export type AuditActivityReconciliationSummary = {
    auditLogIds: number[];
    activityLogIds: number[];
    counts: {
        auditLogs: number;
        tenantAuditLogs: number;
        quarantinedAuditLogs: number;
        activityLogs: number;
    };
    auditScopes: Group[];
    auditMethods: Group[];
    auditStatuses: Group[];
    activityModules: Group[];
    activityActions: Group[];
    activityEntities: Group[];
    periodGroups: Array<{
        scope: "AUDIT" | "ACTIVITY";
        period: string;
        count: number;
    }>;
    attribution: {
        tenantByActorOrCapturedContext: number;
        quarantinedAmbiguous: number;
        activityByUserMembership: number;
    };
    sanitization: {
        unsafeAuditFields: number;
        unsafeActivityFields: number;
    };
    idMapping: {
        strategy: "IDENTITY";
        validUsers: number;
        validOrders: number;
        validInventoryMovements: number;
        preservedDeletedEntityReferences: number;
    };
    retention: {
        policy: "PRESERVE_FULL_MIG001_BASELINE";
        cutoff: string;
        excludedPostCutoffAuditRows: number;
        excludedPostCutoffActivityRows: number;
    };
    invalidScopeRows: number;
    tenantConstraintCount: number;
    fingerprints: {
        auditLogs: string;
        activityLogs: string;
        logicalHistory: string;
    };
};

function digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parsed(rows: SnapshotRow[]): Array<Record<string, unknown>> {
    return rows.map((row) => JSON.parse(row.data));
}

function groups(
    rows: Array<Record<string, unknown>>,
    key: string,
): Group[] {
    const result = new Map<string, number>();
    for (const row of rows) {
        const value = String(row[key] ?? "(NULL)");
        result.set(value, (result.get(value) ?? 0) + 1);
    }
    return [...result.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((left, right) => left.value.localeCompare(right.value));
}

function unsafeFields(value: unknown): number {
    if (!value || typeof value !== "object") return 0;
    let count = 0;
    for (const [key, child] of Object.entries(
        value as Record<string, unknown>,
    )) {
        if (REDACTED_KEYS.test(key) && child !== "[redacted]") count += 1;
        count += unsafeFields(child);
    }
    return count;
}

function completedEvidence(
    status: TenantMigrationStatus | undefined,
    details: Prisma.JsonValue | null | undefined,
): boolean {
    if (status === TenantMigrationStatus.COMPLETED) return true;
    return Boolean(
        details
        && typeof details === "object"
        && !Array.isArray(details)
        && (details as Record<string, unknown>).version === 1
        && (details as Record<string, unknown>).fingerprints,
    );
}

export async function inspectAuditActivityMigration():
Promise<AuditActivityReconciliationSummary> {
    const dependency = await prisma.tenantMigrationCheckpoint.findUnique({
        where: {
            tenantId_storyId: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-009",
            },
        },
        select: { status: true, details: true },
    });
    if (!completedEvidence(dependency?.status, dependency?.details)) {
        throw new Error("MIG-009 debe estar COMPLETED antes de MIG-010");
    }

    const [auditRows, activityRows, totals, references, constraintRows] =
        await Promise.all([
            prisma.$queryRawUnsafe<SnapshotRow[]>(
                `SELECT id, (to_jsonb(t) - 'correlationId')::text AS data
                 FROM "AuditLog" t
                 WHERE "createdAt"<=$1
                 ORDER BY id`,
                MIG010_CUTOFF,
            ),
            prisma.$queryRawUnsafe<SnapshotRow[]>(
                `SELECT id, to_jsonb(t)::text AS data
                 FROM "UserActivityLog" t
                 WHERE "createdAt"<=$1
                 ORDER BY id`,
                MIG010_CUTOFF,
            ),
            prisma.$queryRawUnsafe<Array<{
                audit_total: number;
                activity_total: number;
                invalid_scope: number;
            }>>(
                `SELECT
                    (SELECT COUNT(*)::int FROM "AuditLog") AS audit_total,
                    (SELECT COUNT(*)::int FROM "UserActivityLog")
                        AS activity_total,
                    (SELECT COUNT(*)::int
                     FROM "AuditLog"
                     WHERE ("dataScope"='TENANT' AND "tenantId" IS NULL)
                        OR ("dataScope" IN ('PLATFORM','QUARANTINE')
                            AND "tenantId" IS NOT NULL)) AS invalid_scope`,
            ),
            prisma.$queryRawUnsafe<Array<{
                valid_users: number;
                valid_orders: number;
                valid_movements: number;
                deleted_entities: number;
            }>>(
                `SELECT
                    COUNT(*) FILTER (WHERE usr.id IS NOT NULL)::int
                        AS valid_users,
                    COUNT(*) FILTER (
                        WHERE log."entityType"='ORDER' AND ord.id IS NOT NULL
                    )::int AS valid_orders,
                    COUNT(*) FILTER (
                        WHERE log."entityType"='INVENTORY_MOVEMENT'
                          AND movement.id IS NOT NULL
                    )::int AS valid_movements,
                    COUNT(*) FILTER (
                        WHERE log."entityType"='ORDER' AND ord.id IS NULL
                    )::int AS deleted_entities
                 FROM "UserActivityLog" log
                 LEFT JOIN "User" usr ON usr.id=log."userId"
                 LEFT JOIN "Order" ord ON ord.id=log."entityId"
                 LEFT JOIN "InventoryMovement" movement
                   ON movement.id=log."entityId"
                 WHERE log."createdAt"<=$1`,
                MIG010_CUTOFF,
            ),
            prisma.$queryRaw<Array<{
                conname: string;
                convalidated: boolean;
            }>>`
                SELECT conname, convalidated
                FROM pg_constraint
                WHERE conname IN (
                    'AuditLog_data_scope_check',
                    'UserActivityLog_tenantId_fkey',
                    'UserActivityLog_user_tenant_fkey'
                )
            `,
        ]);
    if (
        auditRows.length !== EXPECTED.auditCount
        || activityRows.length !== EXPECTED.activityCount
    ) {
        throw new Error(
            `Conteos MIG-010 inesperados: `
            + `${auditRows.length}/${activityRows.length}`,
        );
    }

    const audits = parsed(auditRows);
    const activities = parsed(activityRows);
    const auditScopes = groups(audits, "dataScope");
    const auditMethods = groups(audits, "method");
    const auditStatuses = groups(audits, "statusCode");
    const activityModules = groups(activities, "module");
    const activityActions = groups(activities, "actionType");
    const activityEntities = groups(activities, "entityType");
    if (
        JSON.stringify(auditScopes) !== JSON.stringify(EXPECTED.auditScopes)
        || JSON.stringify(auditMethods) !== JSON.stringify(EXPECTED.auditMethods)
        || JSON.stringify(activityModules)
            !== JSON.stringify(EXPECTED.activityModules)
    ) {
        throw new Error("Agrupaciones históricas MIG-010 inesperadas");
    }

    const unsafeAuditFields = audits.reduce(
        (sum, row) => sum
            + unsafeFields(row.requestQuery)
            + unsafeFields(row.requestParams)
            + unsafeFields(row.requestBody),
        0,
    );
    const unsafeActivityFields = activities.reduce(
        (sum, row) => sum
            + unsafeFields(row.products)
            + unsafeFields(row.context),
        0,
    );
    if (unsafeAuditFields !== 0 || unsafeActivityFields !== 0) {
        throw new Error("Persisten datos sensibles sin redactar");
    }

    const periodGroups = ([
        ["AUDIT", audits],
        ["ACTIVITY", activities],
    ] as const).flatMap(([scope, rows]) =>
        groups(
            rows.map((row) => ({
                period: String(row.createdAt).slice(0, 7),
            })),
            "period",
        ).map((group) => ({
            scope,
            period: group.value,
            count: group.count,
        }))
    );
    const fingerprints = {
        auditLogs: digest(auditRows.map((row) => row.data)),
        activityLogs: digest(activityRows.map((row) => row.data)),
        logicalHistory: digest({
            auditScopes,
            auditMethods,
            auditStatuses,
            activityModules,
            activityActions,
            activityEntities,
            periodGroups,
        }),
    };
    if (
        fingerprints.auditLogs !== EXPECTED.auditFingerprint
        || fingerprints.activityLogs !== EXPECTED.activityFingerprint
    ) {
        throw new Error("Huellas históricas MIG-010 inesperadas");
    }
    const reference = references[0]!;
    if (
        reference.valid_users !== 509
        || reference.valid_orders !== 492
        || reference.valid_movements !== 16
        || reference.deleted_entities !== 1
    ) {
        throw new Error("Mapa histórico de IDs inesperado");
    }
    if (
        constraintRows.length !== 3
        || constraintRows.some((row) => !row.convalidated)
    ) {
        throw new Error("Restricciones de trazabilidad incompletas");
    }
    const total = totals[0]!;
    if (total.invalid_scope !== 0) {
        throw new Error("AuditLog contiene alcances inválidos");
    }

    return {
        auditLogIds: auditRows.map((row) => row.id),
        activityLogIds: activityRows.map((row) => row.id),
        counts: {
            auditLogs: auditRows.length,
            tenantAuditLogs: 29811,
            quarantinedAuditLogs: 607,
            activityLogs: activityRows.length,
        },
        auditScopes,
        auditMethods,
        auditStatuses,
        activityModules,
        activityActions,
        activityEntities,
        periodGroups,
        attribution: {
            tenantByActorOrCapturedContext: 29811,
            quarantinedAmbiguous: 607,
            activityByUserMembership: 509,
        },
        sanitization: { unsafeAuditFields, unsafeActivityFields },
        idMapping: {
            strategy: "IDENTITY",
            validUsers: reference.valid_users,
            validOrders: reference.valid_orders,
            validInventoryMovements: reference.valid_movements,
            preservedDeletedEntityReferences: reference.deleted_entities,
        },
        retention: {
            policy: "PRESERVE_FULL_MIG001_BASELINE",
            cutoff: MIG010_CUTOFF.toISOString(),
            excludedPostCutoffAuditRows:
                total.audit_total - auditRows.length,
            excludedPostCutoffActivityRows:
                total.activity_total - activityRows.length,
        },
        invalidScopeRows: total.invalid_scope,
        tenantConstraintCount: constraintRows.length,
        fingerprints,
    };
}

export async function reconcileAuditActivityMigration():
Promise<AuditActivityReconciliationSummary> {
    const checkpoint = await prisma.tenantMigrationCheckpoint.findUnique({
        where: {
            tenantId_storyId: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-010",
            },
        },
    });
    if (!checkpoint) throw new Error("No existe el checkpoint MIG-010");
    await prisma.tenantMigrationCheckpoint.update({
        where: { id: checkpoint.id },
        data: {
            status: TenantMigrationStatus.RUNNING,
            startedAt: checkpoint.startedAt ?? new Date(),
            completedAt: null,
        },
    });
    try {
        const summary = await inspectAuditActivityMigration();
        await prisma.tenantMigrationCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
                status: TenantMigrationStatus.COMPLETED,
                completedAt: new Date(),
                details: {
                    version: 1,
                    transformation: "IN_PLACE",
                    policy:
                        "docs/migration/audit-activity-reconciliation-policy.md",
                    baselineReport:
                        "legacy-baseline-2026-07-29T16-27-05-069Z.json",
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
                    failure: message.slice(0, 500),
                },
            },
        }).catch(() => undefined);
        throw error;
    }
}
