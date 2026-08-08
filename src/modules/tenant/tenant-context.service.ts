import {
    TenantDatabaseMode,
    TenantMembershipRole,
    TenantMembershipStatus,
    TenantStatus,
} from "@prisma/client";
import { platformPrisma as prisma } from "../../data/platform-prisma";

export type TenantRequestContext = {
    tenant: {
        id: string;
        slug: string;
        name: string;
        status: TenantStatus;
        databaseMode: TenantDatabaseMode;
        trialEndsAt: Date | null;
        readOnly: boolean;
    };
    membership: {
        id: string;
        role: TenantMembershipRole;
        status: TenantMembershipStatus;
    };
    rbacRole: string;
};

export type AvailableTenant = {
    id: string;
    slug: string;
    name: string;
    role: TenantMembershipRole;
};

export type TenantJobContext = {
    tenantId: string;
    tenantSlug: string;
    jobType: string;
    correlationId: string;
};

export class TenantAccessError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number = 403,
    ) {
        super(message);
        this.name = "TenantAccessError";
    }
}

export class TenantSelectionRequiredError extends TenantAccessError {
    constructor(public readonly tenants: AvailableTenant[]) {
        super("Selecciona una empresa para continuar", 409);
        this.name = "TenantSelectionRequiredError";
    }
}

type MembershipWithTenant = Awaited<
    ReturnType<typeof TenantContextService.findMembershipsForUser>
>[number];

export class TenantContextService {
    private static assertTenantAvailable<T extends {
            status: TenantStatus;
            trialEndsAt: Date | null;
        }>(
        tenant: T | null | undefined,
        now: Date = new Date(),
        allowReadOnly = true,
    ): asserts tenant is T {
        if (!tenant) {
            throw new TenantAccessError("Empresa no disponible");
        }
        if (tenant.status === TenantStatus.TRIAL) {
            if (tenant.trialEndsAt && tenant.trialEndsAt.getTime() <= now.getTime()) {
                throw new TenantAccessError("Periodo de prueba vencido");
            }
            return;
        }
        if (
            allowReadOnly
            && (tenant.status === TenantStatus.EXPIRED || tenant.status === TenantStatus.SUSPENDED)
        ) {
            return;
        }
        if (tenant.status !== TenantStatus.ACTIVE) {
            throw new TenantAccessError("Empresa no disponible");
        }
    }

    static roleToRbacRole(role: TenantMembershipRole): string {
        switch (role) {
            case TenantMembershipRole.OWNER:
            case TenantMembershipRole.ADMIN:
                return "ADMIN";
            case TenantMembershipRole.SELLER:
                return "SELLER";
            case TenantMembershipRole.VIEWER:
            default:
                return "USER";
        }
    }

    static async findMembershipsForUser(userId: number) {
        return prisma.tenantMembership.findMany({
            where: { userId },
            include: {
                tenant: true,
                user: {
                    select: {
                        isActive: true,
                    },
                },
            },
            orderBy: [
                { tenant: { name: "asc" } },
                { createdAt: "asc" },
            ],
        });
    }

    private static assertMembershipAvailable(
        membership: MembershipWithTenant | null | undefined,
        now: Date = new Date(),
    ): asserts membership is MembershipWithTenant {
        if (!membership || !membership.user.isActive) {
            throw new TenantAccessError("Acceso a empresa no disponible");
        }
        if (membership.status !== TenantMembershipStatus.ACTIVE) {
            throw new TenantAccessError("Membresía inactiva");
        }

        this.assertTenantAvailable(membership.tenant, now);
    }

    private static toContext(membership: MembershipWithTenant): TenantRequestContext {
        return {
            tenant: {
                id: membership.tenant.id,
                slug: membership.tenant.slug,
                name: membership.tenant.name,
                status: membership.tenant.status,
                databaseMode: membership.tenant.databaseMode,
                trialEndsAt: membership.tenant.trialEndsAt,
                readOnly: membership.tenant.status === TenantStatus.EXPIRED
                    || membership.tenant.status === TenantStatus.SUSPENDED,
            },
            membership: {
                id: membership.id,
                role: membership.role,
                status: membership.status,
            },
            rbacRole: this.roleToRbacRole(membership.role),
        };
    }

    static async resolveForLogin(
        userId: number,
        requestedTenantSlug?: string,
    ): Promise<TenantRequestContext> {
        const memberships = await this.findMembershipsForUser(userId);

        if (requestedTenantSlug) {
            const requested = memberships.find(
                (membership) => membership.tenant.slug === requestedTenantSlug,
            );
            this.assertMembershipAvailable(requested);
            return this.toContext(requested);
        }

        const available = memberships.filter((membership) => {
            try {
                this.assertMembershipAvailable(membership);
                return true;
            } catch {
                return false;
            }
        });

        if (available.length === 0) {
            throw new TenantAccessError("No tienes una empresa activa");
        }
        if (available.length > 1) {
            throw new TenantSelectionRequiredError(
                available.map((membership) => ({
                    id: membership.tenant.id,
                    slug: membership.tenant.slug,
                    name: membership.tenant.name,
                    role: membership.role,
                })),
            );
        }

        const selected = available[0];
        if (!selected) {
            throw new TenantAccessError("No tienes una empresa activa");
        }
        return this.toContext(selected);
    }

    static async resolveAuthenticatedContext(input: {
        userId: number;
        tenantId: string;
        membershipId: string;
    }): Promise<TenantRequestContext> {
        const membership = await prisma.tenantMembership.findFirst({
            where: {
                id: input.membershipId,
                userId: input.userId,
                tenantId: input.tenantId,
            },
            include: {
                tenant: true,
                user: {
                    select: {
                        isActive: true,
                    },
                },
            },
        });

        this.assertMembershipAvailable(membership);
        return this.toContext(membership);
    }

    static async listAvailableTenants(userId: number): Promise<AvailableTenant[]> {
        const memberships = await this.findMembershipsForUser(userId);
        return memberships.flatMap((membership) => {
            try {
                this.assertMembershipAvailable(membership);
            } catch {
                return [];
            }
            return [{
                id: membership.tenant.id,
                slug: membership.tenant.slug,
                name: membership.tenant.name,
                role: membership.role,
            }];
        });
    }

    static async resolveJobContext(input: {
        tenantId: string;
        jobType: string;
        correlationId: string;
    }): Promise<TenantJobContext> {
        const jobType = String(input.jobType || "").trim().slice(0, 80);
        const correlationId = String(input.correlationId || "").trim().slice(0, 120);
        if (!jobType || !correlationId) {
            throw new TenantAccessError("El job requiere tipo y correlación", 400);
        }

        const tenant = await prisma.tenant.findUnique({
            where: { id: input.tenantId },
            select: {
                id: true,
                slug: true,
                status: true,
                trialEndsAt: true,
            },
        });
        this.assertTenantAvailable(tenant, new Date(), false);

        return {
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            jobType,
            correlationId,
        };
    }
}
