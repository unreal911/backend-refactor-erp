import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppPasswordResetMessageSender } from "../src/modules/auth/whatsapp-password-reset-message";
import { WhatsAppTenantInvitationMessageSender } from "../src/modules/invitations/whatsapp-tenant-invitation-message";

const baseConfig = {
    apiVersion: "v25.0",
    accessToken: "access-token",
    phoneNumberId: "123456789",
    templateLanguage: "es",
    timeoutMs: 1000,
};

describe("plantillas WhatsApp recomendadas por Meta", () => {
    afterEach(() => vi.restoreAllMocks());

    it("envía recuperación como Authentication OTP con botón copiar", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(null, { status: 200 }),
        );
        const sender = new WhatsAppPasswordResetMessageSender({
            ...baseConfig,
            templateName: "password_reset",
        });

        await sender.sendPasswordResetEmail({
            to: "+51999888777",
            userName: "Ana",
            token: "428193",
            expiresAt: new Date(),
            channel: "whatsapp",
        });

        const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(payload.template.components).toEqual([{
            type: "body",
            parameters: [{ type: "text", text: "428193" }],
        }, {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: "428193" }],
        }]);
    });

    it("envía invitación Utility con contexto y token sólo en el botón URL", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(null, { status: 200 }),
        );
        const sender = new WhatsAppTenantInvitationMessageSender({
            ...baseConfig,
            templateName: "tenant_invitation",
        });

        await sender.sendInvitation({
            to: "+51999888777",
            tenantName: "Tienda Norte",
            inviterName: "Diego",
            role: "SELLER",
            token: "safe-token_123",
            expiresAt: new Date(),
            channel: "whatsapp",
        });

        const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(payload.template.components).toEqual([{
            type: "body",
            parameters: [
                { type: "text", text: "Diego" },
                { type: "text", text: "Tienda Norte" },
                { type: "text", text: "Vendedor" },
            ],
        }, {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: "safe-token_123" }],
        }]);
        expect(JSON.stringify(payload)).not.toContain("?token=");
    });
});
