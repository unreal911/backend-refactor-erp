import { platformPrisma } from "../../data/platform-prisma";

type DependencyName = "S3" | "KMS" | "SUNAT";

type Counter = {
    operations: number;
    errors: number;
    durationMs: number;
    maxDurationMs: number;
};

type NoisyTrialRow = {
    tenantId: string;
    usersUsed: bigint;
    productsUsed: bigint;
    ordersUsed: bigint;
    storageUsed: bigint;
    maxUsers: number;
    maxProducts: number;
    maxOrders: number;
    maxStorageBytes: bigint;
    jobErrors: bigint;
};

export function summarizeTrialUsage(row: NoisyTrialRow) {
    const usage = {
        users: ratio(row.usersUsed, row.maxUsers),
        products: ratio(row.productsUsed, row.maxProducts),
        orders: ratio(row.ordersUsed, row.maxOrders),
        storage: ratio(row.storageUsed, row.maxStorageBytes),
    };
    return {
        tenantId: row.tenantId,
        highestQuotaRatio: Math.max(...Object.values(usage)),
        quotaRatios: usage,
        failedJobs: Number(row.jobErrors),
    };
}

const dependencyCounters = new Map<string, Counter>();
const apiDurations: number[] = [];
const apiByTenant = new Map<string, { requests: number; errors: number }>();
let apiRequests = 0;
let apiErrors = 0;
const startedAt = new Date();

function percentile(values: number[], ratio: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

function ratio(used: bigint | number, limit: bigint | number): number {
    const denominator = Number(limit);
    return denominator > 0 ? Number(used) / denominator : 0;
}

function dependencySnapshot(provider: DependencyName) {
    const entries = [...dependencyCounters.entries()]
        .filter(([key]) => key.startsWith(`${provider}:`))
        .map(([key, value]) => ({
            operation: key.slice(provider.length + 1),
            operations: value.operations,
            errors: value.errors,
            averageDurationMs: value.operations > 0
                ? Math.round(value.durationMs / value.operations)
                : 0,
            maxDurationMs: value.maxDurationMs,
        }));
    return {
        operations: entries.reduce((sum, entry) => sum + entry.operations, 0),
        errors: entries.reduce((sum, entry) => sum + entry.errors, 0),
        byOperation: entries,
    };
}

export class OperationalMetrics {
    static async measureDependency<T>(
        provider: DependencyName,
        operation: string,
        callback: () => Promise<T>,
    ): Promise<T> {
        const started = Date.now();
        try {
            const result = await callback();
            this.observeDependency(provider, operation, true, Date.now() - started);
            return result;
        } catch (caught) {
            this.observeDependency(provider, operation, false, Date.now() - started);
            throw caught;
        }
    }

    static observeApi(tenantId: string | null, statusCode: number, durationMs: number): void {
        apiRequests += 1;
        if (statusCode >= 500) apiErrors += 1;
        apiDurations.push(Math.max(0, Math.round(durationMs)));
        if (apiDurations.length > 2_000) apiDurations.splice(0, apiDurations.length - 2_000);
        if (!tenantId) return;
        const current = apiByTenant.get(tenantId) ?? { requests: 0, errors: 0 };
        current.requests += 1;
        if (statusCode >= 500) current.errors += 1;
        apiByTenant.set(tenantId, current);
        if (apiByTenant.size > 1_000) apiByTenant.delete(apiByTenant.keys().next().value as string);
    }

    static observeDependency(
        provider: DependencyName,
        operation: string,
        success: boolean,
        durationMs: number,
    ): void {
        const safeOperation = String(operation || "unknown").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 60);
        const key = `${provider}:${safeOperation}`;
        const current = dependencyCounters.get(key) ?? {
            operations: 0,
            errors: 0,
            durationMs: 0,
            maxDurationMs: 0,
        };
        current.operations += 1;
        if (!success) current.errors += 1;
        current.durationMs += Math.max(0, durationMs);
        current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
        dependencyCounters.set(key, current);
    }

    static async snapshot(now = new Date()) {
        const databaseStartedAt = Date.now();
        let databaseOk = true;
        let databaseError: string | null = null;
        try {
            await platformPrisma.$queryRawUnsafe("SELECT 1");
        } catch {
            databaseOk = false;
            databaseError = "DATABASE_UNAVAILABLE";
        }
        const databaseDurationMs = Date.now() - databaseStartedAt;

        const queueGroups = await platformPrisma.sunatJob.groupBy({
            by: ["status"],
            _count: { _all: true },
        });
        const oldestPending = await platformPrisma.sunatJob.findFirst({
            where: { status: { in: ["PENDING", "FAILED"] } },
            orderBy: { nextRunAt: "asc" },
            select: { nextRunAt: true },
        });
        const artifactGroups = await platformPrisma.sunatArtifact.groupBy({
            by: ["storageStatus"],
            _count: { _all: true },
            _sum: { sizeBytes: true },
        });
        const dispatchGroups = await platformPrisma.sunatDispatch.groupBy({
            by: ["status"],
            _count: { _all: true },
        });
        const noisyRows = await platformPrisma.$queryRawUnsafe<NoisyTrialRow[]>(`
            SELECT
                tenant."id" AS "tenantId",
                (SELECT COUNT(*) FROM "TenantMembership" membership
                    WHERE membership."tenantId" = tenant."id"
                      AND membership."status" IN ('ACTIVE', 'INVITED'))::bigint AS "usersUsed",
                (SELECT COUNT(*) FROM "Product" product
                    WHERE product."tenantId" = tenant."id")::bigint AS "productsUsed",
                (SELECT COUNT(*) FROM "Order" business_order
                    WHERE business_order."tenantId" = tenant."id")::bigint AS "ordersUsed",
                COALESCE((SELECT SUM(asset."sizeBytes") FROM "CommercialAsset" asset
                    WHERE asset."tenantId" = tenant."id"
                      AND asset."status" = 'ACTIVE'), 0)::bigint AS "storageUsed",
                tenant."maxUsers",
                tenant."maxProducts",
                tenant."maxOrders",
                tenant."maxStorageBytes",
                (SELECT COUNT(*) FROM "SunatJob" job
                    WHERE job."tenantId" = tenant."id"
                      AND job."status" IN ('FAILED', 'DEAD'))::bigint AS "jobErrors"
            FROM "Tenant" tenant
            WHERE tenant."kind" = 'TRIAL'
              AND tenant."status" IN ('TRIAL', 'EXPIRED')
            ORDER BY tenant."id"
            LIMIT 500
        `);

        const noisyTrials = noisyRows.map(summarizeTrialUsage)
            .filter((row) => row.highestQuotaRatio >= 0.8 || row.failedJobs > 0)
            .sort((left, right) => (
                right.highestQuotaRatio - left.highestQuotaRatio || right.failedJobs - left.failedJobs
            ));

        const queue = Object.fromEntries(queueGroups.map((group) => [group.status, group._count._all]));
        const artifacts = Object.fromEntries(artifactGroups.map((group) => [group.storageStatus, {
            count: group._count._all,
            bytes: String(group._sum.sizeBytes ?? 0n),
        }]));
        const sunatDispatches = Object.fromEntries(dispatchGroups.map((group) => [
            group.status,
            group._count._all,
        ]));
        const oldestPendingSeconds = oldestPending
            ? Math.max(0, Math.round((now.getTime() - oldestPending.nextRunAt.getTime()) / 1_000))
            : 0;
        const apiErrorRate = apiRequests > 0 ? apiErrors / apiRequests : 0;
        const s3 = dependencySnapshot("S3");
        const kms = dependencySnapshot("KMS");
        const sunat = dependencySnapshot("SUNAT");
        const alerts: Array<{ severity: string; code: string; value: number }> = [];
        if (!databaseOk || databaseDurationMs >= 1_000) {
            alerts.push({ severity: "critical", code: "DATABASE_UNAVAILABLE_OR_SLOW", value: databaseDurationMs });
        }
        if (apiRequests >= 20 && apiErrorRate >= 0.05) {
            alerts.push({ severity: "warning", code: "API_ERROR_RATE_HIGH", value: apiErrorRate });
        }
        if (Number(queue.DEAD ?? 0) > 0) {
            alerts.push({ severity: "critical", code: "QUEUE_DEAD_JOBS", value: Number(queue.DEAD) });
        }
        if (oldestPendingSeconds >= 300) {
            alerts.push({ severity: "warning", code: "QUEUE_OLDEST_PENDING", value: oldestPendingSeconds });
        }
        if (s3.errors > 0 || kms.errors > 0 || sunat.errors > 0) {
            alerts.push({
                severity: "warning",
                code: "DEPENDENCY_ERRORS",
                value: s3.errors + kms.errors + sunat.errors,
            });
        }

        return {
            generatedAt: now.toISOString(),
            processStartedAt: startedAt.toISOString(),
            api: {
                requests: apiRequests,
                errors: apiErrors,
                errorRate: apiErrorRate,
                latencyMs: {
                    p50: percentile(apiDurations, 0.50),
                    p95: percentile(apiDurations, 0.95),
                    max: apiDurations.length > 0 ? Math.max(...apiDurations) : 0,
                },
                noisyInternalTenantIds: [...apiByTenant.entries()]
                    .filter(([, count]) => count.requests >= 100 || count.errors >= 5)
                    .map(([tenantId, count]) => ({ tenantId, ...count })),
            },
            database: { ok: databaseOk, durationMs: databaseDurationMs, error: databaseError },
            queue: { byStatus: queue, oldestPendingSeconds },
            sunat: { dispatchesByStatus: sunatDispatches, calls: sunat },
            s3: { artifactsByStatus: artifacts, calls: s3 },
            kms: { calls: kms },
            noisyTrials,
            alerts: {
                active: alerts,
                policy: {
                    apiErrorRate: { threshold: 0.05, minimumRequests: 20 },
                    databaseLatencyMs: { threshold: 1_000 },
                    oldestPendingSeconds: { threshold: 300 },
                    deadJobs: { threshold: 1 },
                    channel: process.env.OPS_ALERT_CHANNEL || "preproduction-console",
                    runbook: "runbooks/OPS_002_MONITORIZACION_Y_ALERTAS.md",
                },
            },
        };
    }
}
