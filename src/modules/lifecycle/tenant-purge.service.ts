import { Prisma, TenantStatus } from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";

type TenantTable = { tableName: string };

const DEFAULT_BATCH_SIZE = 500;
const MAX_DELETE_OPERATIONS = 100_000;
const RETAINED_TABLES = new Set(["TenantLifecycleEvent"]);

function batchSize(): number {
    const configured = Number(process.env.TENANT_PURGE_BATCH_SIZE ?? DEFAULT_BATCH_SIZE);
    return Number.isFinite(configured)
        ? Math.min(5_000, Math.max(10, Math.floor(configured)))
        : DEFAULT_BATCH_SIZE;
}

function assertSafeIdentifier(value: string): string {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
        throw new Error("Nombre de tabla no permitido en purga");
    }
    return value;
}

function isForeignKeyViolation(caught: unknown): boolean {
    const message = caught instanceof Error ? `${caught.name} ${caught.message}` : String(caught);
    let details = "";
    try {
        details = JSON.stringify(caught);
    } catch {
        details = "";
    }
    return `${message} ${details}`.includes("23503") || /foreign key constraint/i.test(message);
}

export type TenantPurgeResult = {
    tenantId: string;
    purged: boolean;
    deletedRows: number;
    batches: number;
    deletedUsers: number;
};

/**
 * Purga fisica por lotes. Cada DELETE es una transaccion corta, por lo que un
 * reintento continua desde los registros restantes sin cursores fragiles.
 */
export class TenantPurgeService {
    static async purgeExpiredTenant(tenantId: string, now: Date): Promise<TenantPurgeResult> {
        const tenant = await platformPrisma.tenant.findFirst({
            where: {
                id: tenantId,
                OR: [
                    { status: TenantStatus.EXPIRED, graceEndsAt: { lte: now } },
                    {
                        status: TenantStatus.PURGED,
                        lifecycleEvents: { none: { type: "TRIAL_PURGED" } },
                    },
                ],
            },
            select: { id: true, status: true },
        });
        if (!tenant) {
            return { tenantId, purged: false, deletedRows: 0, batches: 0, deletedUsers: 0 };
        }

        const pendingArtifacts = await platformPrisma.sunatArtifact.count({
            where: { tenantId, storageStatus: { not: "DELETED" } },
        });
        if (pendingArtifacts > 0) throw new Error("PURGE_REQUIRES_DOCUMENT_STORAGE");

        if (tenant.status !== TenantStatus.PURGED) {
            await platformPrisma.tenant.update({
                where: { id: tenantId },
                data: {
                    slug: `purged-${tenantId}`,
                    name: "Tenant purgado",
                    legalName: null,
                    ruc: null,
                    rucConfirmedAt: null,
                    status: TenantStatus.PURGED,
                    purgedAt: now,
                    sunatProductionEnabled: false,
                    productionApprovedAt: null,
                    productionApprovedById: null,
                    contactEmail: null,
                    contactPhone: null,
                    address: null,
                    logoUrl: null,
                },
            });
        }

        const memberships = await platformPrisma.tenantMembership.findMany({
            where: { tenantId },
            select: { userId: true },
        });
        await platformPrisma.ownerRegistration.deleteMany({
            where: { provisionedTenantId: tenantId },
        });

        const descriptors = await platformPrisma.$queryRaw<TenantTable[]>(Prisma.sql`
            SELECT DISTINCT columns.table_name AS "tableName"
            FROM information_schema.columns AS columns
            INNER JOIN information_schema.columns AS identity_column
                ON identity_column.table_schema = columns.table_schema
               AND identity_column.table_name = columns.table_name
               AND identity_column.column_name = 'id'
            WHERE columns.table_schema = 'public'
              AND columns.column_name = 'tenantId'
            ORDER BY columns.table_name
        `);
        const tables = descriptors
            .map((descriptor) => assertSafeIdentifier(descriptor.tableName))
            .filter((tableName) => !RETAINED_TABLES.has(tableName));

        let deletedRows = 0;
        let batches = 0;
        let operations = 0;
        let madeProgress = true;
        while (madeProgress) {
            madeProgress = false;
            for (const tableName of tables) {
                if (++operations > MAX_DELETE_OPERATIONS) {
                    throw new Error("TENANT_PURGE_OPERATION_LIMIT_EXCEEDED");
                }
                const runningJobCondition = tableName === "SunatJob"
                    ? `AND NOT (candidate."status" = 'RUNNING')`
                    : "";
                try {
                    const count = await platformPrisma.$executeRawUnsafe(
                        `DELETE FROM "${tableName}" AS target
                         WHERE target.ctid IN (
                             SELECT candidate.ctid
                             FROM "${tableName}" AS candidate
                             WHERE candidate."tenantId" = $1::uuid
                             ${runningJobCondition}
                             LIMIT $2
                         )`,
                        tenantId,
                        batchSize(),
                    );
                    if (count > 0) {
                        deletedRows += count;
                        batches += 1;
                        madeProgress = true;
                    }
                } catch (caught) {
                    if (!isForeignKeyViolation(caught)) throw caught;
                }
            }
        }

        const remaining: Array<{ tableName: string; count: number }> = [];
        for (const tableName of tables) {
            const runningJobCondition = tableName === "SunatJob"
                ? `AND NOT ("status" = 'RUNNING')`
                : "";
            const rows = await platformPrisma.$queryRawUnsafe<Array<{ count: bigint }>>(
                `SELECT COUNT(*)::bigint AS count
                 FROM "${tableName}"
                 WHERE "tenantId" = $1::uuid ${runningJobCondition}`,
                tenantId,
            );
            remaining.push({ tableName, count: Number(rows[0]?.count ?? 0n) });
        }
        const blocked = remaining.filter((entry) => entry.count > 0);
        if (blocked.length > 0) {
            throw new Error(`TENANT_PURGE_BLOCKED:${blocked.map((entry) => `${entry.tableName}=${entry.count}`).join(",")}`);
        }

        await platformPrisma.$transaction(async (tx) => {
            await tx.tenantLifecycleEvent.updateMany({
                where: { tenantId },
                data: { actorUserId: null, metadata: Prisma.JsonNull },
            });
            await tx.tenantLifecycleEvent.create({
                data: { tenantId, type: "TRIAL_PURGED", source: "lifecycle-worker" },
            });
        });

        const candidateUserIds = [...new Set(memberships.map(({ userId }) => userId))];
        const deletedUsers = candidateUserIds.length === 0 ? 0 : (await platformPrisma.user.deleteMany({
            where: {
                id: { in: candidateUserIds },
                tenantMemberships: { none: {} },
                platformAdmin: null,
                trialRegistration: null,
            },
        })).count;

        return { tenantId, purged: true, deletedRows, batches, deletedUsers };
    }
}
