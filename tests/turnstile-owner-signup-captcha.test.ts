import { describe, expect, it } from "vitest";
import { TurnstileOwnerSignupCaptcha } from "../src/modules/registration/turnstile-owner-signup-captcha";

function responseWith(body: unknown): typeof fetch {
    return (async () => new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

const baseConfig = {
    secretKey: "test-secret",
    expectedAction: "owner_signup",
    expectedHostnames: [],
    timeoutMs: 1_000,
};

describe("TurnstileOwnerSignupCaptcha", () => {
    it("acepta una respuesta exitosa con la accion esperada", async () => {
        const verifier = new TurnstileOwnerSignupCaptcha(
            baseConfig,
            responseWith({ success: true, action: "owner_signup", hostname: "localhost" }),
        );

        await expect(verifier.verify({ token: "token", ipAddress: "127.0.0.1" }))
            .resolves.toEqual({ status: "VALID" });
    });

    it("permite accion vacia solo en el modo explicito de pruebas", async () => {
        const strictVerifier = new TurnstileOwnerSignupCaptcha(
            baseConfig,
            responseWith({ success: true, action: "", hostname: "example.com" }),
        );
        const testVerifier = new TurnstileOwnerSignupCaptcha(
            { ...baseConfig, allowMissingAction: true },
            responseWith({ success: true, action: "", hostname: "example.com" }),
        );

        await expect(strictVerifier.verify({ token: "token", ipAddress: "127.0.0.1" }))
            .resolves.toEqual({ status: "INVALID" });
        await expect(testVerifier.verify({ token: "token", ipAddress: "127.0.0.1" }))
            .resolves.toEqual({ status: "VALID" });
    });

    it("no permite una accion diferente aunque el modo de pruebas este activo", async () => {
        const verifier = new TurnstileOwnerSignupCaptcha(
            { ...baseConfig, allowMissingAction: true },
            responseWith({ success: true, action: "otra_accion", hostname: "example.com" }),
        );

        await expect(verifier.verify({ token: "token", ipAddress: "127.0.0.1" }))
            .resolves.toEqual({ status: "INVALID" });
    });
});
