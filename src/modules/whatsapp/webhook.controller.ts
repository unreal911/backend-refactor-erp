import { Request, Response } from "express";
import { envs } from "../../config/envs";
import crypto from "node:crypto";
import { verifyWhatsAppWebhookSignature } from "../../config/whatsapp";
import { runTenantDatabaseTransaction } from "../../data/prisma";
import { AttentionService } from "../attention/attention.service";
import { AdminEventBus } from "../../presentation/admin-events/admin-event-bus";
import { WhatsAppConnectionService } from "../attention/whatsapp-connection.service";

type WhatsAppWebhookRequest = Request & {
    body?: unknown;
    rawBody?: Buffer;
};

function sameSecret(received: string, expected: string): boolean {
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);

    return receivedBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function queryValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}

export type WhatsAppWebhookSummary = {
    entries: number;
    messages: number;
    statuses: number;
    statusValues: string[];
};

export type WhatsAppAttentionEvent =
    | { kind: "message"; phone: string; name?: string; providerMessageId: string; type: string; body: string; phoneNumberId?: string }
    | { kind: "status"; providerMessageId: string; status: string; phoneNumberId?: string;
        errorCode?: string; errorMessage?: string };

function record(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function messageBody(message: Record<string, any>): string {
    const type = String(message.type || "unknown").toLowerCase();
    if (type === "text") return String(record(message.text).body || "").trim();
    if (type === "button") return String(record(message.button).text || "").trim();
    if (type === "interactive") {
        const interactive = record(message.interactive);
        return String(record(interactive.button_reply).title || record(interactive.list_reply).title || "Respuesta interactiva").trim();
    }
    const media = record(message[type]);
    return String(media.caption || media.filename || `[${type || "archivo"}]`).trim();
}

export function extractWhatsAppAttentionEvents(body: unknown): WhatsAppAttentionEvent[] {
    const root = record(body);
    const result: WhatsAppAttentionEvent[] = [];
    for (const rawEntry of Array.isArray(root.entry) ? root.entry : []) {
        for (const rawChange of Array.isArray(record(rawEntry).changes) ? record(rawEntry).changes : []) {
            const change = record(rawChange);
            if (change.field !== "messages") continue;
            const value = record(change.value);
            const phoneNumberId = String(record(value.metadata).phone_number_id || "").trim();
            const names = new Map<string, string>();
            for (const rawContact of Array.isArray(value.contacts) ? value.contacts : []) {
                const contact = record(rawContact);
                names.set(String(contact.wa_id || ""), String(record(contact.profile).name || "").trim());
            }
            for (const rawMessage of Array.isArray(value.messages) ? value.messages : []) {
                const message = record(rawMessage);
                const phone = String(message.from || "").trim();
                const providerMessageId = String(message.id || "").trim();
                const bodyValue = messageBody(message);
                if (phone && providerMessageId && bodyValue) {
                    const name = names.get(phone);
                    result.push({
                        kind: "message", phone, ...(name ? { name } : {}), providerMessageId,
                        type: String(message.type || "TEXT").toUpperCase(), body: bodyValue,
                        ...(phoneNumberId ? { phoneNumberId } : {}),
                    });
                }
            }
            for (const rawStatus of Array.isArray(value.statuses) ? value.statuses : []) {
                const status = record(rawStatus);
                const providerMessageId = String(status.id || "").trim();
                const statusValue = String(status.status || "").trim().toUpperCase();
                const firstError = record(Array.isArray(status.errors) ? status.errors[0] : null);
                const errorCode = String(firstError.code || "").trim().slice(0, 80);
                const errorMessage = String(firstError.title || firstError.message || "").trim().slice(0, 500);
                if (providerMessageId && statusValue) result.push({ kind: "status", providerMessageId, status: statusValue,
                    ...(errorCode ? { errorCode } : {}), ...(errorMessage ? { errorMessage } : {}),
                    ...(phoneNumberId ? { phoneNumberId } : {}) });
            }
        }
    }
    return result;
}

export function parseWhatsAppWebhookEvent(body: unknown): WhatsAppWebhookSummary {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("Evento de WhatsApp inválido");
    }
    const event = body as Record<string, unknown>;
    if (event.object !== "whatsapp_business_account" || !Array.isArray(event.entry)) {
        throw new Error("Evento de WhatsApp no soportado");
    }
    let messages = 0;
    let statuses = 0;
    const statusValues = new Set<string>();
    for (const rawEntry of event.entry) {
        if (!rawEntry || typeof rawEntry !== "object") continue;
        const changes = Array.isArray((rawEntry as Record<string, unknown>).changes)
            ? (rawEntry as { changes: unknown[] }).changes
            : [];
        for (const rawChange of changes) {
            if (!rawChange || typeof rawChange !== "object") continue;
            const change = rawChange as Record<string, unknown>;
            if (change.field !== "messages" || !change.value || typeof change.value !== "object") continue;
            const value = change.value as Record<string, unknown>;
            messages += Array.isArray(value.messages) ? value.messages.length : 0;
            const deliveryStatuses = Array.isArray(value.statuses) ? value.statuses : [];
            statuses += deliveryStatuses.length;
            for (const rawStatus of deliveryStatuses) {
                if (!rawStatus || typeof rawStatus !== "object") continue;
                const status = String((rawStatus as Record<string, unknown>).status || "").trim().toLowerCase();
                if (status) statusValues.add(status);
            }
        }
    }
    return { entries: event.entry.length, messages, statuses, statusValues: [...statusValues].sort() };
}

export class WhatsAppWebhookController {
    verify = (req: Request, res: Response) => {
        const mode = queryValue(req.query["hub.mode"]);
        const token = queryValue(req.query["hub.verify_token"]);
        const challenge = queryValue(req.query["hub.challenge"]);

        if (!envs.WHATSAPP_WEBHOOK_ENABLED || !envs.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
            return res.status(503).json({ message: "Webhook de WhatsApp no configurado" });
        }

        if (mode !== "subscribe" || !sameSecret(token, envs.WHATSAPP_WEBHOOK_VERIFY_TOKEN)) {
            return res.status(403).json({ message: "Token de verificación inválido" });
        }

        return res.status(200).send(challenge);
    };

    receive = async (req: WhatsAppWebhookRequest, res: Response) => {
        if (!envs.WHATSAPP_WEBHOOK_ENABLED || !envs.WHATSAPP_APP_SECRET.trim()) {
            return res.status(503).json({ message: "Webhook de WhatsApp no configurado" });
        }

        const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
        const signature = String(req.header("x-hub-signature-256") || "");
        if (!verifyWhatsAppWebhookSignature(rawBody, signature, envs.WHATSAPP_APP_SECRET)) {
            return res.status(401).json({ message: "Firma de WhatsApp inválida" });
        }

        try {
            const summary = parseWhatsAppWebhookEvent(req.body);
            const events = extractWhatsAppAttentionEvents(req.body);
            const byTenant = new Map<string, WhatsAppAttentionEvent[]>();
            for (const event of events) {
                const phoneNumberId = event.phoneNumberId || "";
                const tenantId = phoneNumberId
                    ? await WhatsAppConnectionService.tenantForPhoneNumber(phoneNumberId)
                    : null;
                const legacyTenantId = envs.WHATSAPP_ATTENTION_ENABLED
                    && envs.WHATSAPP_ATTENTION_TENANT_ID.trim()
                    && (!phoneNumberId || phoneNumberId === envs.WHATSAPP_PHONE_NUMBER_ID)
                    ? envs.WHATSAPP_ATTENTION_TENANT_ID.trim() : null;
                const destination = tenantId || legacyTenantId;
                if (!destination) continue;
                byTenant.set(destination, [...(byTenant.get(destination) || []), event]);
            }
            for (const [tenantId, tenantEvents] of byTenant) {
                await runTenantDatabaseTransaction(tenantId, async () => {
                    const attention = new AttentionService();
                    for (const event of tenantEvents) {
                        if (event.kind === "message") {
                            const result = await attention.receiveExternal(event);
                            if (!result.duplicated) await AdminEventBus.publish({
                                type: "ATTENTION_MESSAGE_RECEIVED", entity: "ATTENTION", entityId: result.message.conversationId,
                            });
                        } else {
                            const result = await attention.updateProviderStatus(
                                event.providerMessageId, event.status, event.errorCode, event.errorMessage,
                            );
                            if (result.conversationId) await AdminEventBus.publish({
                                type: "ATTENTION_UPDATED", entity: "ATTENTION", entityId: result.conversationId, status: event.status,
                            });
                        }
                    }
                });
            }
            console.log("[WhatsApp webhook] Evento procesado", summary);
            return res.status(200).json({ received: true, summary });
        } catch (caught) {
            return res.status(400).json({
                message: caught instanceof Error ? caught.message : "Evento de WhatsApp inválido",
            });
        }
    };
}
