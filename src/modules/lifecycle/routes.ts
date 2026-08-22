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
    router.post(
        "/api/tenant/alerts/:alertId/dismiss",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requireTenantContext,
        lifecycle.dismissAlert,
    );
    router.put(
        "/api/tenant/primary-store",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requireTenantContext,
        lifecycle.setPrimaryStore,
    );
    router.get(
        "/api/tenant/export",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requireTenantContext,
        AuthMiddleware.requireTenantOwner,
        AuthMiddleware.requirePermission("tenant.data.export"),
        lifecycle.exportData,
    );
    router.post("/api/public/billing/webhook/:provider", billing.process);
}
