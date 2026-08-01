import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from "vitest";
import { prisma } from "../src/data/prisma";
import {
    inspectBackfillClosure,
    MIG011_SEQUENCE_TABLES,
    MIG011_TENANT_TABLES,
    reconcileBackfillClosure,
} from "../src/modules/tenant/backfill-closure-reconciliation";
import {
    LEGACY_TENANT_ID,
    TenantDataContext,
} from "../src/modules/tenant/tenant-data-context";

const tag = Date.now().toString(36);
let dbReady = false;
let categoryId = 0;

beforeAll(async () => {
    const [migration, checkpoint] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
            `SELECT migration_name
             FROM "_prisma_migrations"
             WHERE migration_name=
                   '20260729220000_close_non_sunat_backfill'
               AND finished_at IS NOT NULL
               AND rolled_back_at IS NULL`,
        ).catch(() => []),
        prisma.tenantMigrationCheckpoint.findUnique({
            where: {
                tenantId_storyId: {
                    tenantId: LEGACY_TENANT_ID,
                    storyId: "MIG-011",
                },
            },
            select: { status: true },
        }).catch(() => null),
    ]);
    dbReady = migration.length === 1 && checkpoint?.status === "COMPLETED";
});

afterAll(async () => {
    if (categoryId) {
        await TenantDataContext.run(
            LEGACY_TENANT_ID,
            () => prisma.category.deleteMany({ where: { id: categoryId } }),
        ).catch(() => undefined);
    }
});

describe("MIG-011: cierre integral del backfill", () => {
    it("reconcilia los ocho lotes y toda la matriz sin conflictos", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const report = await inspectBackfillClosure();
        expect(report.prerequisites).toHaveLength(8);
        expect(report.coverage).toHaveLength(34);
        expect(report.coverage.every((row) => row.reconciled)).toBe(true);
        expect(report.integrity).toEqual(expect.objectContaining({
            tenantTableCount: MIG011_TENANT_TABLES.length,
            nullableTenantColumns: 0,
            tenantIndexedTables: MIG011_TENANT_TABLES.length,
            unvalidatedConstraints: 0,
            orphanRows: 0,
            crossTenantRows: 0,
            invalidAuditScopes: 0,
            invalidOperationalPickingRows: 0,
        }));
        expect(report.conflicts).toEqual({
            missingBaselineRows: 0,
            duplicateBaselineRows: 0,
            unsafeSequences: 0,
            unexplainedChanges: 0,
        });
        expect(report.sequences).toHaveLength(MIG011_SEQUENCE_TABLES.length);
        expect(report.sequences.every((row) => row.nextValueSafe)).toBe(true);
    }, 30_000);

    it("preserva PickingItem#8 fuera del flujo y valida su guarda", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const [active, quarantine, details, constraint] = await Promise.all([
            prisma.$queryRawUnsafe<Array<{ count: number }>>(
                `SELECT COUNT(*)::int AS count
                 FROM "PickingItem" WHERE id=8`,
            ),
            prisma.$queryRawUnsafe<Array<{
                quantity: number;
                pickedQuantity: number;
                originalHash: string;
            }>>(
                `SELECT
                    ("originalData"->>'quantity')::int AS quantity,
                    ("originalData"->>'pickedQuantity')::int
                        AS "pickedQuantity",
                    "originalHash" AS "originalHash"
                 FROM "TenantMigrationQuarantine"
                 WHERE "tenantId"=$1::uuid
                   AND "storyId"='MIG-011'
                   AND "sourceTable"='PickingItem'
                   AND "sourceKey"='8'`,
                LEGACY_TENANT_ID,
            ),
            prisma.$queryRawUnsafe<Array<{ count: number }>>(
                `SELECT COUNT(*)::int AS count
                 FROM "PickingOrderItemDetail"
                 WHERE id IN (139,141,143,144,149,156)
                   AND "pickingItemId" IS NULL`,
            ),
            prisma.$queryRawUnsafe<Array<{ convalidated: boolean }>>(
                `SELECT convalidated
                 FROM pg_constraint
                 WHERE conname='PickingItem_quantity_bounds_check'`,
            ),
        ]);

        expect(active[0]?.count).toBe(0);
        expect(quarantine).toEqual([{
            quantity: 13,
            pickedQuantity: 21,
            originalHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }]);
        expect(details[0]?.count).toBe(6);
        expect(constraint[0]?.convalidated).toBe(true);
    });

    it("crea después del máximo sin colisión de secuencia", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const before = await prisma.$queryRawUnsafe<Array<{ maximum: number }>>(
            `SELECT COALESCE(MAX(id),0)::int AS maximum FROM "Category"`,
        );
        const category = await TenantDataContext.run(
            LEGACY_TENANT_ID,
            () => prisma.category.create({
                data: { name: `MIG011-SEQUENCE-${tag}` },
            }),
        );
        categoryId = category.id;
        expect(category.id).toBeGreaterThan(before[0]?.maximum ?? 0);
    });

    it("una segunda ejecución no duplica ni cambia la huella lógica", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const before = await inspectBackfillClosure();
        const first = await reconcileBackfillClosure();
        const second = await reconcileBackfillClosure();
        const after = await inspectBackfillClosure();
        const quarantines = await prisma.tenantMigrationQuarantine.count({
            where: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-011",
                sourceTable: "PickingItem",
                sourceKey: "8",
            },
        });

        expect(first.fingerprints.report).toBe(before.fingerprints.report);
        expect(second.fingerprints.report).toBe(before.fingerprints.report);
        expect(after.fingerprints.report).toBe(before.fingerprints.report);
        expect(quarantines).toBe(1);
    }, 30_000);
});
