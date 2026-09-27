import nodemailer, { Transporter } from "nodemailer";
import { PasswordResetEmail, PasswordResetEmailSender } from "./password-reset-email.port";
import {
    formatEmailExpiration,
    getEmailHeroAttachment,
    renderBrandedEmail,
} from "../email/branded-email-template";

export type SmtpPasswordResetConfig = {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    from: string;
    resetUrl: string;
};

export class SmtpPasswordResetEmailSender implements PasswordResetEmailSender {
    private readonly transporter: Transporter;

    constructor(private readonly config: SmtpPasswordResetConfig) {
        this.transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: config.user && config.password
                ? { user: config.user, pass: config.password }
                : undefined,
        });
    }

    async sendPasswordResetEmail(message: PasswordResetEmail): Promise<void> {
        if (message.channel === "whatsapp") {
            throw new Error("El emisor SMTP requiere una recuperación con canal email");
        }
        const resetUrl = new URL(this.config.resetUrl);
        resetUrl.searchParams.set("token", message.token);
        const expiration = formatEmailExpiration(message.expiresAt);
        const url = resetUrl.toString();

        await this.transporter.sendMail({
            from: this.config.from,
            to: message.to,
            subject: "Crea una nueva contraseña para Tienda SaaS",
            text: [
                `Hola ${message.userName},`,
                "",
                "Recibimos una solicitud para cambiar tu contraseña. Usa este enlace para crear una nueva:",
                url,
                "",
                `El enlace vence el ${expiration} y solo puede usarse una vez.`,
                "Si no solicitaste el cambio, ignora este mensaje; tu contraseña actual seguirá funcionando.",
            ].join("\n"),
            html: renderBrandedEmail({
                preheader: "Usa el enlace seguro para crear una nueva contraseña.",
                eyebrow: "Seguridad de tu cuenta",
                title: "Recupera el acceso a tu cuenta",
                greeting: `Hola, ${message.userName}.`,
                introduction: "Recibimos una solicitud para cambiar tu contraseña. Crea una nueva desde el enlace seguro.",
                actionLabel: "Crear nueva contraseña",
                actionUrl: url,
                hero: "password-recovery",
                heroAlt: "Dispositivos protegidos por un escudo y una llave digital",
                expiration,
                expirationLabel: "Enlace disponible hasta",
                detailTitle: "Para proteger tu cuenta:",
                details: [
                    "El enlace solo puede utilizarse una vez.",
                    "Tienda SaaS nunca te pedirá tu contraseña por correo.",
                ],
                securityNotice: "Si no solicitaste el cambio, ignora este mensaje; tu contraseña actual seguirá funcionando.",
            }),
            attachments: [getEmailHeroAttachment("password-recovery")],
        });
    }
}
