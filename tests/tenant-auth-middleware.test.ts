import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    verify: vi.fn(),
    sign: vi.fn(),
    resolveAuthenticatedContext: vi.fn(),
    resolvePermissionsForTenantRole: vi.fn(),
    platformAdminFindFirst: vi.fn(),
    userFindUnique: vi.fn(),
    runTenantDatabaseTransaction: vi.fn(),
}));

vi.mock("jsonwebtoken", () => ({
    default: {
        verify: mocks.verify,
        sign: mocks.sign,
        TokenExpiredError: class TokenExpiredError extends Error {},
    },
}));

vi.mock("../src/modules/tenant/tenant-context.service", async (importOriginal) => {
    const original = await importOriginal<
        typeof import("../src/modules/tenant/tenant-context.service")
    >();
    return {
        ...original,
        TenantContextService: {
            ...original.TenantContextService,
            roleToRbacRole: original.TenantContextService.roleToRbacRole,
            resolveAuthenticatedContext: mocks.resolveAuthenticatedContext,
        },
    };
});

vi.mock("../src/modules/auth/services/permission.service", () => ({
    PermissionService: {
        normalizeRole: (value: string) => value.toUpperCase(),
        resolvePermissionsForTenantRole: mocks.resolvePermissionsForTenantRole,
    },
}));

vi.mock("../src/data/prisma", () => ({
    platformPrisma: {
        user: {
            findUnique: mocks.userFindUnique,
        },
        platformAdmin: {
            findFirst: mocks.platformAdminFindFirst,
        },
    },
    runTenantDatabaseTransaction:
        mocks.runTenantDatabaseTransaction,
}));

vi.mock("../src/config/envs", () => ({
    envs: {
        JWT_SECRET: "test-secret",
    },
}));

import { AuthMiddleware, AuthRequest } from "../src/presentation/auth/middleware";
import { TenantContextService } from "../src/modules/tenant/tenant-context.service";
import { TenantMembershipRole } from "@prisma/client";

const context = {
    tenant: {
        id: "00000000-0000-4000-8000-000000000001",
        slug: "legacy-main",
        name: "Empresa principal",
        status: "ACTIVE",
        databaseMode: "SHARED",
        trialEndsAt: null,
    },
    membership: {
        id: "10000000-0000-4000-8000-000000000001",
        role: "OWNER",
        status: "ACTIVE",
    },
    rbacRole: "ADMIN",
};

function responseDouble() {
    const response = {
        status: vi.fn(),
        json: vi.fn(),
        setHeader: vi.fn(),
    };
    response.status.mockReturnValue(response);
    response.json.mockReturnValue(response);
    return response;
}

function requestDouble(headers: Record<string, string> = {}): AuthRequest {
    const normalized = Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
    return {
        header: (name: string) => normalized[name.toLowerCase()],
    } as AuthRequest;
}

describe("AuthMiddleware tenant-aware", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.verify.mockReturnValue({
            scope: "tenant",
            id: 7,
            email: "owner@tienda.test",
            role: "ADMIN",
            permissions: ["users.view"],
            tenantId: context.tenant.id,
            tenantSlug: context.tenant.slug,
            membershipId: context.membership.id,
            tenantRole: context.membership.role,
        });
        mocks.resolveAuthenticatedContext.mockResolvedValue(context);
        mocks.userFindUnique.mockResolvedValue({ authVersion: 0, isActive: true });
        mocks.sign.mockReturnValue("refreshed-token");
        mocks.runTenantDatabaseTransaction.mockImplementation(
            async (_tenantId: string, callback: () => Promise<unknown>) =>
                callback(),
        );
    });

    it("resuelve contexto desde la membresía firmada y renueva el token", async () => {
        const req = requestDouble({ Authorization: "Bearer token" });
        const res = responseDouble();
        const next = vi.fn();

        await AuthMiddleware.validateJWT(req, res as never, next);

        expect(next).toHaveBeenCalledOnce();
        expect(req.tenant).toEqual(context);
        expect(req.user?.role).toBe("ADMIN");
        expect(res.setHeader).toHaveBeenCalledWith("x-access-token", "refreshed-token");
    });

    it("rechaza un encabezado que intenta cambiar de empresa", async () => {
        const req = requestDouble({
            Authorization: "Bearer token",
            "x-tenant-slug": "empresa-ajena",
        });
        const res = responseDouble();
        const next = vi.fn();

        await AuthMiddleware.validateJWT(req, res as never, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it("una ruta tenant-aware falla cerrada sin contexto", () => {
        const req = requestDouble();
        const res = responseDouble();
        const next = vi.fn();

        AuthMiddleware.requireTenantContext(req, res as never, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it("rechaza un JWT valido cuando el rol no tiene el permiso funcional", async () => {
        const req = requestDouble();
        req.user = { id: 7, email: "seller@tienda.test", role: "SELLER" };
        req.tenant = { ...context, rbacRole: "SELLER" } as AuthRequest["tenant"];
        const res = responseDouble();
        const next = vi.fn();
        mocks.resolvePermissionsForTenantRole.mockResolvedValue(["products.view"]);

        await AuthMiddleware.requirePermission("products.update")(req, res as never, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it("acepta cualquiera de los permisos alternativos declarados por la ruta", async () => {
        const req = requestDouble();
        req.user = { id: 7, email: "seller@tienda.test", role: "SELLER" };
        req.tenant = { ...context, rbacRole: "SELLER" } as AuthRequest["tenant"];
        const res = responseDouble();
        const next = vi.fn();
        mocks.resolvePermissionsForTenantRole.mockResolvedValue(["pos.sell"]);

        await AuthMiddleware.requirePermission(["orders.create", "pos.sell"])(req, res as never, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it("acepta el permiso comodin administrativo", async () => {
        const req = requestDouble();
        req.user = { id: 7, email: "owner@tienda.test", role: "ADMIN" };
        req.tenant = context as AuthRequest["tenant"];
        const res = responseDouble();
        const next = vi.fn();
        mocks.resolvePermissionsForTenantRole.mockResolvedValue(["*"]);

        await AuthMiddleware.requirePermission("sunat.documents.cancel")(req, res as never, next);

        expect(next).toHaveBeenCalledOnce();
    });

    it("un token tenant nunca se acepta como token de plataforma", async () => {
        const req = requestDouble({ Authorization: "Bearer token" });
        const res = responseDouble();
        const next = vi.fn();

        await AuthMiddleware.validatePlatformJWT(req, res as never, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
        expect(mocks.platformAdminFindFirst).not.toHaveBeenCalled();
    });
});

describe("mapeo de roles de membresia a RBAC", () => {
    it.each([
        [TenantMembershipRole.OWNER, "ADMIN"],
        [TenantMembershipRole.ADMIN, "ADMIN"],
        [TenantMembershipRole.MANAGER, "MANAGER"],
        [TenantMembershipRole.SELLER, "SELLER"],
        [TenantMembershipRole.WAREHOUSE, "WAREHOUSE"],
        [TenantMembershipRole.PICKER, "PICKER"],
        [TenantMembershipRole.VIEWER, "USER"],
    ])("mapea %s sin escalar ni degradar permisos", (membershipRole, expected) => {
        expect(TenantContextService.roleToRbacRole(membershipRole)).toBe(expected);
    });
});
