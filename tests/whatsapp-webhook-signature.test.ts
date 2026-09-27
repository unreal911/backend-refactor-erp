import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWhatsAppWebhookSignature } from "../src/config/whatsapp";
import { extractWhatsAppAttentionEvents, parseWhatsAppWebhookEvent } from "../src/modules/whatsapp/webhook.controller";

describe("firma del webhook de WhatsApp", () => {
    const secret = "app-secret-de-prueba";
    const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));

    it("acepta la firma HMAC SHA-256 de Meta", () => {
        const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");
        expect(verifyWhatsAppWebhookSignature(body, `sha256=${digest}`, secret)).toBe(true);
    });

    it("rechaza firma ausente, alterada o con otro payload", () => {
        const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");
        expect(verifyWhatsAppWebhookSignature(body, "", secret)).toBe(false);
        expect(verifyWhatsAppWebhookSignature(Buffer.from("alterado"), `sha256=${digest}`, secret)).toBe(false);
        expect(verifyWhatsAppWebhookSignature(body, `sha256=${"0".repeat(64)}`, secret)).toBe(false);
    });
});

describe("contenido del webhook de WhatsApp", () => {
    it("resume mensajes y estados sin conservar contenido o teléfonos", () => {
        const summary = parseWhatsAppWebhookEvent({
            object: "whatsapp_business_account",
            entry: [{ changes: [{ field: "messages", value: {
                messages: [{ id: "wamid.1", from: "51999999999", text: { body: "secreto" } }],
                statuses: [{ id: "wamid.2", status: "delivered" }, { id: "wamid.3", status: "read" }],
            } }] }],
        });
        expect(summary).toEqual({ entries: 1, messages: 1, statuses: 2, statusValues: ["delivered", "read"] });
        expect(JSON.stringify(summary)).not.toContain("51999999999");
        expect(JSON.stringify(summary)).not.toContain("secreto");
    });

    it("rechaza eventos ajenos a WhatsApp Business", () => {
        expect(() => parseWhatsAppWebhookEvent({ object: "page", entry: [] })).toThrow(/no soportado/i);
    });

    it("extrae mensajes y confirmaciones que alimentan la bandeja", () => {
        const events = extractWhatsAppAttentionEvents({
            object: "whatsapp_business_account",
            entry: [{ changes: [{ field: "messages", value: {
                metadata: { phone_number_id: "123456789" },
                contacts: [{ wa_id: "51999999999", profile: { name: "Cliente Meta" } }],
                messages: [{ id: "wamid.in", from: "51999999999", type: "text", text: { body: "Quiero comprar" } }],
                statuses: [{ id: "wamid.out", status: "read" }],
            } }] }],
        });
        expect(events).toEqual([
            { kind: "message", phone: "51999999999", name: "Cliente Meta", providerMessageId: "wamid.in", type: "TEXT", body: "Quiero comprar", phoneNumberId: "123456789" },
            { kind: "status", providerMessageId: "wamid.out", status: "READ", phoneNumberId: "123456789" },
        ]);
    });

    it("conserva el motivo de un mensaje rechazado por Meta", () => {
        const events = extractWhatsAppAttentionEvents({
            entry: [{ changes: [{ field: "messages", value: {
                metadata: { phone_number_id: "123456789" },
                statuses: [{ id: "wamid.fail", status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] }],
            } }] }],
        });
        expect(events).toEqual([{ kind: "status", providerMessageId: "wamid.fail", status: "FAILED",
            phoneNumberId: "123456789", errorCode: "131026", errorMessage: "Message undeliverable" }]);
    });
});
