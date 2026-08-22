import nodemailer, { Transporter } from "nodemailer";
import {
    OwnerVerificationEmail,
    OwnerVerificationEmailSender,
} from "./ports/owner-verification-email.port";

export type SmtpOwnerVerificationConfig = {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    from: string;
    verificationUrl: string;
};

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

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
        const verificationUrl = new URL(this.config.verificationUrl);
        verificationUrl.searchParams.set("token", message.token);
        const ownerName = escapeHtml(message.ownerName);
        const safeUrl = escapeHtml(verificationUrl.toString());
        const expiration = message.expiresAt.toISOString();

        await this.transporter.sendMail({
            from: this.config.from,
            to: message.to,
            subject: "Verifica tu correo para iniciar la prueba",
            text: [
                `Hola ${message.ownerName},`,
                "",
                "Verifica tu correo usando el siguiente enlace:",
                verificationUrl.toString(),
                "",
                `El enlace vence en ${expiration}. Si no solicitaste el registro, ignora este mensaje.`,
            ].join("\n"),
            html: [
                `<p>Hola ${ownerName},</p>`,
                "<p>Verifica tu correo para continuar con la creación de tu prueba:</p>",
                `<p><a href="${safeUrl}">Verificar correo</a></p>`,
                `<p>El enlace vence en ${escapeHtml(expiration)}.</p>`,
                "<p>Si no solicitaste el registro, ignora este mensaje.</p>",
            ].join(""),
        });
    }
}
