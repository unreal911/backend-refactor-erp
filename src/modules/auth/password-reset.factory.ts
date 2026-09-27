import { envs } from "../../config/envs";
import {
    assertGmailSmtpTransport,
    assertSmtpAuthPair,
    normalizeSmtpPassword,
    normalizeSmtpUser,
} from "../../config/smtp";
import { PasswordResetService } from "./password-reset.service";
import { SmtpPasswordResetEmailSender } from "./smtp-password-reset-email";
import { WhatsAppPasswordResetMessageSender } from "./whatsapp-password-reset-message";
import { PasswordResetChannelSender } from "./password-reset-channel-sender";
import { isWhatsAppCloudApiConfigured } from "../../config/whatsapp";

function requireSetting(name: string, value: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${name} es obligatorio cuando PASSWORD_RESET_ENABLED=true`);
    return normalized;
}

export function createPasswordResetServiceFromEnvironment(): PasswordResetService | null {
    if (!envs.PASSWORD_RESET_ENABLED) return null;

    const tokenPepper = requireSetting(
        "PASSWORD_RESET_TOKEN_PEPPER",
        envs.PASSWORD_RESET_TOKEN_PEPPER,
    );
    if (tokenPepper.length < 32) {
        throw new Error("PASSWORD_RESET_TOKEN_PEPPER debe tener al menos 32 caracteres");
    }
    const resetUrl = new URL(requireSetting("PASSWORD_RESET_URL", envs.PASSWORD_RESET_URL));
    if (envs.IS_PRODUCTION && resetUrl.protocol !== "https:") {
        throw new Error("PASSWORD_RESET_URL debe usar HTTPS en producción");
    }

    // Los canales permitidos los decide PlatformAuthPolicy. Aquí solo se
    // construyen los transportes cuyas credenciales están provisionadas.
    const smtpProvisioned = [envs.SMTP_HOST, envs.SMTP_USER, envs.SMTP_PASSWORD, envs.SMTP_FROM]
        .some((value) => String(value ?? "").trim().length > 0);
    const whatsappProvisioned = isWhatsAppCloudApiConfigured();
    const emailSender = smtpProvisioned
        ? (() => {
            const smtpHost = requireSetting("SMTP_HOST", envs.SMTP_HOST);
            const smtpUser = normalizeSmtpUser(envs.SMTP_USER);
            const smtpPassword = normalizeSmtpPassword(smtpHost, envs.SMTP_PASSWORD);
            assertSmtpAuthPair(smtpUser, smtpPassword);
            assertGmailSmtpTransport({
                host: smtpHost,
                port: envs.SMTP_PORT,
                secure: envs.SMTP_SECURE,
                user: smtpUser,
                password: smtpPassword,
            });
            return new SmtpPasswordResetEmailSender({
                host: smtpHost,
                port: envs.SMTP_PORT,
                secure: envs.SMTP_SECURE,
                ...(smtpUser ? { user: smtpUser, password: smtpPassword } : {}),
                from: requireSetting("SMTP_FROM", envs.SMTP_FROM),
                resetUrl: resetUrl.toString(),
            });
        })()
        : null;
    const whatsappSender = whatsappProvisioned
        ? new WhatsAppPasswordResetMessageSender({
            apiVersion: requireSetting("WHATSAPP_API_VERSION", envs.WHATSAPP_API_VERSION),
            accessToken: requireSetting("WHATSAPP_ACCESS_TOKEN", envs.WHATSAPP_ACCESS_TOKEN),
            phoneNumberId: requireSetting("WHATSAPP_PHONE_NUMBER_ID", envs.WHATSAPP_PHONE_NUMBER_ID),
            templateName: requireSetting(
                "WHATSAPP_PASSWORD_RESET_TEMPLATE_NAME",
                envs.WHATSAPP_PASSWORD_RESET_TEMPLATE_NAME,
            ),
            templateLanguage: requireSetting(
                "WHATSAPP_PASSWORD_RESET_TEMPLATE_LANGUAGE",
                envs.WHATSAPP_PASSWORD_RESET_TEMPLATE_LANGUAGE,
            ),
            timeoutMs: envs.WHATSAPP_TIMEOUT_MS,
        })
        : null;
    if (!emailSender && !whatsappSender) {
        throw new Error("Configura correo o WhatsApp para recuperar contraseñas");
    }
    return new PasswordResetService(new PasswordResetChannelSender(emailSender, whatsappSender), {
        tokenPepper,
        ttlMinutes: envs.PASSWORD_RESET_TTL_MINUTES,
        whatsappOtpTtlMinutes: envs.WHATSAPP_AUTH_CODE_TTL_MINUTES,
        whatsappOtpMaxAttempts: envs.WHATSAPP_AUTH_CODE_MAX_ATTEMPTS,
        cooldownSeconds: envs.PASSWORD_RESET_COOLDOWN_SECONDS,
    });
}
