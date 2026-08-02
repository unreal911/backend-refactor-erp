import { Router } from "express";
import { AuthMiddleware } from "../../presentation/auth/middleware";
import { authRateLimiter } from "../../presentation/middlewares/rate-limit";
import { TenantInvitationController } from "./controller";
import { createTenantInvitationServiceFromEnvironment } from "./factory";
import { TenantInvitationService } from "./tenant-invitation.service";

export function registerTenantInvitationRoutes(
    router: Router,
    service: TenantInvitationService | null = createTenantInvitationServiceFromEnvironment(),
): void {
    const controller = new TenantInvitationController(service);
    router.post(
        "/api/tenant/invitations",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requireTenantContext,
        controller.create,
    );
    router.get(
        "/api/tenant/invitations",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requireTenantContext,
        controller.list,
    );
    router.delete(
        "/api/tenant/invitations/:id",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requireTenantContext,
        controller.revoke,
    );
    router.post(
        "/api/public/invitations/inspect",
        authRateLimiter,
        controller.inspect,
    );
    router.post(
        "/api/public/invitations/accept",
        authRateLimiter,
        controller.accept,
    );
}
