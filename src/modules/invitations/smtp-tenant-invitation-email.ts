import nodemailer, { Transporter } from "nodemailer";
import {
    TenantInvitationEmail,
    TenantInvitationEmailSender,
} from "./ports/tenant-invitation-email.port";
import {
    formatEmailExpiration,
    getEmailHeroAttachment,
    renderBrandedEmail,
} from "../email/branded-email-template";
import { tenantInvitationRoleLabel } from "./tenant-invitation-role";

export type SmtpTenantInvitationConfig = {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    from: string;
    acceptanceUrl: string;
};

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
        if (message.channel === "whatsapp") {
            throw new Error("El emisor SMTP requiere una invitación con canal email");
        }
        const acceptanceUrl = new URL(this.config.acceptanceUrl);
        acceptanceUrl.searchParams.set("token", message.token);
        const expiration = formatEmailExpiration(message.expiresAt);
        const url = acceptanceUrl.toString();
        const assignedRole = tenantInvitationRoleLabel(message.role);

        await this.transporter.sendMail({
            from: this.config.from,
            to: message.to,
            subject: `${message.inviterName} te invitó a ${message.tenantName}`,
            text: [
                `${message.inviterName} te invitó a formar parte de ${message.tenantName} con el rol ${assignedRole}.`,
                "",
                "Acepta la invitación usando el siguiente enlace:",
                url,
                "",
                `El enlace vence el ${expiration}.`,
                "Si no esperabas esta invitación, ignora el mensaje y no se realizará ningún cambio.",
            ].join("\n"),
            html: renderBrandedEmail({
                preheader: `${message.inviterName} te invitó a colaborar en ${message.tenantName}.`,
                eyebrow: "Una invitación para ti",
                title: `Únete al equipo de ${message.tenantName}`,
                greeting: "Hola.",
                introduction: `${message.inviterName} quiere que formes parte de su equipo en Tienda SaaS.`,
                actionLabel: "Aceptar invitación",
                actionUrl: url,
                hero: "team-invitation",
                heroAlt: "Equipo de una tienda de moda dando la bienvenida a una nueva integrante",
                expiration,
                detailTitle: "Detalles de tu acceso:",
                details: [
                    `Negocio: ${message.tenantName}`,
                    `Rol asignado: ${assignedRole}`,
                ],
                securityNotice: "Si no esperabas esta invitación, ignora el mensaje y no se realizará ningún cambio.",
            }),
            attachments: [getEmailHeroAttachment("team-invitation")],
        });
    }
}
