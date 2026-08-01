import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, runTenantDatabaseTransaction } from "../src/data/prisma";
import { ListAuditLogDto } from "../src/domain/dtos/list-audit-log.dto";
import { ListUserActivityDto } from "../src/domain/dtos/list-user-activity.dto";
import {
    inspectAuditActivityMigration,
    reconcileAuditActivityMigration,
} from "../src/modules/tenant/audit-activity-reconciliation";
import { LEGACY_TENANT_ID } from "../src/modules/tenant/tenant-data-context";
import { AuditLogService } from "../src/presentation/services/audit-log.service";
import { UserActivityService } from "../src/presentation/services/user-activity.service";

const tag = Date.now().toString(36);
const pathA = `/api/mig010/a/${tag}`;
const pathB = `/api/mig010/b/${tag}`;
const quarantinePath = `/api/mig010/quarantine/${tag}`;
let dbReady = false;
let reconciled = false;
let userId = 0;
const tenantIds: string[] = [];
const membershipIds: string[] = [];

async function inTenant<T>(
    tenantId: string,
    callback: () => Promise<T>,
): Promise<T> {
    return runTenantDatabaseTransaction(tenantId, () => callback());
}

beforeAll(async () => {
    const [migration, checkpoint, user] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
            `SELECT migration_name FROM "_prisma_migrations"
             WHERE migration_name='20260729210000_reconcile_historical_audit'
               AND finished_at IS NOT NULL`,
        ).catch(() => []),
        prisma.tenantMigrationCheckpoint.findFirst({
            where: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-010",
                status: "COMPLETED",
            },
        }).catch(() => null),
        prisma.user.findFirst({
            where: { isActive: true },
            orderBy: { id: "asc" },
            select: { id: true },
        }),
    ]);
    const details = checkpoint?.details as { version?: unknown } | null;
    reconciled = details?.version === 1;
    dbReady = migration.length === 1 && Boolean(user);
    if (!dbReady || !user) return;
    userId = user.id;
    for (const label of ["a", "b"]) {
        const tenant = await prisma.tenant.create({
            data: {
                slug: `mig010-${label}-${tag}`,
                name: `MIG010 ${label} ${tag}`,
                status: "SUSPENDED",
            },
        });
        tenantIds.push(tenant.id);
        const membership = await prisma.tenantMembership.create({
            data: {
                tenantId: tenant.id,
                userId,
                role: "ADMIN",
                status: "ACTIVE",
                activatedAt: new Date(),
            },
        });
        membershipIds.push(membership.id);
    }
});

afterAll(async () => {
    if (tenantIds.length > 0) {
        await prisma.$executeRawUnsafe(
            `DELETE FROM "AuditLog"
             WHERE "tenantId"=ANY($1::uuid[]) OR "path"=$2`,
            tenantIds,
            quarantinePath,
        ).catch(() => undefined);
        await prisma.$executeRawUnsafe(
            `DELETE FROM "UserActivityLog"
             WHERE "tenantId"=ANY($1::uuid[])`,
            tenantIds,
        ).catch(() => undefined);
        await prisma.tenantMembership.deleteMany({
            where: { id: { in: membershipIds } },
        }).catch(() => undefined);
        await prisma.tenant.deleteMany({
            where: { id: { in: tenantIds } },
        }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
});

describe("MIG-010: auditoría y actividad histórica", () => {
    it("concilia retención, atribución, cuarentena y mapas", async (ctx) => {
        if (!dbReady || !reconciled) return ctx.skip();
        const summary = await inspectAuditActivityMigration();
        expect(summary.counts).toEqual({
            auditLogs: 30418,
            tenantAuditLogs: 29811,
            quarantinedAuditLogs: 607,
            activityLogs: 509,
        });
        expect(summary.sanitization).toEqual({
            unsafeAuditFields: 0,
            unsafeActivityFields: 0,
        });
        expect(summary.idMapping).toEqual({
            strategy: "IDENTITY",
            validUsers: 509,
            validOrders: 492,
            validInventoryMovements: 16,
            preservedDeletedEntityReferences: 1,
        });
        expect(summary.invalidScopeRows).toBe(0);
        expect(summary.tenantConstraintCount).toBe(3);
    });

    it("redacta payloads nuevos y aísla búsqueda entre empresas", async (ctx) => {
        if (!dbReady || tenantIds.length !== 2) return ctx.skip();
        const audit = new AuditLogService();
        const activity = new UserActivityService();
        for (const [index, tenantId] of tenantIds.entries()) {
            await inTenant(tenantId!, async () => {
                await audit.registerRequest({
                    actorUserId: userId,
                    actorEmail: `actor-${index}@example.test`,
                    actorRole: "ADMIN",
                    method: "POST",
                    path: index === 0 ? pathA : pathB,
                    statusCode: 201,
                    durationMs: 12 + index,
                    requestBody: {
                        password: "secret",
                        email: `customer-${index}@example.test`,
                        safe: `tenant-${index}`,
                    },
                });
                await activity.register({
                    userId,
                    userEmail: `actor-${index}@example.test`,
                    userRole: "ADMIN",
                    module: "SUPPORT",
                    actionType: "MIG010_TEST",
                    actionLabel: `MIG010 ${index}`,
                    entityType: "ORDER",
                    entityId: 1,
                    context: {
                        token: "secret",
                        phone: "999999999",
                        safe: `tenant-${index}`,
                    },
                });
            });
        }
        await audit.registerRequest({
            method: "GET",
            path: quarantinePath,
            statusCode: 401,
            durationMs: 1,
        });

        const [, auditDto] = ListAuditLogDto.create({
            page: 1,
            limit: 20,
            path: "/api/mig010/",
        });
        const [, activityDto] = ListUserActivityDto.create({
            page: 1,
            limit: 20,
            actionType: "MIG010_TEST",
        });
        const [auditA, activityA, auditB, activityB] = await Promise.all([
            inTenant(tenantIds[0]!, () => audit.list(auditDto!)),
            inTenant(tenantIds[0]!, () => activity.list(activityDto!)),
            inTenant(tenantIds[1]!, () => audit.list(auditDto!)),
            inTenant(tenantIds[1]!, () => activity.list(activityDto!)),
        ]);
        expect(auditA.data.map((row) => row.request.path)).toEqual([pathA]);
        expect(auditB.data.map((row) => row.request.path)).toEqual([pathB]);
        expect(auditA.data[0]?.request.body).toMatchObject({
            password: "[redacted]",
            email: "[redacted]",
            safe: "tenant-0",
        });
        expect(activityA.data).toHaveLength(1);
        expect(activityB.data).toHaveLength(1);
        expect(activityA.data[0]?.context).toMatchObject({
            token: "[redacted]",
            phone: "[redacted]",
            safe: "tenant-0",
        });
        expect(auditA.data.some(
            (row) => row.request.path === quarantinePath,
        )).toBe(false);
    });

    it("la reejecución conserva la línea base y las filas nuevas", async (ctx) => {
        if (!dbReady || !reconciled) return ctx.skip();
        const before = await inspectAuditActivityMigration();
        const liveBefore = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
            `SELECT COUNT(*)::int AS count FROM "AuditLog"
             WHERE "createdAt">$1
               AND "path"=ANY($2::text[])`,
            new Date("2026-07-29T16:27:05.069Z"),
            [pathA, pathB, quarantinePath],
        );
        await reconcileAuditActivityMigration();
        await reconcileAuditActivityMigration();
        const after = await inspectAuditActivityMigration();
        const liveAfter = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
            `SELECT COUNT(*)::int AS count FROM "AuditLog"
             WHERE "createdAt">$1
               AND "path"=ANY($2::text[])`,
            new Date("2026-07-29T16:27:05.069Z"),
            [pathA, pathB, quarantinePath],
        );
        expect(after.fingerprints).toEqual(before.fingerprints);
        expect(liveAfter).toEqual(liveBefore);
    }, 30_000);
});
