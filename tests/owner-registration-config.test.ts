import { beforeEach, describe, expect, it, vi } from "vitest";

const completeEnvironment = {
    OWNER_SIGNUP_ENABLED: true,
    OWNER_SIGNUP_TOKEN_PEPPER: "production-signup-pepper-with-32-characters",
    OWNER_SIGNUP_VERIFY_URL: "https://admin.example.com/signup/verify",
    OWNER_SIGNUP_TERMS_VERSION: "2026-08-01",
    OWNER_SIGNUP_TOKEN_TTL_MINUTES: 30,
    OWNER_TRIAL_TOKEN_TTL_MINUTES: 1440,
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: "mailer",
    SMTP_PASSWORD: "secret",
    SMTP_FROM: "Tienda <no-reply@example.com>",
    IS_PRODUCTION: true,
};

async function loadFactory(overrides: Record<string, unknown>) {
    vi.doMock("../src/config/envs", () => ({
        envs: { ...completeEnvironment, ...overrides },
    }));
    return import("../src/modules/registration/factory");
}

describe("EMP-001 configuración cerrada por defecto", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.doUnmock("../src/config/envs");
    });

    it("no construye el servicio cuando el registro está apagado", async () => {
        const { createOwnerRegistrationServiceFromEnvironment } = await loadFactory({
            OWNER_SIGNUP_ENABLED: false,
            SMTP_HOST: "",
        });
        expect(createOwnerRegistrationServiceFromEnvironment()).toBeNull();
    });

    it("aborta si se habilita sin SMTP", async () => {
        const { createOwnerRegistrationServiceFromEnvironment } = await loadFactory({
            SMTP_HOST: "",
        });
        expect(() => createOwnerRegistrationServiceFromEnvironment())
            .toThrow(/SMTP_HOST/);
    });

    it("exige HTTPS para el enlace productivo", async () => {
        const { createOwnerRegistrationServiceFromEnvironment } = await loadFactory({
            OWNER_SIGNUP_VERIFY_URL: "http://admin.example.com/signup/verify",
        });
        expect(() => createOwnerRegistrationServiceFromEnvironment())
            .toThrow(/HTTPS/);
    });

    it("exige una versión de términos definida por el servidor", async () => {
        const { createOwnerRegistrationServiceFromEnvironment } = await loadFactory({
            OWNER_SIGNUP_TERMS_VERSION: "",
        });
        expect(() => createOwnerRegistrationServiceFromEnvironment())
            .toThrow(/OWNER_SIGNUP_TERMS_VERSION/);
    });

    it("acepta una configuración SMTP completa", async () => {
        const { createOwnerRegistrationServiceFromEnvironment } = await loadFactory({});
        expect(createOwnerRegistrationServiceFromEnvironment()).not.toBeNull();
    });
});
