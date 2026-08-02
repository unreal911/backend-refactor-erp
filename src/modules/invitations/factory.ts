import { envs } from "../../config/envs";
import { SmtpTenantInvitationEmailSender } from "./smtp-tenant-invitation-email";
import { TenantInvitationService } from "./tenant-invitation.service";

function requireInvitationSetting(name: string, value: string): string {
    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`TENANT_INVITATION_ENABLED requiere ${name}`);
    }
    return normalized;
}

export function createTenantInvitationServiceFromEnvironment():
TenantInvitationService | null {
    if (!envs.TENANT_INVITATION_ENABLED) return null;

    const tokenPepper = requireInvitationSetting(
        "TENANT_INVITATION_TOKEN_PEPPER",
        envs.TENANT_INVITATION_TOKEN_PEPPER,
    );
    if (tokenPepper.length < 32) {
        throw new Error("TENANT_INVITATION_TOKEN_PEPPER debe tener al menos 32 caracteres");
    }
    if (tokenPepper === envs.OWNER_SIGNUP_TOKEN_PEPPER.trim()) {
        throw new Error(
            "TENANT_INVITATION_TOKEN_PEPPER debe ser distinta de OWNER_SIGNUP_TOKEN_PEPPER",
        );
    }

    const acceptanceUrl = new URL(requireInvitationSetting(
        "TENANT_INVITATION_ACCEPT_URL",
        envs.TENANT_INVITATION_ACCEPT_URL,
    ));
    if (envs.IS_PRODUCTION && acceptanceUrl.protocol !== "https:") {
        throw new Error("TENANT_INVITATION_ACCEPT_URL debe usar HTTPS en producci\u00f3n");
    }

    const smtpUser = envs.SMTP_USER.trim();
    const smtpPassword = envs.SMTP_PASSWORD.trim();
    if (Boolean(smtpUser) !== Boolean(smtpPassword)) {
        throw new Error("SMTP_USER y SMTP_PASSWORD deben configurarse juntos");
    }
    const sender = new SmtpTenantInvitationEmailSender({
        host: requireInvitationSetting("SMTP_HOST", envs.SMTP_HOST),
        port: envs.SMTP_PORT,
        secure: envs.SMTP_SECURE,
        ...(smtpUser ? { user: smtpUser, password: smtpPassword } : {}),
        from: requireInvitationSetting("SMTP_FROM", envs.SMTP_FROM),
        acceptanceUrl: acceptanceUrl.toString(),
    });
    return new TenantInvitationService(sender, {
        tokenPepper,
        ttlHours: envs.TENANT_INVITATION_TTL_HOURS,
    });
}
