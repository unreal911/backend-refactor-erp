import nodemailer, { Transporter } from "nodemailer";
import {
    OwnerVerificationEmail,
    OwnerVerificationEmailSender,
} from "./ports/owner-verification-email.port";
import {
    formatEmailExpiration,
    getEmailHeroAttachment,
    renderBrandedEmail,
} from "../email/branded-email-template";

export type SmtpOwnerVerificationConfig = {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    from: string;
    verificationUrl: string;
};

export class SmtpOwnerVerificationEmailSender implements OwnerVerificationEmailSender {
    private readonly transporter: Transporter;

    constructor(private readonly config: SmtpOwnerVerificationConfig) {
        this.transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: config.user && config.password
                ? { user: config.user, pass: config.password }
                : undefined,
        });
    }

    async sendVerificationEmail(message: OwnerVerificationEmail): Promise<void> {
        if (message.channel === "whatsapp") {
            throw new Error("El emisor SMTP no puede entregar una verificación de WhatsApp");
        }
        const verificationUrl = new URL(this.config.verificationUrl);
        verificationUrl.searchParams.set("token", message.token);
        const expiration = formatEmailExpiration(message.expiresAt);
        const url = verificationUrl.toString();

        await this.transporter.sendMail({
            from: this.config.from,
            to: message.to,
            subject: "Activa tu cuenta y comienza en Tienda SaaS",
            text: [
                `Hola ${message.ownerName},`,
                "",
                "Tu tienda está a un paso de comenzar. Confirma tu correo para activar la cuenta y continuar con la creación de tu prueba.",
                url,
                "",
                `El enlace vence el ${expiration}.`,
                "Si no solicitaste este registro, puedes ignorar el mensaje con seguridad.",
            ].join("\n"),
            html: renderBrandedEmail({
                preheader: "Confirma tu correo y activa tu cuenta de Tienda SaaS.",
                eyebrow: "Bienvenido a Tienda SaaS",
                title: "Tu negocio está listo para dar el siguiente paso",
                greeting: `Hola, ${message.ownerName}.`,
                introduction: "Confirma tu correo para activar la cuenta y continuar con la configuración de tu prueba.",
                actionLabel: "Activar mi cuenta",
                actionUrl: url,
                hero: "account-activation",
                heroAlt: "Emprendedora organizando su tienda de moda con herramientas digitales",
                expiration,
                detailTitle: "Al activar tu cuenta podrás:",
                details: [
                    "Configurar los datos iniciales de tu negocio.",
                    "Organizar productos, inventario y ventas.",
                    "Invitar a tu equipo cuando estés listo.",
                ],
                securityNotice: "Si no solicitaste este registro, puedes ignorar el mensaje con seguridad.",
            }),
            attachments: [getEmailHeroAttachment("account-activation")],
        });
    }
}
