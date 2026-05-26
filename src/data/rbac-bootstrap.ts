import { prisma } from './prisma';
import { PermissionService } from '../presentation/services/permission.service';

const RBAC_SCHEMA_STATEMENTS: string[] = [
    'ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "description" TEXT',
    'ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true',
    `CREATE TABLE IF NOT EXISTS "Permission" (
        "id" SERIAL NOT NULL,
        "code" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "module" TEXT NOT NULL,
        "description" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "RolePermission" (
        "id" SERIAL NOT NULL,
        "roleId" INTEGER NOT NULL,
        "permissionId" INTEGER NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS "Permission_code_key" ON "Permission"("code")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId")',
    `DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'RolePermission_roleId_fkey'
        ) THEN
            ALTER TABLE "RolePermission"
            ADD CONSTRAINT "RolePermission_roleId_fkey"
            FOREIGN KEY ("roleId") REFERENCES "Role"("id")
            ON DELETE CASCADE
            ON UPDATE CASCADE;
        END IF;
    END $$`,
    `DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'RolePermission_permissionId_fkey'
        ) THEN
            ALTER TABLE "RolePermission"
            ADD CONSTRAINT "RolePermission_permissionId_fkey"
            FOREIGN KEY ("permissionId") REFERENCES "Permission"("id")
            ON DELETE CASCADE
            ON UPDATE CASCADE;
        END IF;
    END $$`
];

export async function ensureRbacSchema(): Promise<void> {
    for (const statement of RBAC_SCHEMA_STATEMENTS) {
        await prisma.$executeRawUnsafe(statement);
    }

    const roles = await prisma.role.findMany({
        select: {
            id: true,
            name: true
        }
    });

    const roleNameById = new Map<number, string>(roles.map((role) => [role.id, role.name]));
    await PermissionService.seedDefaultPermissionsForRoles(roleNameById);
}
