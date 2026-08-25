import { beforeEach, describe, expect, it, vi } from "vitest";

const baseEnvironment = {
    OWNER_SIGNUP_ENABLED: true,
    OWNER_SIGNUP_TOKEN_PEPPER: "owner-signup-pepper-with-at-least-32-characters",
    OWNER_SIGNUP_ABUSE_PEPPER: "owner-signup-abuse-pepper-with-at-least-32-chars",
    OWNER_SIGNUP_VERIFY_URL: "http://localhost:3001/signup/verify",
    OWNER_SIGNUP_TERMS_VERSION: "2026-08-01",
    OWNER_SIGNUP_TOKEN_TTL_MINUTES: 30,
    OWNER_TRIAL_TOKEN_TTL_MINUTES: 1440,
    TENANT_INVITATION_ENABLED: true,
    TENANT_INVITATION_TOKEN_PEPPER: "tenant-invitation-pepper-with-at-least-32-chars",
    TENANT_INVITATION_ACCEPT_URL: "http://localhost:3001/accept-invitation",
    TENANT_INVITATION_TTL_HOURS: 72,
    PASSWORD_RESET_ENABLED: true,
    PASSWORD_RESET_TOKEN_PEPPER: "password-reset-pepper-with-at-least-32-chars",
    PASSWORD_RESET_URL: "http://localhost:3001/forgot-password/reset",
    PASSWORD_RESET_TTL_MINUTES: 30,
    PASSWORD_RESET_COOLDOWN_SECONDS: 60,
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: 465,
    SMTP_SECURE: true,
    SMTP_USER: "pruebas@gmail.com",
    SMTP_PASSWORD: "abcd efgh ijkl mnop",
    SMTP_FROM: "Tienda <pruebas@gmail.com>",
    IS_PRODUCTION: false,
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    TURNSTILE_EXPECTED_HOSTNAMES: "localhost",
    TURNSTILE_EXPECTED_ACTION: "owner_signup",
    TURNSTILE_TIMEOUT_MS: 5000,
    OWNER_SIGNUP_IP_LIMIT: 5,
    OWNER_SIGNUP_IP_WINDOW_MINUTES: 60,
    OWNER_SIGNUP_EMAIL_LIMIT: 3,
    OWNER_SIGNUP_EMAIL_WINDOW_MINUTES: 1440,
    OWNER_SIGNUP_DEVICE_LIMIT: 3,
    OWNER_SIGNUP_DEVICE_WINDOW_MINUTES: 1440,
};

async function loadFactories(overrides: Record<string, unknown> = {}) {
    vi.doMock("../src/config/envs", () => ({
        envs: { ...baseEnvironment, ...overrides },
    }));
    const [registration, passwordReset, invitations] = await Promise.all([
        import("../src/modules/registration/factory"),
        import("../src/modules/auth/password-reset.factory"),
        import("../src/modules/invitations/factory"),
    ]);
    return { registration, passwordReset, invitations };
}

describe("factories de correo del panel", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.doUnmock("../src/config/envs");
    });

    it("construye alta, recuperación e invitaciones con Gmail", async () => {
        const factories = await loadFactories();

        expect(factories.registration.createOwnerRegistrationServiceFromEnvironment())
            .not.toBeNull();
        expect(factories.passwordReset.createPasswordResetServiceFromEnvironment())
            .not.toBeNull();
        expect(factories.invitations.createTenantInvitationServiceFromEnvironment())
            .not.toBeNull();
    });

    it("rechaza la configuración Gmail inválida en los tres flujos", async () => {
        const factories = await loadFactories({ SMTP_PORT: 465, SMTP_SECURE: false });

        expect(() => factories.registration.createOwnerRegistrationServiceFromEnvironment())
            .toThrow(/puerto 465/);
        expect(() => factories.passwordReset.createPasswordResetServiceFromEnvironment())
            .toThrow(/puerto 465/);
        expect(() => factories.invitations.createTenantInvitationServiceFromEnvironment())
            .toThrow(/puerto 465/);
    });
});
