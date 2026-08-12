import { describe, expect, it, vi } from "vitest";
import { AuthMiddleware, type AuthRequest } from "../src/presentation/auth/middleware";
import { createRecoveryCodes, decryptTotpSecret, encryptTotpSecret, generateTotpSecret, recoveryHash, verifyTotp } from "../src/modules/platform-admin/platform-mfa-crypto";

function response() {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res); res.json.mockReturnValue(res);
    return res;
}

describe("seguridad de plataforma", () => {
    it("cifra el secreto TOTP y verifica una ventana RFC 6238", () => {
        const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
        const encrypted = encryptTotpSecret(secret);
        expect(encrypted).not.toContain(secret);
        expect(decryptTotpSecret(encrypted)).toBe(secret);
        expect(verifyTotp(secret, "287082", 59_000)).toBe(true);
        expect(verifyTotp(secret, "000000", 59_000)).toBe(false);
    });

    it("genera secretos y códigos de recuperación de un solo uso hasheables", () => {
        expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
        const codes = createRecoveryCodes();
        expect(new Set(codes).size).toBe(8);
        expect(recoveryHash(codes[0]!)).toMatch(/^[a-f0-9]{64}$/);
        expect(recoveryHash(codes[0]!)).not.toBe(codes[0]);
    });

    it("aplica permisos de backend aunque el frontend oculte botones", () => {
        const req = { platform: { platformAdminId: "id", role: "SUPPORT", permissions: ["platform.tenants.view"], mfaVerifiedAt: null, mfaStatus: "ENABLED" } } as AuthRequest;
        const res = response(); const next = vi.fn();
        AuthMiddleware.requirePlatformPermission("platform.providers.manage")(req, res as never, next);
        expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
        AuthMiddleware.requirePlatformPermission("platform.tenants.view")(req, res as never, next);
        expect(next).toHaveBeenCalledOnce();
    });

    it("exige MFA reciente para acciones de alto impacto", () => {
        const req = { platform: { platformAdminId: "id", role: "SUPER_ADMIN", permissions: [], mfaVerifiedAt: Math.floor(Date.now() / 1000) - 700, mfaStatus: "ENABLED" } } as AuthRequest;
        const res = response(); const next = vi.fn();
        AuthMiddleware.requireRecentPlatformMfa(req, res as never, next);
        expect(res.status).toHaveBeenCalledWith(428);
        req.platform!.mfaVerifiedAt = Math.floor(Date.now() / 1000);
        AuthMiddleware.requireRecentPlatformMfa(req, res as never, next);
        expect(next).toHaveBeenCalledOnce();
    });
});
