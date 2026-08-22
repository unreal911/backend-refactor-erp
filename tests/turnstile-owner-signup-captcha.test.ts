import { describe, expect, it, vi } from "vitest";
import { TurnstileOwnerSignupCaptcha } from "../src/modules/registration/turnstile-owner-signup-captcha";

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

describe("EMP-002 Turnstile backend", () => {
    it("envía secreto, token, IP e idempotencia y valida action/hostname", async () => {
        const request = vi.fn(async () => response({
            success: true,
            action: "owner_signup",
            hostname: "admin.example.com",
        }));
        const verifier = new TurnstileOwnerSignupCaptcha({
            secretKey: "server-secret",
            expectedAction: "owner_signup",
            expectedHostnames: ["admin.example.com"],
            timeoutMs: 1000,
        }, request as typeof fetch);

        await expect(verifier.verify({
            token: "client-token",
            ipAddress: "203.0.113.10",
        })).resolves.toEqual({ status: "VALID" });

        expect(request).toHaveBeenCalledWith(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            expect.objectContaining({ method: "POST" }),
        );
        const sent = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
        expect(sent).toMatchObject({
            secret: "server-secret",
            response: "client-token",
            remoteip: "203.0.113.10",
        });
        expect(sent.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("rechaza replay, action y hostname incorrectos", async () => {
        const cases = [
            { success: false, "error-codes": ["timeout-or-duplicate"] },
            { success: true, action: "login", hostname: "admin.example.com" },
            { success: true, action: "owner_signup", hostname: "evil.example" },
        ];
        for (const body of cases) {
            const verifier = new TurnstileOwnerSignupCaptcha({
                secretKey: "server-secret",
                expectedAction: "owner_signup",
                expectedHostnames: ["admin.example.com"],
                timeoutMs: 1000,
            }, (async () => response(body)) as typeof fetch);
            await expect(verifier.verify({ token: "token", ipAddress: "127.0.0.1" }))
                .resolves.toEqual({ status: "INVALID" });
        }
    });

    it("falla cerrado si el proveedor no responde", async () => {
        const verifier = new TurnstileOwnerSignupCaptcha({
            secretKey: "server-secret",
            expectedAction: "owner_signup",
            expectedHostnames: [],
            timeoutMs: 1000,
        }, (async () => { throw new Error("network down"); }) as typeof fetch);
        await expect(verifier.verify({ token: "token", ipAddress: "127.0.0.1" }))
            .resolves.toEqual({ status: "UNAVAILABLE" });
    });
});
