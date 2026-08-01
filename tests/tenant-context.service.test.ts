import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/data/prisma", () => {
    const client = {
        tenantMembership: {
            findMany: vi.fn(),
            findFirst: vi.fn(),
        },
        tenant: {
            findUnique: vi.fn(),
        },
    };
    return { prisma: client, platformPrisma: client };
});

import { prisma } from "../src/data/prisma";
import {
    TenantAccessError,
    TenantContextService,
    TenantSelectionRequiredError,
} from "../src/modules/tenant/tenant-context.service";

function membership(overrides: Record<string, unknown> = {}) {
    return {
        id: "10000000-0000-4000-8000-000000000001",
        tenantId: "00000000-0000-4000-8000-000000000001",
        userId: 7,
        role: "OWNER",
        status: "ACTIVE",
        invitedAt: null,
        activatedAt: new Date("2026-07-29T00:00:00Z"),
        deactivatedAt: null,
        createdAt: new Date("2026-07-29T00:00:00Z"),
        updatedAt: new Date("2026-07-29T00:00:00Z"),
        user: { isActive: true },
        tenant: {
            id: "00000000-0000-4000-8000-000000000001",
            slug: "legacy-main",
            name: "Empresa principal",
            legalName: null,
            ruc: null,
            rucConfirmedAt: null,
            status: "ACTIVE",
            databaseMode: "SHARED",
            trialStartedAt: null,
            trialEndsAt: null,
            createdAt: new Date("2026-07-29T00:00:00Z"),
            updatedAt: new Date("2026-07-29T00:00:00Z"),
        },
        ...overrides,
    };
}

describe("TenantContextService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("resuelve automáticamente la única membresía activa", async () => {
        vi.mocked(prisma.tenantMembership.findMany).mockResolvedValueOnce([
            membership(),
        ] as never);

        const context = await TenantContextService.resolveForLogin(7);

        expect(context.tenant.slug).toBe("legacy-main");
        expect(context.membership.role).toBe("OWNER");
        expect(context.rbacRole).toBe("ADMIN");
    });

    it("exige selección explícita cuando hay varias empresas", async () => {
        vi.mocked(prisma.tenantMembership.findMany).mockResolvedValueOnce([
            membership(),
            membership({
                id: "10000000-0000-4000-8000-000000000002",
                tenantId: "00000000-0000-4000-8000-000000000002",
                tenant: {
                    ...membership().tenant,
                    id: "00000000-0000-4000-8000-000000000002",
                    slug: "segunda-empresa",
                    name: "Segunda empresa",
                },
            }),
        ] as never);

        await expect(TenantContextService.resolveForLogin(7))
            .rejects.toBeInstanceOf(TenantSelectionRequiredError);
    });

    it("un slug enviado por el cliente no concede acceso sin membresía", async () => {
        vi.mocked(prisma.tenantMembership.findMany).mockResolvedValueOnce([
            membership(),
        ] as never);

        await expect(
            TenantContextService.resolveForLogin(7, "empresa-ajena"),
        ).rejects.toBeInstanceOf(TenantAccessError);
    });

    it("rechaza tenant suspendido o prueba vencida", async () => {
        vi.mocked(prisma.tenantMembership.findMany)
            .mockResolvedValueOnce([
                membership({
                    tenant: {
                        ...membership().tenant,
                        status: "SUSPENDED",
                    },
                }),
            ] as never)
            .mockResolvedValueOnce([
                membership({
                    tenant: {
                        ...membership().tenant,
                        status: "TRIAL",
                        trialEndsAt: new Date("2020-01-01T00:00:00Z"),
                    },
                }),
            ] as never);

        await expect(TenantContextService.resolveForLogin(7))
            .rejects.toThrow("No tienes una empresa activa");
        await expect(TenantContextService.resolveForLogin(7))
            .rejects.toThrow("No tienes una empresa activa");
    });

    it("revalida usuario, membresía y tenant en cada petición", async () => {
        vi.mocked(prisma.tenantMembership.findFirst).mockResolvedValueOnce(
            membership({ status: "INACTIVE", deactivatedAt: new Date() }) as never,
        );

        await expect(
            TenantContextService.resolveAuthenticatedContext({
                userId: 7,
                tenantId: "00000000-0000-4000-8000-000000000001",
                membershipId: "10000000-0000-4000-8000-000000000001",
            }),
        ).rejects.toThrow("Membresía inactiva");
    });

    it("los jobs también resuelven un contexto tenant cerrado", async () => {
        vi.mocked(prisma.tenant.findUnique)
            .mockResolvedValueOnce({
                id: "00000000-0000-4000-8000-000000000001",
                slug: "legacy-main",
                status: "ACTIVE",
                trialEndsAt: null,
            } as never)
            .mockResolvedValueOnce({
                id: "00000000-0000-4000-8000-000000000001",
                slug: "legacy-main",
                status: "SUSPENDED",
                trialEndsAt: null,
            } as never);

        await expect(
            TenantContextService.resolveJobContext({
                tenantId: "00000000-0000-4000-8000-000000000001",
                jobType: "MIGRATION_BACKFILL",
                correlationId: "job-123",
            }),
        ).resolves.toMatchObject({
            tenantSlug: "legacy-main",
            jobType: "MIGRATION_BACKFILL",
        });

        await expect(
            TenantContextService.resolveJobContext({
                tenantId: "00000000-0000-4000-8000-000000000001",
                jobType: "MIGRATION_BACKFILL",
                correlationId: "job-124",
            }),
        ).rejects.toThrow("Empresa no disponible");
    });
});
