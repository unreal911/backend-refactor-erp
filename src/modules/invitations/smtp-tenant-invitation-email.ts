import nodemailer, { Transporter } from "nodemailer";
import {
    TenantInvitationEmail,
    TenantInvitationEmailSender,
} from "./ports/tenant-invitation-email.port";

export type SmtpTenantInvitationConfig = {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    from: string;
    acceptanceUrl: string;
};

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export class SmtpTenantInvitationEmailSender implements TenantInvitationEmailSender {
    private readonly transporter: Transporter;

    constructor(private readonly config: SmtpTenantInvitationConfig) {
        this.transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: config.user && config.password
                ? { user: config.user, pass: config.password }
                : undefined,
        });
    }

    async sendInvitation(message: TenantInvitationEmail): Promise<void> {
        const acceptanceUrl = new URL(this.config.acceptanceUrl);
        acceptanceUrl.searchParams.set("token", message.token);
        const expiration = message.expiresAt.toISOString();

        await this.transporter.sendMail({
            from: this.config.from,
            to: message.to,
            subject: `Invitaci\u00f3n a ${message.tenantName}`,
            text: [
                `${message.inviterName} te invit\u00f3 a ${message.tenantName} con el rol ${message.role}.`,
                "",
                "Acepta la invitaci\u00f3n usando el siguiente enlace:",
                acceptanceUrl.toString(),
                "",
                `El enlace vence en ${expiration}. Si no esperabas esta invitaci\u00f3n, ignora este mensaje.`,
            ].join("\n"),
            html: [
                `<p><strong>${escapeHtml(message.inviterName)}</strong> te invit\u00f3 a <strong>${escapeHtml(message.tenantName)}</strong>.</p>`,
                `<p>Rol asignado: <strong>${escapeHtml(message.role)}</strong>.</p>`,
                `<p><a href="${escapeHtml(acceptanceUrl.toString())}">Aceptar invitaci\u00f3n</a></p>`,
                `<p>El enlace vence en ${escapeHtml(expiration)}.</p>`,
                "<p>Si no esperabas esta invitaci\u00f3n, ignora este mensaje.</p>",
            ].join(""),
        });
    }
}
