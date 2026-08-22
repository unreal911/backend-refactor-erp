import { prisma } from "../../src/data/prisma";
import { LEGACY_TENANT_ID } from "../../src/modules/tenant/tenant-data-context";

export interface TenantTestUser {
    userId: number;
    createdMembershipId?: string;
    createdUserId?: number;
    createdRoleId?: number;
}

/**
 * Devuelve un usuario activo que realmente pertenece al tenant del test.
 * Si la base esta vacia, crea el grafo minimo y expone sus IDs para limpiarlo.
 */
export async function ensureTenantTestUser(
    prefix: string,
    tenantId = LEGACY_TENANT_ID,
): Promise<TenantTestUser> {
    const membership = await prisma.tenantMembership.findFirst({
        where: {
            tenantId,
            status: "ACTIVE",
            user: { isActive: true },
        },
        orderBy: { userId: "asc" },
        select: { userId: true },
    });

    if (membership) return { userId: membership.userId };

    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const existingRole = await prisma.role.findFirst({ orderBy: { id: "asc" } });
    const role = existingRole ?? await prisma.role.create({
        data: { name: `${prefix} Role ${tag}` },
    });
    const user = await prisma.user.create({
        data: {
            firstName: prefix,
            lastName: "Test",
            email: `${prefix.toLowerCase()}-${tag}@test.local`,
            password: "x",
            roleId: role.id,
        },
    });
    const createdMembership = await prisma.tenantMembership.create({
        data: {
            tenantId,
            userId: user.id,
            role: "ADMIN",
            status: "ACTIVE",
            activatedAt: new Date(),
        },
    });

    return {
        userId: user.id,
        createdMembershipId: createdMembership.id,
        createdUserId: user.id,
        createdRoleId: existingRole ? undefined : role.id,
    };
}
