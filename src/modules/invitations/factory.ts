import { envs } from "../../config/envs";
import {
    assertGmailSmtpTransport,
    assertSmtpAuthPair,
    normalizeSmtpPassword,
    normalizeSmtpUser,
} from "../../config/smtp";
import { SmtpTenantInvitationEmailSender } from "./smtp-tenant-invitation-email";
import { TenantInvitationService } from "./tenant-invitation.service";
import { WhatsAppTenantInvitationMessageSender } from "./whatsapp-tenant-invitation-message";
import { TenantInvitationChannelSender } from "./tenant-invitation-channel-sender";
import { isWhatsAppCloudApiConfigured } from "../../config/whatsapp";

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

    // Los canales permitidos los decide PlatformAuthPolicy. Aquí solo se
    // construyen los transportes cuyas credenciales están provisionadas.
    const smtpProvisioned = [envs.SMTP_HOST, envs.SMTP_USER, envs.SMTP_PASSWORD, envs.SMTP_FROM]
        .some((value) => String(value ?? "").trim().length > 0);
    const whatsappProvisioned = isWhatsAppCloudApiConfigured();
    const emailSender = smtpProvisioned
        ? (() => {
            const smtpHost = requireInvitationSetting("SMTP_HOST", envs.SMTP_HOST);
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
            return new SmtpTenantInvitationEmailSender({
                host: smtpHost,
                port: envs.SMTP_PORT,
                secure: envs.SMTP_SECURE,
                ...(smtpUser ? { user: smtpUser, password: smtpPassword } : {}),
                from: requireInvitationSetting("SMTP_FROM", envs.SMTP_FROM),
                acceptanceUrl: acceptanceUrl.toString(),
            });
        })()
        : null;
    const whatsappSender = whatsappProvisioned
        ? new WhatsAppTenantInvitationMessageSender({
            apiVersion: requireInvitationSetting("WHATSAPP_API_VERSION", envs.WHATSAPP_API_VERSION),
            accessToken: requireInvitationSetting("WHATSAPP_ACCESS_TOKEN", envs.WHATSAPP_ACCESS_TOKEN),
            phoneNumberId: requireInvitationSetting("WHATSAPP_PHONE_NUMBER_ID", envs.WHATSAPP_PHONE_NUMBER_ID),
            templateName: requireInvitationSetting(
                "WHATSAPP_INVITATION_TEMPLATE_NAME",
                envs.WHATSAPP_INVITATION_TEMPLATE_NAME,
            ),
            templateLanguage: requireInvitationSetting(
                "WHATSAPP_INVITATION_TEMPLATE_LANGUAGE",
                envs.WHATSAPP_INVITATION_TEMPLATE_LANGUAGE,
            ),
            timeoutMs: envs.WHATSAPP_TIMEOUT_MS,
        })
        : null;
    if (!emailSender && !whatsappSender) {
        throw new Error("Configura correo o WhatsApp para enviar invitaciones");
    }
    return new TenantInvitationService(new TenantInvitationChannelSender(emailSender, whatsappSender), {
        tokenPepper,
        ttlHours: envs.TENANT_INVITATION_TTL_HOURS,
    });
}
