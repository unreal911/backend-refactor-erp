import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppOwnerVerificationMessageSender } from "../src/modules/registration/whatsapp-owner-verification-message";

describe("WhatsAppOwnerVerificationMessageSender", () => {
    afterEach(() => vi.restoreAllMocks());

    it("envía el OTP en el cuerpo y el botón copiar código", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(null, { status: 200 }),
        );
        const sender = new WhatsAppOwnerVerificationMessageSender({
            apiVersion: "v23.0",
            accessToken: "access-token",
            phoneNumberId: "123456789",
            templateName: "owner_signup_verification",
            templateLanguage: "es",
            timeoutMs: 1000,
        });

        await sender.sendVerificationEmail({
            to: "+51999888777",
            ownerName: "María",
            token: "428193",
            expiresAt: new Date(),
            channel: "whatsapp",
        });

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://graph.facebook.com/v23.0/123456789/messages");
        expect(init?.headers).toMatchObject({
            authorization: "Bearer access-token",
        });
        expect(JSON.parse(String(init?.body))).toMatchObject({
            messaging_product: "whatsapp",
            to: "51999888777",
            type: "template",
            template: {
                name: "owner_signup_verification",
                language: { code: "es" },
                components: [{
                    type: "body",
                    parameters: [{
                        type: "text",
                        text: "428193",
                    }],
                }, {
                    type: "button",
                    sub_type: "url",
                    index: "0",
                    parameters: [{ type: "text", text: "428193" }],
                }],
            },
        });
    });

    it("devuelve un error estable sin exponer el cuerpo enviado por Meta", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            Response.json({ error: { code: 131026, message: "detalle sensible" } }, { status: 400 }),
        );
        const sender = new WhatsAppOwnerVerificationMessageSender({
            apiVersion: "v23.0",
            accessToken: "access-token",
            phoneNumberId: "123456789",
            templateName: "owner_signup_verification",
            templateLanguage: "es",
            timeoutMs: 1000,
        });

        await expect(sender.sendVerificationEmail({
            to: "+51999888777",
            ownerName: "María",
            token: "428193",
            expiresAt: new Date(),
            channel: "whatsapp",
        })).rejects.toThrow("WhatsApp no pudo entregar el mensaje (HTTP 400, código 131026)");
    });

    it("rechaza credenciales largas incompatibles con la plantilla Authentication", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const sender = new WhatsAppOwnerVerificationMessageSender({
            apiVersion: "v23.0",
            accessToken: "access-token",
            phoneNumberId: "123456789",
            templateName: "owner_signup_verification",
            templateLanguage: "es",
            timeoutMs: 1000,
        });

        await expect(sender.sendVerificationEmail({
            to: "+51999888777",
            ownerName: "María",
            token: "token-largo-incompatible",
            expiresAt: new Date(),
            channel: "whatsapp",
        })).rejects.toThrow(/6 dígitos/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
