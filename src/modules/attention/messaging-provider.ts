import crypto from "node:crypto";
import { envs } from "../../config/envs";
import { WhatsAppCloudApiError } from "../../shared/whatsapp-cloud-api";
import { TenantDataContext } from "../tenant/tenant-data-context";
import { WhatsAppConnectionService } from "./whatsapp-connection.service";
import { CustomError } from "../../domain/errors/custom.error";
import { prisma } from "../../data/prisma";

export type AttentionProviderResult = {
    providerMessageId: string;
    deliveryStatus: "SIMULATED" | "SENT";
};

export interface AttentionMessagingProvider {
    readonly code: string;
    readonly simulated: boolean;
    sendText(input: { to: string; body: string }): Promise<AttentionProviderResult>;
}

export class LocalAttentionMessagingProvider implements AttentionMessagingProvider {
    readonly code = "LOCAL";
    readonly simulated = true;

    async sendText(): Promise<AttentionProviderResult> {
        return {
            providerMessageId: `local-${crypto.randomUUID()}`,
            deliveryStatus: "SIMULATED",
        };
    }
}

export class UnavailableMetaMessagingProvider implements AttentionMessagingProvider {
    readonly code = "META_UNAVAILABLE";
    readonly simulated = false;
    async sendText(): Promise<AttentionProviderResult> {
        throw CustomError.conflict("El número de WhatsApp requiere acción. Revisa el estado de la conexión en la bandeja.");
    }
}

export class MetaAttentionMessagingProvider implements AttentionMessagingProvider {
    readonly code = "META";
    readonly simulated = false;

    constructor(private readonly phoneNumberId = envs.WHATSAPP_PHONE_NUMBER_ID,
        private readonly accessToken = envs.WHATSAPP_ACCESS_TOKEN) {}

    async sendText(input: { to: string; body: string }): Promise<AttentionProviderResult> {
        let response: Response;
        try {
            response = await fetch(`https://graph.facebook.com/${envs.WHATSAPP_API_VERSION}/${this.phoneNumberId}/messages`, {
                method: "POST",
                headers: { Authorization: `Bearer ${this.accessToken}`, "content-type": "application/json" },
                body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: input.to, type: "text", text: { body: input.body } }),
                signal: AbortSignal.timeout(envs.WHATSAPP_TIMEOUT_MS),
            });
        } catch {
            throw new WhatsAppCloudApiError(null, "TRANSPORT_ERROR");
        }
        const payload = await response.json().catch(() => null) as { messages?: Array<{ id?: string }>; error?: { code?: number | string } } | null;
        if (!response.ok) throw new WhatsAppCloudApiError(response.status, String(payload?.error?.code || "UNKNOWN"));
        const providerMessageId = String(payload?.messages?.[0]?.id || "").trim();
        if (!providerMessageId) throw new WhatsAppCloudApiError(response.status, "MISSING_MESSAGE_ID");
        return { providerMessageId, deliveryStatus: "SENT" };
    }
}

export async function createAttentionMessagingProvider(): Promise<AttentionMessagingProvider> {
    const connection = await new WhatsAppConnectionService().connectedForCurrentTenant();
    if (connection) return new MetaAttentionMessagingProvider(connection.phoneNumberId, connection.accessToken);
    const inactiveConnection = await prisma.whatsAppConnection.findFirst({ select: { status: true } });
    if (inactiveConnection) return new UnavailableMetaMessagingProvider();
    const tenantId = TenantDataContext.currentTenantId();
    const enabledForTenant = envs.WHATSAPP_ATTENTION_ENABLED
        && Boolean(envs.WHATSAPP_ACCESS_TOKEN.trim())
        && Boolean(envs.WHATSAPP_PHONE_NUMBER_ID.trim())
        && Boolean(envs.WHATSAPP_ATTENTION_TENANT_ID.trim())
        && tenantId === envs.WHATSAPP_ATTENTION_TENANT_ID.trim();
    return enabledForTenant ? new MetaAttentionMessagingProvider() : new LocalAttentionMessagingProvider();
}
