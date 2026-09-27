import { Router } from "express";
import { AuthMiddleware } from "../../presentation/auth/middleware";
import { AttentionController } from "./controller";
import { WhatsAppConnectionController } from "./whatsapp-connection.controller";

export function registerAttentionRoutes(router: Router): void {
    const controller = new AttentionController();
    const connection = new WhatsAppConnectionController();
    const authenticated = AuthMiddleware.validateJWT;
    const enabled = AuthMiddleware.requirePlanFeature("attention.inbox");

    router.get("/api/attention/whatsapp/connection", authenticated, enabled, AuthMiddleware.requirePermission("attention.view"), connection.status);
    router.post("/api/attention/whatsapp/connection", authenticated, enabled, AuthMiddleware.requireTenantOwner, connection.connect);
    router.post("/api/attention/whatsapp/disconnect", authenticated, enabled, AuthMiddleware.requireTenantOwner, connection.disconnect);

    router.get("/api/attention/conversations", authenticated, enabled, AuthMiddleware.requirePermission("attention.view"), controller.list);
    router.get("/api/attention/metrics", authenticated, enabled, AuthMiddleware.requirePermission("attention.view"), controller.metrics);
    router.get("/api/attention/templates", authenticated, enabled, AuthMiddleware.requirePermission("attention.view"), controller.templates);
    router.get("/api/attention/orders/:orderId/cases", authenticated, enabled, AuthMiddleware.requirePermission("attention.view"), controller.orderCases);
    router.post("/api/attention/templates", authenticated, enabled, AuthMiddleware.requirePermission("attention.manage"), controller.createTemplate);
    router.patch("/api/attention/templates/:id", authenticated, enabled, AuthMiddleware.requirePermission("attention.manage"), controller.updateTemplate);
    router.get("/api/attention/conversations/:id", authenticated, enabled, AuthMiddleware.requirePermission("attention.view"), controller.get);
    router.post("/api/attention/conversations", authenticated, enabled, AuthMiddleware.requirePermission("attention.manage"), controller.create);
    router.patch("/api/attention/conversations/:id", authenticated, enabled, AuthMiddleware.requirePermission("attention.manage"), controller.update);
    router.post("/api/attention/conversations/:id/messages", authenticated, enabled, AuthMiddleware.requirePermission("attention.manage"), controller.send);
    router.post("/api/attention/conversations/:id/messages/local-inbound", authenticated, enabled, AuthMiddleware.requirePermission("attention.manage"), controller.receiveLocal);
    router.post("/api/attention/conversations/:id/orders", authenticated, enabled, AuthMiddleware.requirePermission("attention.manage"), controller.linkOrder);
    router.patch("/api/attention/cases/:caseId/summary", authenticated, enabled, AuthMiddleware.requirePermission("attention.manage"), controller.updateCaseSummary);
    router.post("/api/attention/cases/:caseId/notes", authenticated, enabled, AuthMiddleware.requirePermission("attention.manage"), controller.createFollowUp);
    router.patch("/api/attention/notes/:noteId", authenticated, enabled, AuthMiddleware.requirePermission("attention.manage"), controller.updateFollowUp);
}
