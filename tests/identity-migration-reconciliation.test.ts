import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from "vitest";
import { prisma } from "../src/data/prisma";
import { seedRbacDefaults } from "../src/data/rbac-bootstrap";
import { seedLegacyTenantMemberships } from "../src/data/tenant-bootstrap";
import { inspectIdentityMigration } from "../src/modules/tenant/identity-reconciliation";
import {
    LEGACY_TENANT_ID,
    TenantDataContext,
} from "../src/modules/tenant/tenant-data-context";
import { AuthService } from "../src/presentation/services/auth.service";
import { RoleService } from "../src/presentation/services/role.service";

const tag = Date.now().toString(36);
const createdMembershipIds: string[] = [];
const createdUserIds: number[] = [];
let dbReady = false;
let historicalBaselineReady = false;

function digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function identityFingerprints() {
    const [users, matrix] = await Promise.all([
        prisma.user.findMany({
            where: { id: { in: [1, 2, 3] } },
            orderBy: { id: "asc" },
            select: { id: true, password: true },
        }),
        prisma.rolePermission.findMany({
            orderBy: [{ roleId: "asc" }, { permissionId: "asc" }, { id: "asc" }],
            select: {
                roleId: true,
                permissionId: true,
            },
        }),
    ]);
    return {
        passwords: digest(users),
        matrix: digest(matrix),
    };
}

beforeAll(async () => {
    const migration = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
        `SELECT migration_name
         FROM "_prisma_migrations"
         WHERE migration_name = '20260729160000_close_identity_reconciliation'
           AND finished_at IS NOT NULL`,
    ).catch(() => []);
    dbReady = migration.length === 1;
    historicalBaselineReady = dbReady
        && await prisma.user.count({
            where: { id: { in: [1, 2, 3] } },
        }).catch(() => 0) === 3;
});

afterAll(async () => {
    if (createdMembershipIds.length > 0) {
        await prisma.tenantMembership.deleteMany({
            where: { id: { in: createdMembershipIds } },
        }).catch(() => undefined);
    }
    if (createdUserIds.length > 0) {
        await prisma.user.deleteMany({
            where: { id: { in: createdUserIds } },
        }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
});

describe("MIG-003: conciliación de identidad", () => {
    it("concilia línea base, membresías y referencias históricas", async (ctx) => {
        if (!dbReady || !historicalBaselineReady) return ctx.skip();

        const summary = await inspectIdentityMigration();
        expect(summary.userCount).toBe(3);
        expect(summary.ownerUserId).toBeGreaterThan(0);
        expect(summary.roleCount).toBe(6);
        expect(summary.permissionCount).toBeGreaterThanOrEqual(47);
        expect(summary.rolePermissionCount).toBe(88);
        expect(summary.compatiblePasswordCount).toBe(3);
        expect(summary.referenceCount).toBe(22);
        expect(summary.tenantMembershipForeignKeys).toBeGreaterThanOrEqual(21);
    });

    it("mantiene byte por byte hashes y matriz RBAC al reejecutar seeds", async (ctx) => {
        if (!dbReady || !historicalBaselineReady) return ctx.skip();

        const before = await identityFingerprints();
        await seedRbacDefaults();
        await seedLegacyTenantMemberships();
        const after = await identityFingerprints();

        expect(after).toEqual(before);
    });

    it("no concede legacy-main a usuarios creados después del checkpoint", async (ctx) => {
        if (!dbReady || !historicalBaselineReady) return ctx.skip();

        const userRole = await prisma.role.findUnique({ where: { name: "USER" } });
        expect(userRole).toBeTruthy();
        const outsider = await prisma.user.create({
            data: {
                firstName: "Outside",
                lastName: "Tenant",
                email: `mig003-outside-${tag}@example.test`,
                password: await bcrypt.hash("MigrationTest123!", 4),
                roleId: userRole!.id,
                isActive: true,
            },
        });
        createdUserIds.push(outsider.id);

        await seedLegacyTenantMemberships();

        expect(await prisma.tenantMembership.count({
            where: {
                tenantId: LEGACY_TENANT_ID,
                userId: outsider.id,
            },
        })).toBe(0);
    });

    it("prueba login, autorización y desactivación para los cuatro perfiles", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const roles = await prisma.role.findMany({
            where: { name: { in: ["ADMIN", "SELLER", "USER"] } },
        });
        const roleByName = new Map(roles.map((role) => [role.name, role]));
        const password = "MigrationTest123!";
        const fixtures = [
            { membershipRole: "OWNER", globalRole: "ADMIN", rbacRole: "ADMIN", permission: "*" },
            { membershipRole: "ADMIN", globalRole: "ADMIN", rbacRole: "ADMIN", permission: "*" },
            { membershipRole: "SELLER", globalRole: "SELLER", rbacRole: "SELLER", permission: "products.view" },
            { membershipRole: "VIEWER", globalRole: "USER", rbacRole: "USER", permission: "dashboard.view" },
        ] as const;
        let sellerMembershipId: string | null = null;

        for (const fixture of fixtures) {
            const globalRole = roleByName.get(fixture.globalRole);
            expect(globalRole).toBeTruthy();
            const user = await prisma.user.create({
                data: {
                    firstName: fixture.membershipRole,
                    lastName: "Migration",
                    email: `mig003-${fixture.membershipRole.toLowerCase()}-${tag}@example.test`,
                    password: await bcrypt.hash(password, 4),
                    roleId: globalRole!.id,
                    isActive: true,
                },
            });
            createdUserIds.push(user.id);
            const membership = await prisma.tenantMembership.create({
                data: {
                    tenantId: LEGACY_TENANT_ID,
                    userId: user.id,
                    role: fixture.membershipRole,
                    status: "ACTIVE",
                    activatedAt: new Date(),
                },
            });
            createdMembershipIds.push(membership.id);
            if (fixture.membershipRole === "SELLER") {
                sellerMembershipId = membership.id;
            }

            const login = await AuthService.login({
                email: user.email,
                password,
                tenantSlug: "legacy-main",
            } as never);
            expect(login.user.role).toBe(fixture.rbacRole);
            expect(login.user.permissions).toContain(fixture.permission);
        }

        expect(sellerMembershipId).toBeTruthy();
        const sellerMembership = await prisma.tenantMembership.update({
            where: { id: sellerMembershipId! },
            data: {
                status: "INACTIVE",
                deactivatedAt: new Date(),
            },
            include: { user: true },
        });
        await expect(AuthService.login({
            email: sellerMembership.user.email,
            password,
            tenantSlug: "legacy-main",
        } as never)).rejects.toThrow("Membresía inactiva");
    });

    it("bloquea mutaciones del catálogo RBAC global desde un tenant", async (ctx) => {
        if (!dbReady) return ctx.skip();

        await expect(TenantDataContext.run(
            LEGACY_TENANT_ID,
            () => RoleService.create({
                name: `MIG003-${tag}`,
                description: "No debe crearse",
                isActive: true,
            } as never),
        )).rejects.toThrow("catálogo RBAC global");
    });
});
