import { Router } from "express";
import { envs } from "../../config/envs";
import { AuthMiddleware } from "../../presentation/auth/middleware";
import { BillingWebhookService } from "./billing-webhook.service";
import { BillingWebhookController, TenantLifecycleController } from "./controller";

export function registerTenantLifecycleRoutes(router: Router): void {
    const lifecycle = new TenantLifecycleController();
    const billingService = envs.BILLING_WEBHOOK_ENABLED
        ? new BillingWebhookService(envs.BILLING_WEBHOOK_SECRET)
        : null;
    const billing = new BillingWebhookController(billingService);

    router.get(
        "/api/tenant/lifecycle",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requireTenantContext,
        lifecycle.current,
    );
    router.put(
        "/api/tenant/legal-profile",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requireTenantContext,
        lifecycle.updateLegalProfile,
    );
    router.get(
        "/api/tenant/export",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requireTenantContext,
        AuthMiddleware.requirePermission("tenant.data.export"),
        lifecycle.exportData,
    );
    router.post(
        "/api/platform/tenants/lifecycle/expire",
        AuthMiddleware.validatePlatformJWT,
        lifecycle.expireTrials,
    );
    router.post(
        "/api/platform/tenants/lifecycle/purge",
        AuthMiddleware.validatePlatformJWT,
        lifecycle.purgeTrials,
    );
    router.post(
        "/api/platform/tenants/:tenantId/approve-production",
        AuthMiddleware.validatePlatformJWT,
        lifecycle.approveProduction,
    );
    router.post("/api/public/billing/webhook/:provider", billing.process);
}
