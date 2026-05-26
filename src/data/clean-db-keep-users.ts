import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error("DATABASE_URL is required");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const TABLES_TO_KEEP = new Set(["User", "Role", "_prisma_migrations"]);

type TableRow = { table_name: string };

async function main() {
    const tables = await prisma.$queryRaw<TableRow[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
    `;

    const tablesToTruncate = tables
        .map((row) => row.table_name)
        .filter((tableName) => !TABLES_TO_KEEP.has(tableName));

    if (!tablesToTruncate.length) {
        console.log("No tables to truncate.");
        return;
    }

    const quotedTables = tablesToTruncate
        .map((tableName) => `"public"."${tableName}"`)
        .join(", ");

    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE;`);

    console.log(`Truncated ${tablesToTruncate.length} tables.`);
    console.log(`Preserved tables: ${Array.from(TABLES_TO_KEEP).join(", ")}`);
}

main()
    .catch((error) => {
        console.error("Error cleaning database:", error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
