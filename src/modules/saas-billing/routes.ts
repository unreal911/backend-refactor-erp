import { Router } from "express";
import { AuthMiddleware } from "../../presentation/auth/middleware";
import { SaasBillingController } from "./controller";

export function registerSaasBillingRoutes(router: Router): void {
    const controller = new SaasBillingController();
    router.get("/api/public/saas/plans", controller.listPublicPlans);
    router.get("/api/public/saas/payment-methods", controller.listPublicMethods);
    router.get(
        "/api/tenant/subscription/payment-requests",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requirePermission("subscription.view"),
        controller.listTenantRequests,
    );
    router.post(
        "/api/tenant/subscription/payment-requests",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requirePermission("subscription.request"),
        controller.createTenantRequest,
    );
    router.get(
        "/api/tenant/subscription/downgrade-preview/:planVersionId",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requirePermission("subscription.view"),
        controller.previewDowngrade,
    );
}
