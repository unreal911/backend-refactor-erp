import { envs } from "../../config/envs";
import { PasswordResetService } from "./password-reset.service";
import { SmtpPasswordResetEmailSender } from "./smtp-password-reset-email";

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

    const smtpUser = envs.SMTP_USER.trim();
    const smtpPassword = envs.SMTP_PASSWORD.trim();
    if (Boolean(smtpUser) !== Boolean(smtpPassword)) {
        throw new Error("SMTP_USER y SMTP_PASSWORD deben configurarse juntos");
    }
    const sender = new SmtpPasswordResetEmailSender({
        host: requireSetting("SMTP_HOST", envs.SMTP_HOST),
        port: envs.SMTP_PORT,
        secure: envs.SMTP_SECURE,
        ...(smtpUser ? { user: smtpUser, password: smtpPassword } : {}),
        from: requireSetting("SMTP_FROM", envs.SMTP_FROM),
        resetUrl: resetUrl.toString(),
    });
    return new PasswordResetService(sender, {
        tokenPepper,
        ttlMinutes: envs.PASSWORD_RESET_TTL_MINUTES,
        cooldownSeconds: envs.PASSWORD_RESET_COOLDOWN_SECONDS,
    });
}
