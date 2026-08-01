import { Router } from "express";
import { AuthMiddleware } from "../../presentation/auth/middleware";
import { TenantController } from "./controller";

export function registerTenantModuleRoutes(router: Router): void {
    router.get(
        "/api/tenant/context",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requireTenantContext,
        TenantController.current,
    );
    router.get(
        "/api/tenant/memberships",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requireTenantContext,
        TenantController.listMine,
    );
}
