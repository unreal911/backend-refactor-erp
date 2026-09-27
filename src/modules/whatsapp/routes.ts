import { Router } from "express";
import { WhatsAppWebhookController } from "./webhook.controller";

export function registerWhatsAppRoutes(router: Router): void {
    const controller = new WhatsAppWebhookController();
    router.get("/api/public/whatsapp/webhook", controller.verify);
    router.post("/api/public/whatsapp/webhook", controller.receive);
}
