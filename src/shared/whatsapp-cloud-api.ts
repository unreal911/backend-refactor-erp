export type WhatsAppTemplateMessage = {
    to: string;
    templateName: string;
    templateLanguage: string;
    bodyParameters: string[];
    buttonParameters?: Array<{
        index: number;
        subType: "url";
        parameters: string[];
    }>;
};

export type WhatsAppCloudApiConfig = {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    timeoutMs: number;
};

function normalizeRecipient(value: string): string {
    const normalized = value.trim().replace(/^\+/, "");
    if (!/^\d{8,15}$/.test(normalized)) {
        throw new Error("El destinatario de WhatsApp no tiene formato internacional válido");
    }
    return normalized;
}

export class WhatsAppCloudApiError extends Error {
    constructor(
        public readonly httpStatus: number | null,
        public readonly providerCode: string,
    ) {
        super(httpStatus
            ? `WhatsApp no pudo entregar el mensaje (HTTP ${httpStatus}, código ${providerCode})`
            : `WhatsApp no está disponible temporalmente (código ${providerCode})`);
        this.name = "WhatsAppCloudApiError";
    }
}

export class WhatsAppCloudApiSender {
    constructor(private readonly config: WhatsAppCloudApiConfig) {}

    async sendTemplate(message: WhatsAppTemplateMessage): Promise<void> {
        const components = [
            ...(message.bodyParameters.length > 0 ? [{
                type: "body",
                parameters: message.bodyParameters.map((text) => ({
                    type: "text",
                    text,
                })),
            }] : []),
            ...(message.buttonParameters ?? []).map((button) => ({
                type: "button",
                sub_type: button.subType,
                index: String(button.index),
                parameters: button.parameters.map((text) => ({
                    type: "text",
                    text,
                })),
            })),
        ];
        let response: Response;
        try {
            response = await fetch(
                `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`,
                {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${this.config.accessToken}`,
                },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: normalizeRecipient(message.to),
                    type: "template",
                    template: {
                        name: message.templateName,
                        language: { code: message.templateLanguage },
                        ...(components.length > 0 ? { components } : {}),
                    },
                }),
                signal: AbortSignal.timeout(this.config.timeoutMs),
                },
            );
        } catch {
            throw new WhatsAppCloudApiError(null, "TRANSPORT_ERROR");
        }
        if (!response.ok) {
            const payload = await response.json().catch(() => null) as { error?: { code?: unknown } } | null;
            const providerCode = String(payload?.error?.code ?? "UNKNOWN").slice(0, 40);
            throw new WhatsAppCloudApiError(response.status, providerCode);
        }
    }
}
