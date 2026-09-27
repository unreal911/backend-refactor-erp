import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaAttentionMessagingProvider } from "../src/modules/attention/messaging-provider";
import { WhatsAppCloudApiError } from "../src/shared/whatsapp-cloud-api";

afterEach(() => vi.unstubAllGlobals());

describe("adaptador de atención para Meta", () => {
    it("envía texto y conserva el wamid retornado", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.ok" }] }), {
            status: 200, headers: { "content-type": "application/json" },
        }));
        vi.stubGlobal("fetch", fetchMock);
        const result = await new MetaAttentionMessagingProvider().sendText({ to: "51999888777", body: "Hola" });
        expect(result).toEqual({ providerMessageId: "wamid.ok", deliveryStatus: "SENT" });
        const request = fetchMock.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(String(request.body))).toMatchObject({
            messaging_product: "whatsapp", to: "51999888777", type: "text", text: { body: "Hola" },
        });
    });

    it("convierte el rechazo del proveedor en un error controlado", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 131047 } }), {
            status: 400, headers: { "content-type": "application/json" },
        })));
        await expect(new MetaAttentionMessagingProvider().sendText({ to: "51999888777", body: "Hola" }))
            .rejects.toBeInstanceOf(WhatsAppCloudApiError);
    });
});
