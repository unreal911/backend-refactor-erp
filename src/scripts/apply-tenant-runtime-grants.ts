import { prisma } from "../data/prisma";
import { RLS_TABLES } from "../modules/tenant/tenant-rls-verification";

function quoteIdentifier(value: string): string {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(value)) throw new Error("Identificador SQL inválido");
    return `"${value}"`;
}

async function main(): Promise<void> {
    const exists = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
        `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tienda_tenant_app') AS exists`,
    );
    if (!exists[0]?.exists) throw new Error("El rol tienda_tenant_app no existe; ejecuta migraciones primero");
    const tenantTables = RLS_TABLES.map(quoteIdentifier).join(", ");
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "tienda_tenant_app"`);
    await prisma.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION "current_tenant_id"() TO "tienda_tenant_app"`);
    await prisma.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${tenantTables} TO "tienda_tenant_app"`,
    );
    await prisma.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "User", "Role", "Permission", "RolePermission" TO "tienda_tenant_app"`,
    );
    await prisma.$executeRawUnsafe(`GRANT SELECT, UPDATE ON TABLE "Tenant" TO "tienda_tenant_app"`);
    await prisma.$executeRawUnsafe(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "tienda_tenant_app"`);
    await prisma.$executeRawUnsafe(`REVOKE ALL ON TABLE "BillingWebhookEvent" FROM "tienda_tenant_app"`);
    console.log(JSON.stringify({ role: "tienda_tenant_app", tenantTables: RLS_TABLES.length, status: "APPLIED" }));
}

void main()
    .catch((caught) => {
        console.error("[tenant-runtime-grants]", caught instanceof Error ? caught.message : "failed");
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
