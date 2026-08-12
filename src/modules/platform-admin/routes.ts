import { Router } from "express";
import { AuthMiddleware } from "../../presentation/auth/middleware";
import { PlanVersionController } from "./plan-version.controller";
import { ManualPaymentController } from "./manual-payment.controller";
import { PlatformOperationsController } from "./platform-operations.controller";
import { ImageProviderProfileController } from "./image-provider-profile.controller";
import { PlatformMfaController } from "./platform-mfa.controller";
import { PlatformAccessController } from "./platform-access.controller";

export function registerPlatformAdminRoutes(router: Router): void {
    const controller = new PlanVersionController();
    const payments = new ManualPaymentController();
    const operations = new PlatformOperationsController();
    const imageProviders = new ImageProviderProfileController();
    const mfa = new PlatformMfaController();
    const access = new PlatformAccessController();

    router.get("/api/public/saas/plans", controller.listPublic);
    router.get("/api/public/saas/payment-methods", payments.listPublicMethods);

    router.get(
        "/api/tenant/subscription/payment-requests",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requirePermission("subscription.view"),
        payments.listTenantRequests,
    );
    router.post(
        "/api/tenant/subscription/payment-requests",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requirePermission("subscription.request"),
        payments.createTenantRequest,
    );

    const platform = Router();
    platform.use(AuthMiddleware.validatePlatformJWT);
    platform.get("/security/mfa", mfa.status);
    platform.post("/security/mfa/enroll", mfa.begin);
    platform.post("/security/mfa/confirm", mfa.confirm);
    platform.get("/access", AuthMiddleware.requirePlatformPermission("platform.admins.manage"), access.list);
    platform.post("/access", AuthMiddleware.requirePlatformPermission("platform.admins.manage"), AuthMiddleware.requireRecentPlatformMfa, access.grant);
    platform.patch("/access/:id", AuthMiddleware.requirePlatformPermission("platform.admins.manage"), AuthMiddleware.requireRecentPlatformMfa, access.update);
    platform.get("/dashboard/metrics", AuthMiddleware.requirePlatformPermission("platform.dashboard.view"), operations.metrics);
    platform.get("/audit-events", AuthMiddleware.requirePlatformPermission("platform.audit.view"), operations.audit);
    platform.get("/tenants", AuthMiddleware.requirePlatformPermission("platform.tenants.view"), operations.tenants);
    platform.get("/image-providers", AuthMiddleware.requirePlatformPermission("platform.providers.view"), imageProviders.list);
    platform.post("/image-providers", AuthMiddleware.requirePlatformPermission("platform.providers.manage"), imageProviders.create);
    platform.patch("/image-providers/:id", AuthMiddleware.requirePlatformPermission("platform.providers.manage"), imageProviders.update);
    platform.post("/image-providers/:id/test", AuthMiddleware.requirePlatformPermission("platform.providers.manage"), imageProviders.test);
    platform.post("/image-providers/:id/activate", AuthMiddleware.requirePlatformPermission("platform.providers.switch"), AuthMiddleware.requireRecentPlatformMfa, imageProviders.activate);
    platform.get("/plans", AuthMiddleware.requirePlatformPermission("platform.plans.view"), controller.listPlatform);
    platform.patch("/plans/:code", AuthMiddleware.requirePlatformPermission("platform.plans.manage"), controller.updatePlan);
    platform.post("/plans/:code/versions", AuthMiddleware.requirePlatformPermission("platform.plans.manage"), controller.createDraft);
    platform.put("/plan-versions/:id", AuthMiddleware.requirePlatformPermission("platform.plans.manage"), controller.updateDraft);
    platform.post("/plan-versions/:id/validate", AuthMiddleware.requirePlatformPermission("platform.plans.view"), controller.validate);
    platform.post("/plan-versions/:id/schedule", AuthMiddleware.requirePlatformPermission("platform.plans.publish"), AuthMiddleware.requireRecentPlatformMfa, controller.schedule);
    platform.post("/plan-versions/:id/cancel", AuthMiddleware.requirePlatformPermission("platform.plans.publish"), controller.cancel);
    platform.post("/plan-versions/activate-due", AuthMiddleware.requirePlatformPermission("platform.plans.publish"), controller.activateDue);
    platform.get("/payment-methods", AuthMiddleware.requirePlatformPermission("platform.payments.view"), payments.listPlatformMethods);
    platform.post("/payment-methods", AuthMiddleware.requirePlatformPermission("platform.payments.manage"), payments.createMethod);
    platform.patch("/payment-methods/:id", AuthMiddleware.requirePlatformPermission("platform.payments.manage"), payments.updateMethod);
    platform.get("/payment-requests", AuthMiddleware.requirePlatformPermission("platform.payments.view"), payments.listPlatformRequests);
    platform.post("/payment-requests/:id/approve", AuthMiddleware.requirePlatformPermission("platform.payments.approve"), AuthMiddleware.requireRecentPlatformMfa, payments.approve);
    platform.post("/payment-requests/:id/reject", AuthMiddleware.requirePlatformPermission("platform.payments.approve"), AuthMiddleware.requireRecentPlatformMfa, payments.reject);

    router.use("/api/platform", platform);
}
