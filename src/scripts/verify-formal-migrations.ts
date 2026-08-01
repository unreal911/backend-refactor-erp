import { runStartupBootstraps, REQUIRED_SCHEMA_MIGRATION, REQUIRED_SCHEMA_TABLES } from "../bootstrap/startup";
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";

type CountRow = { count: bigint };
type MigrationRow = { migration_name: string };

async function main(): Promise<void> {
    await runStartupBootstraps(envs.DATABASE_URL);

    const tableRows = await prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*)::bigint AS count
         FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_type = 'BASE TABLE'
           AND table_name <> '_prisma_migrations'`,
    );
    const migrationRows = await prisma.$queryRawUnsafe<MigrationRow[]>(
        `SELECT migration_name
         FROM "_prisma_migrations"
         WHERE migration_name = $1
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL`,
        REQUIRED_SCHEMA_MIGRATION,
    );

    const applicationTableCount = Number(tableRows[0]?.count ?? 0n);
    if (applicationTableCount !== REQUIRED_SCHEMA_TABLES.length) {
        throw new Error(
            `Se esperaban ${REQUIRED_SCHEMA_TABLES.length} tablas de aplicación y se encontraron ${applicationTableCount}`,
        );
    }
    if (migrationRows.length !== 1) {
        throw new Error(`La migración requerida ${REQUIRED_SCHEMA_MIGRATION} no está aplicada`);
    }

    console.info("[migration-verify] READY");
    console.info(`[migration-verify] Migración: ${REQUIRED_SCHEMA_MIGRATION}`);
    console.info(`[migration-verify] Tablas de aplicación: ${applicationTableCount}`);
    console.info("[migration-verify] El arranque validó el esquema sin ejecutar DDL");
}

main()
    .catch((error) => {
        console.error("[migration-verify] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
