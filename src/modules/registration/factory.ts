import { envs } from "../../config/envs";
import { OwnerRegistrationService } from "./owner-registration.service";
import { SmtpOwnerVerificationEmailSender } from "./smtp-owner-verification-email";

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
