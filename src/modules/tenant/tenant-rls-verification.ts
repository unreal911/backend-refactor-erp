import { Pool, PoolClient } from "pg";
import {
    runTenantDatabaseTransaction,
} from "../../data/prisma";
import { platformPrisma as prisma } from "../../data/platform-prisma";
import { tenantPrisma } from "../../data/tenant-prisma";
import { envs } from "../../config/envs";

export const RLS_TABLES = [
    "AuditLog",
    "Category",
    "Color",
    "CommercialAsset",
    "CommercialAlert",
    "AdminEventOutbox",
    "TrialBenefitClaim",
    "Comprobante",
    "ComprobanteItem",
    "ComprobanteSerie",
    "ComunicacionBaja",
    "Customer",
    "Inventory",
    "InventoryMovement",
    "ManualPaymentRequest",
    "ManualPaymentProof",
    "MarketplaceCustomer",
    "Order",
    "OrderItem",
    "OrderReturn",
    "OrderReturnItem",
    "PaymentMethod",
    "PickingItem",
    "PickingItemContribution",
    "PickingOrderItemDetail",
    "PickingResponsibilityRequest",
    "PickingSession",
    "PickingSharedResponsibility",
    "PickingUnpickRequest",
    "Product",
    "ProductImage",
    "ProductVariant",
    "Reservation",
    "ResumenDiario",
    "Size",
    "StockTransfer",
    "StockTransferItem",
    "Store",
    "SunatDispatch",
    "SunatEmisorConfig",
    "SunatArtifact",
    "SunatJob",
    "SystemSetting",
    "Tenant",
    "TenantInvitation",
    "TenantLifecycleEvent",
    "TenantMembership",
    "TenantMigrationCheckpoint",
    "TenantMigrationQuarantine",
    "TenantPlanAssignment",
    "TenantSubscription",
    "UserActivityLog",
] as const;

type RlsTableRow = {
    tableName: string;
    rlsEnabled: boolean;
    rlsForced: boolean;
    owner: string;
};

type PolicyRow = {
    tablename: string;
    policyname: string;
    cmd: string;
    roles: string[];
    qual: string | null;
    withCheck: string | null;
};

type RoleRow = {
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcanlogin: boolean;
    ownedTables: number;
};

export type TenantRlsVerificationSummary = {
    migration: string;
    role: {
        name: string;
        superuser: boolean;
        bypassRls: boolean;
        canLogin: boolean;
        ownedTables: number;
    };
    tablesWithForcedRls: number;
    policies: number;
    noContextRows: number;
    companyARows: number;
    companyBRows: number;
    crossTenantUpdates: number;
    noContextWriteBlocked: boolean;
    crossTenantWriteBlocked: boolean;
    poolContextCleared: boolean;
    prismaScopedRows: number;
    prismaCrossTenantUpdates: number;
};

function errorCode(error: unknown): string {
    if (!error || typeof error !== "object") return "";
    return String((error as { code?: unknown }).code ?? "");
}

async function assertWriteBlocked(
    client: PoolClient,
    tenantId: string,
    name: string,
): Promise<boolean> {
    try {
        await client.query(
            `INSERT INTO "Category" ("tenantId", "name")
             VALUES ($1::uuid, $2)`,
            [tenantId, name],
        );
        return false;
    } catch (error) {
        if (errorCode(error) === "42501") return true;
        throw error;
    }
}

export async function verifyTenantRls():
Promise<TenantRlsVerificationSummary> {
    const suffix = Date.now().toString(36);
    const tenantIds: string[] = [];
    let pool: Pool | null = null;
    let client: PoolClient | null = null;
    let roleActive = false;

    try {
        const migrationRows = await prisma.$queryRawUnsafe<Array<{
            migration_name: string;
        }>>(
            `SELECT migration_name
             FROM "_prisma_migrations"
             WHERE migration_name='20260729240000_force_tenant_rls'
               AND finished_at IS NOT NULL
               AND rolled_back_at IS NULL`,
        );
        if (migrationRows.length !== 1) {
            throw new Error("La migracion TEN-008 no esta aplicada");
        }

        const [tableRows, policyRows, roleRows] = await Promise.all([
            prisma.$queryRawUnsafe<RlsTableRow[]>(
                `SELECT
                     c.relname AS "tableName",
                     c.relrowsecurity AS "rlsEnabled",
                     c.relforcerowsecurity AS "rlsForced",
                     owner.rolname AS owner
                 FROM pg_class AS c
                 JOIN pg_namespace AS namespace
                   ON namespace.oid = c.relnamespace
                 JOIN pg_roles AS owner
                   ON owner.oid = c.relowner
                 WHERE namespace.nspname = current_schema()
                   AND c.relkind = 'r'
                   AND c.relname = ANY($1::text[])
                 ORDER BY c.relname`,
                [...RLS_TABLES],
            ),
            prisma.$queryRawUnsafe<PolicyRow[]>(
                `SELECT
                     tablename,
                     policyname,
                     cmd,
                     roles::text[] AS roles,
                     qual,
                     with_check AS "withCheck"
                 FROM pg_policies
                 WHERE schemaname = current_schema()
                   AND tablename = ANY($1::text[])
                 ORDER BY tablename`,
                [...RLS_TABLES],
            ),
            prisma.$queryRawUnsafe<RoleRow[]>(
                `SELECT
                     role.rolname,
                     role.rolsuper,
                     role.rolbypassrls,
                     role.rolcanlogin,
                     COUNT(owned.oid)::int AS "ownedTables"
                 FROM pg_roles AS role
                 LEFT JOIN pg_class AS owned
                   ON owned.relowner = role.oid
                  AND owned.relkind = 'r'
                 WHERE role.rolname = 'tienda_tenant_app'
                 GROUP BY
                     role.rolname,
                     role.rolsuper,
                     role.rolbypassrls,
                     role.rolcanlogin`,
            ),
        ]);

        const foundTables = new Set(tableRows.map((row) => row.tableName));
        const missingTables = RLS_TABLES.filter(
            (table) => !foundTables.has(table),
        );
        if (
            missingTables.length > 0
            || tableRows.some(
                (row) => !row.rlsEnabled || !row.rlsForced,
            )
        ) {
            throw new Error(
                `RLS incompleto: ${missingTables.join(",") || "flags invalidos"}`,
            );
        }

        const policyByTable = new Map(
            policyRows.map((row) => [row.tablename, row]),
        );
        const invalidPolicies = RLS_TABLES.filter((table) => {
            const policy = policyByTable.get(table);
            return !policy
                || policy.cmd !== "ALL"
                || !policy.roles.includes("tienda_tenant_app")
                || !policy.qual?.includes("current_tenant_id")
                || !policy.withCheck?.includes("current_tenant_id");
        });
        if (invalidPolicies.length > 0) {
            throw new Error(
                `Politicas RLS incompletas: ${invalidPolicies.join(",")}`,
            );
        }

        const role = roleRows[0];
        if (
            !role
            || role.rolsuper
            || role.rolbypassrls
            || role.ownedTables !== 0
        ) {
            throw new Error(
                `Rol tenant inseguro: ${JSON.stringify(role ?? null)}`,
            );
        }

        const tenantA = await prisma.tenant.create({
            data: {
                slug: `ten008-a-${suffix}`,
                name: `TEN008 Empresa A ${suffix}`,
                status: "SUSPENDED",
            },
        });
        const tenantB = await prisma.tenant.create({
            data: {
                slug: `ten008-b-${suffix}`,
                name: `TEN008 Empresa B ${suffix}`,
                status: "SUSPENDED",
            },
        });
        tenantIds.push(tenantA.id, tenantB.id);
        const categoryA = await prisma.category.create({
            data: {
                tenantId: tenantA.id,
                name: `TEN008 Compartida ${suffix}`,
            },
        });
        const categoryB = await prisma.category.create({
            data: {
                tenantId: tenantB.id,
                name: `TEN008 Compartida ${suffix}`,
            },
        });

        pool = new Pool({
            connectionString: envs.DATABASE_URL,
            max: 1,
        });
        client = await pool.connect();
        await client.query(`SET ROLE "tienda_tenant_app"`);
        roleActive = true;

        const noContext = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM "Category"
             WHERE id = ANY($1::int[])`,
            [[categoryA.id, categoryB.id]],
        );
        const noContextRows = Number(noContext.rows[0]?.count ?? "0");
        const noContextWriteBlocked = await assertWriteBlocked(
            client,
            tenantA.id,
            `TEN008 sin contexto ${suffix}`,
        );

        await client.query("BEGIN");
        await client.query(
            `SELECT set_config('app.tenant_id', $1, true)`,
            [tenantA.id],
        );
        const companyAResult = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM "Category"
             WHERE id = ANY($1::int[])`,
            [[categoryA.id, categoryB.id]],
        );
        await client.query(
            `INSERT INTO "Category" ("tenantId", "name")
             VALUES ($1::uuid, $2)`,
            [tenantA.id, `TEN008 permitida A ${suffix}`],
        );
        await client.query("SAVEPOINT cross_tenant_write");
        const crossTenantWriteBlocked = await assertWriteBlocked(
            client,
            tenantB.id,
            `TEN008 cruzada ${suffix}`,
        );
        if (crossTenantWriteBlocked) {
            await client.query("ROLLBACK TO SAVEPOINT cross_tenant_write");
        }
        const crossUpdateResult = await client.query(
            `UPDATE "Category"
             SET name = $1
             WHERE id = $2`,
            [`TEN008 mutacion cruzada ${suffix}`, categoryB.id],
        );
        await client.query("ROLLBACK");

        // La misma conexion vuelve al pool con el rol efectivo intacto. El
        // setting LOCAL debe desaparecer automaticamente al cerrar la tx.
        client.release();
        client = await pool.connect();
        const clearedContext = await client.query<{
            tenantId: string | null;
            currentUser: string;
        }>(
            `SELECT
                 NULLIF(current_setting('app.tenant_id', true), '') AS "tenantId",
                 current_user AS "currentUser"`,
        );
        const afterPoolReuse = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM "Category"
             WHERE id = ANY($1::int[])`,
            [[categoryA.id, categoryB.id]],
        );
        const poolContextCleared = (
            clearedContext.rows[0]?.tenantId === null
            && clearedContext.rows[0]?.currentUser === "tienda_tenant_app"
            && Number(afterPoolReuse.rows[0]?.count ?? "0") === 0
        );

        await client.query("BEGIN");
        await client.query(
            `SELECT set_config('app.tenant_id', $1, true)`,
            [tenantB.id],
        );
        const companyBResult = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM "Category"
             WHERE id = ANY($1::int[])`,
            [[categoryA.id, categoryB.id]],
        );
        await client.query("ROLLBACK");

        const prismaScope = await runTenantDatabaseTransaction(
            tenantA.id,
            async () => {
                const visible = await tenantPrisma.category.findMany({
                    where: {
                        id: { in: [categoryA.id, categoryB.id] },
                    },
                    select: { id: true },
                });
                const crossUpdate = await tenantPrisma.category.updateMany({
                    where: { id: categoryB.id },
                    data: {
                        name: `TEN008 Prisma cruzada ${suffix}`,
                    },
                });
                return {
                    visibleRows: visible.length,
                    crossUpdates: crossUpdate.count,
                };
            },
        );

        const summary: TenantRlsVerificationSummary = {
            migration: migrationRows[0]!.migration_name,
            role: {
                name: role.rolname,
                superuser: role.rolsuper,
                bypassRls: role.rolbypassrls,
                canLogin: role.rolcanlogin,
                ownedTables: role.ownedTables,
            },
            tablesWithForcedRls: tableRows.length,
            policies: policyRows.length,
            noContextRows,
            companyARows: Number(
                companyAResult.rows[0]?.count ?? "0",
            ),
            companyBRows: Number(
                companyBResult.rows[0]?.count ?? "0",
            ),
            crossTenantUpdates: crossUpdateResult.rowCount ?? 0,
            noContextWriteBlocked,
            crossTenantWriteBlocked,
            poolContextCleared,
            prismaScopedRows: prismaScope.visibleRows,
            prismaCrossTenantUpdates: prismaScope.crossUpdates,
        };
        if (
            summary.tablesWithForcedRls !== RLS_TABLES.length
            || summary.policies !== RLS_TABLES.length
            || summary.noContextRows !== 0
            || summary.companyARows !== 1
            || summary.companyBRows !== 1
            || summary.crossTenantUpdates !== 0
            || !summary.noContextWriteBlocked
            || !summary.crossTenantWriteBlocked
            || !summary.poolContextCleared
            || summary.prismaScopedRows !== 1
            || summary.prismaCrossTenantUpdates !== 0
        ) {
            throw new Error(
                `Verificacion RLS inesperada: ${JSON.stringify(summary)}`,
            );
        }
        return summary;
    } finally {
        if (client) {
            if (roleActive) {
                await client.query("ROLLBACK").catch(() => undefined);
                await client.query("RESET ROLE").catch(() => undefined);
            }
            client.release();
        }
        if (pool) await pool.end().catch(() => undefined);
        if (tenantIds.length > 0) {
            await prisma.category.deleteMany({
                where: { tenantId: { in: tenantIds } },
            }).catch(() => undefined);
            await prisma.tenantMembership.deleteMany({
                where: { tenantId: { in: tenantIds } },
            }).catch(() => undefined);
            await prisma.tenant.deleteMany({
                where: { id: { in: tenantIds } },
            }).catch(() => undefined);
        }
    }
}
