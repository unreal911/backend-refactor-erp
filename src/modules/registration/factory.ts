import { envs } from "../../config/envs";
import { OwnerRegistrationService } from "./owner-registration.service";
import { SmtpOwnerVerificationEmailSender } from "./smtp-owner-verification-email";
import { OwnerSignupAbuseService } from "./owner-signup-abuse.service";
import { TurnstileOwnerSignupCaptcha } from "./turnstile-owner-signup-captcha";

const TURNSTILE_ALWAYS_PASS_TEST_SECRET = "1x0000000000000000000000000000000AA";

function requireSignupSetting(name: string, value: string): string {
    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`OWNER_SIGNUP_ENABLED requiere ${name}`);
    }
    return normalized;
}

export function createOwnerRegistrationServiceFromEnvironment():
OwnerRegistrationService | null {
    if (!envs.OWNER_SIGNUP_ENABLED) return null;

    const tokenPepper = requireSignupSetting(
        "OWNER_SIGNUP_TOKEN_PEPPER",
        envs.OWNER_SIGNUP_TOKEN_PEPPER,
    );
    if (tokenPepper.length < 32) {
        throw new Error("OWNER_SIGNUP_TOKEN_PEPPER debe tener al menos 32 caracteres");
    }

    const verificationUrl = requireSignupSetting(
        "OWNER_SIGNUP_VERIFY_URL",
        envs.OWNER_SIGNUP_VERIFY_URL,
    );
    const termsVersion = requireSignupSetting(
        "OWNER_SIGNUP_TERMS_VERSION",
        envs.OWNER_SIGNUP_TERMS_VERSION,
    );
    const parsedVerificationUrl = new URL(verificationUrl);
    if (envs.IS_PRODUCTION && parsedVerificationUrl.protocol !== "https:") {
        throw new Error("OWNER_SIGNUP_VERIFY_URL debe usar HTTPS en producción");
    }

    const smtpUser = envs.SMTP_USER.trim();
    const smtpPassword = envs.SMTP_PASSWORD.trim();
    if (Boolean(smtpUser) !== Boolean(smtpPassword)) {
        throw new Error("SMTP_USER y SMTP_PASSWORD deben configurarse juntos");
    }

    const sender = new SmtpOwnerVerificationEmailSender({
        host: requireSignupSetting("SMTP_HOST", envs.SMTP_HOST),
        port: envs.SMTP_PORT,
        secure: envs.SMTP_SECURE,
        ...(smtpUser ? { user: smtpUser, password: smtpPassword } : {}),
        from: requireSignupSetting("SMTP_FROM", envs.SMTP_FROM),
        verificationUrl: parsedVerificationUrl.toString(),
    });

    return new OwnerRegistrationService(sender, {
        tokenPepper,
        verificationTtlMinutes: envs.OWNER_SIGNUP_TOKEN_TTL_MINUTES,
        trialProvisioningTtlMinutes: envs.OWNER_TRIAL_TOKEN_TTL_MINUTES,
        termsVersion,
    });
}

export function createOwnerSignupAbuseServiceFromEnvironment():
OwnerSignupAbuseService | null {
    if (!envs.OWNER_SIGNUP_ENABLED) return null;

    const fingerprintPepper = requireSignupSetting(
        "OWNER_SIGNUP_ABUSE_PEPPER",
        envs.OWNER_SIGNUP_ABUSE_PEPPER,
    );
    if (fingerprintPepper.length < 32) {
        throw new Error("OWNER_SIGNUP_ABUSE_PEPPER debe tener al menos 32 caracteres");
    }
    if (fingerprintPepper === envs.OWNER_SIGNUP_TOKEN_PEPPER.trim()) {
        throw new Error("OWNER_SIGNUP_ABUSE_PEPPER debe ser distinta de OWNER_SIGNUP_TOKEN_PEPPER");
    }

    const expectedAction = requireSignupSetting(
        "TURNSTILE_EXPECTED_ACTION",
        envs.TURNSTILE_EXPECTED_ACTION,
    );
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(expectedAction)) {
        throw new Error("TURNSTILE_EXPECTED_ACTION no es válida");
    }
    const expectedHostnames = envs.TURNSTILE_EXPECTED_HOSTNAMES
        .split(",")
        .map((hostname) => hostname.trim().toLowerCase())
        .filter(Boolean);
    if (expectedHostnames.some((hostname) => !/^[a-z0-9.-]+$/.test(hostname))) {
        throw new Error("TURNSTILE_EXPECTED_HOSTNAMES contiene un hostname no válido");
    }
    if (envs.IS_PRODUCTION && expectedHostnames.length === 0) {
        throw new Error("OWNER_SIGNUP_ENABLED requiere TURNSTILE_EXPECTED_HOSTNAMES en producción");
    }

    const turnstileSecretKey = requireSignupSetting(
        "TURNSTILE_SECRET_KEY",
        envs.TURNSTILE_SECRET_KEY,
    );
    const usesAlwaysPassTestSecret = turnstileSecretKey === TURNSTILE_ALWAYS_PASS_TEST_SECRET;
    if (envs.IS_PRODUCTION && usesAlwaysPassTestSecret) {
        throw new Error("TURNSTILE_SECRET_KEY de prueba no esta permitida en produccion");
    }

    const captcha = new TurnstileOwnerSignupCaptcha({
        secretKey: turnstileSecretKey,
        expectedAction,
        expectedHostnames,
        timeoutMs: envs.TURNSTILE_TIMEOUT_MS,
        allowMissingAction: !envs.IS_PRODUCTION && usesAlwaysPassTestSecret,
    });
    return new OwnerSignupAbuseService(captcha, {
        fingerprintPepper,
        ipLimit: envs.OWNER_SIGNUP_IP_LIMIT,
        ipWindowMinutes: envs.OWNER_SIGNUP_IP_WINDOW_MINUTES,
        emailLimit: envs.OWNER_SIGNUP_EMAIL_LIMIT,
        emailWindowMinutes: envs.OWNER_SIGNUP_EMAIL_WINDOW_MINUTES,
        deviceLimit: envs.OWNER_SIGNUP_DEVICE_LIMIT,
        deviceWindowMinutes: envs.OWNER_SIGNUP_DEVICE_WINDOW_MINUTES,
    });
}
