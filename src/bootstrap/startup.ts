import { seedRbacDefaults } from "../data/rbac-bootstrap";
import { seedDefaultPaymentMethods } from "../data/payment-method-bootstrap";
import { seedDefaultSystemSettings } from "../data/system-config-bootstrap";
import { seedLegacyTenantMemberships } from "../data/tenant-bootstrap";
import { prisma } from "../data/prisma";
import {
    EnvironmentSource,
    isSunatDocumentStorageEnabled,
    loadSunatInfrastructureConfig,
} from "../modules/sunat/infrastructure/sunat-infrastructure.config";

const RAILWAY_INTERNAL_HOST_SUFFIX = ".railway.internal";
export const REQUIRED_SCHEMA_MIGRATION = "20260813200000_cloudinary_usage_snapshot";
export const REQUIRED_SCHEMA_TABLES = [
    "AuditLog",
    "BillingWebhookEvent",
    "Category",
    "Color",
    "CommercialAsset",
    "CommercialAlert",
    "AdminEventOutbox",
    "Comprobante",
    "ComprobanteItem",
    "ComprobanteSerie",
    "ComunicacionBaja",
    "Inventory",
    "InventoryMovement",
    "ImageProviderProfile",
    "ManualPaymentMethod",
    "ManualPaymentRequest",
    "ManualPaymentProof",
    "MarketplaceCustomer",
    "Order",
    "OrderItem",
    "OrderReturn",
    "OrderReturnItem",
    "OwnerRegistration",
    "PasswordResetToken",
    "PaymentMethod",
    "Permission",
    "Plan",
    "PlanVersion",
    "PlatformAdmin",
    "PlatformPermission",
    "PlatformRole",
    "PlatformRolePermission",
    "PlatformAuditEvent",
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
    "Role",
    "RolePermission",
    "SignupAbuseEvent",
    "TrialBenefitClaim",
    "SignupRateLimitBucket",
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
    "User",
    "UserActivityLog",
];
const DATA_SEED_STEPS: Array<{ name: string; run: () => Promise<void> }> = [
    { name: "RBAC defaults", run: seedRbacDefaults },
    { name: "Payment method defaults", run: seedDefaultPaymentMethods },
    { name: "System setting defaults", run: seedDefaultSystemSettings },
    { name: "Legacy tenant memberships", run: seedLegacyTenantMemberships },
];

export function validateSunatDocumentInfrastructureAtStartup(
    source: EnvironmentSource = process.env,
): void {
    if (!isSunatDocumentStorageEnabled(source)) return;
    loadSunatInfrastructureConfig(source);
}

export function validateProductionRuntime(
    source: EnvironmentSource = process.env,
): void {
    if (String(source.NODE_ENV ?? "").toLowerCase() !== "production") return;
    const corsOrigins = String(source.CORS_ORIGINS ?? "")
        .split(",").map((value) => value.trim()).filter(Boolean);
    if (corsOrigins.length === 0 || corsOrigins.some((origin) => !origin.startsWith("https://"))) {
        throw new Error("Producción exige CORS_ORIGINS con orígenes HTTPS explícitos");
    }
    if (!String(source.DIRECT_DATABASE_URL ?? "").trim()) {
        throw new Error("Producción exige DIRECT_DATABASE_URL separada para migraciones");
    }
    if (String(source.CLOUD_MODE ?? "").toLowerCase() !== "aws") {
        throw new Error("Producción exige CLOUD_MODE=aws");
    }
}

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

        console.error("Database startup warning: unable to connect to PostgreSQL.");
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

async function ensureSchemaReady(): Promise<boolean> {
    type TableRow = { table_name: string };
    type MigrationRow = { migration_name: string };

    const existingTables = await prisma.$queryRawUnsafe<TableRow[]>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_name = ANY($1::text[])`,
        REQUIRED_SCHEMA_TABLES,
    );

    const existingTableSet = new Set(existingTables.map((row) => row.table_name));
    const missingTables = REQUIRED_SCHEMA_TABLES.filter((tableName) => !existingTableSet.has(tableName));

    if (missingTables.length > 0) {
        console.error("Database schema validation failed: required tables are missing.");
        console.error(`Missing tables: ${missingTables.join(", ")}`);
        console.error("Run `npm run db:migrate:deploy` before starting the app container.");
        return false;
    }

    const appliedMigration = await prisma.$queryRawUnsafe<MigrationRow[]>(
        `SELECT migration_name
         FROM "_prisma_migrations"
         WHERE migration_name = $1
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL`,
        REQUIRED_SCHEMA_MIGRATION,
    );

    if (appliedMigration.length !== 1) {
        console.error(`Database schema validation failed: migration ${REQUIRED_SCHEMA_MIGRATION} is not applied.`);
        console.error("Run `npm run db:migrate:deploy` before starting the app container.");
        return false;
    }

    return true;
}

async function runDataSeeds(): Promise<void> {
    for (const step of DATA_SEED_STEPS) {
        await step.run();
        console.log(`${step.name} seeded`);
    }
}

export async function runStartupBootstraps(
    databaseUrl: string,
    source: EnvironmentSource = process.env,
): Promise<void> {
    // Debe ejecutarse antes de consultar PostgreSQL: una configuración cloud
    // insegura no puede alcanzar la fase de bootstraps ni servir tráfico.
    validateSunatDocumentInfrastructureAtStartup(source);
    validateProductionRuntime(source);

    const databaseReachable = await ensureDatabaseReachability(databaseUrl);
    if (!databaseReachable) {
        throw new Error("Startup aborted: database is not reachable.");
    }

    const schemaReady = await ensureSchemaReady();
    if (!schemaReady) {
        throw new Error("Startup aborted: required schema migration is missing. Run migrations first.");
    }

    // El arranque no ejecuta DDL. Los únicos cambios permitidos aquí son seeds
    // de catálogo idempotentes sobre un esquema ya versionado.
    await runDataSeeds();
}
