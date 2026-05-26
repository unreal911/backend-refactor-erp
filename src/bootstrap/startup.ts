import { ensureRbacSchema } from "../data/rbac-bootstrap";
import { ensurePaymentMethodSchema } from "../data/payment-method-bootstrap";
import { ensureSystemConfigSchema } from "../data/system-config-bootstrap";
import { ensureMarketplaceAuthSchema } from "../data/marketplace-auth-bootstrap";
import { ensureAuditLogSchema } from "../data/audit-log-bootstrap";
import { ensureUserActivitySchema } from "../data/user-activity-bootstrap";
import { ensurePickingResponsibilitySchema } from "../data/picking-responsibility-bootstrap";
import { prisma } from "../data/prisma";

const RAILWAY_INTERNAL_HOST_SUFFIX = ".railway.internal";
const REQUIRED_BASE_TABLES = ["Role", "User", "Order", "OrderItem", "PickingItem"];
const BOOTSTRAP_STEPS: Array<{ name: string; run: () => Promise<void> }> = [
    { name: "RBAC", run: ensureRbacSchema },
    { name: "Payment method", run: ensurePaymentMethodSchema },
    { name: "System config", run: ensureSystemConfigSchema },
    { name: "Marketplace auth", run: ensureMarketplaceAuthSchema },
    { name: "Audit log", run: ensureAuditLogSchema },
    { name: "User activity", run: ensureUserActivitySchema },
    { name: "Picking responsibility", run: ensurePickingResponsibilitySchema },
];

function getDatabaseHost(connectionString: string): string | null {
    try {
        return new URL(connectionString).hostname;
    } catch {
        return null;
    }
}

function isRailwayInternalHost(hostname: string | null): boolean {
    return Boolean(hostname?.endsWith(RAILWAY_INTERNAL_HOST_SUFFIX));
}

function isRunningOnRailway(): boolean {
    return Boolean(process.env.RAILWAY_PROJECT_ID);
}

async function ensureDatabaseReachability(databaseUrl: string): Promise<boolean> {
    try {
        await prisma.$queryRawUnsafe("SELECT 1");
        return true;
    } catch (error) {
        const databaseHost = getDatabaseHost(databaseUrl);

        console.error("Database bootstrap warning: unable to connect to PostgreSQL. Schema bootstrap steps were skipped.");
        if (databaseHost) {
            console.error(`Configured database host: ${databaseHost}`);
        }

        if (isRailwayInternalHost(databaseHost) && !isRunningOnRailway()) {
            console.error("Detected Railway private hostname outside Railway runtime. Use DATABASE_PUBLIC_URL for external access.");
        }

        console.error(error);
        return false;
    }
}

async function ensureBaseSchemaReady(): Promise<boolean> {
    type TableRow = { table_name: string };

    const existingTables = await prisma.$queryRawUnsafe<TableRow[]>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_name = ANY($1::text[])`,
        REQUIRED_BASE_TABLES,
    );

    const existingTableSet = new Set(existingTables.map((row) => row.table_name));
    const missingTables = REQUIRED_BASE_TABLES.filter((tableName) => !existingTableSet.has(tableName));

    if (missingTables.length > 0) {
        console.error("Database schema bootstrap warning: base Prisma tables are missing.");
        console.error(`Missing tables: ${missingTables.join(", ")}`);
        console.error("Run `npm run db:migrate:deploy` before starting the app container.");
        return false;
    }

    return true;
}

async function runSchemaBootstraps(): Promise<void> {
    for (const step of BOOTSTRAP_STEPS) {
        try {
            await step.run();
            console.log(`${step.name} schema validated`);
        } catch (error) {
            console.error(`${step.name} bootstrap warning:`, error);
        }
    }
}

export async function runStartupBootstraps(databaseUrl: string): Promise<void> {
    const databaseReachable = await ensureDatabaseReachability(databaseUrl);
    if (!databaseReachable) {
        throw new Error("Startup aborted: database is not reachable.");
    }

    const baseSchemaReady = await ensureBaseSchemaReady();
    if (!baseSchemaReady) {
        throw new Error("Startup aborted: base Prisma schema is missing. Run migrations first.");
    }

    await runSchemaBootstraps();
}
