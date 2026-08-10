import nodemailer, { Transporter } from "nodemailer";
import { PasswordResetEmail, PasswordResetEmailSender } from "./password-reset-email.port";

export type SmtpPasswordResetConfig = {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    from: string;
    resetUrl: string;
};

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

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
        const resetUrl = new URL(this.config.resetUrl);
        resetUrl.searchParams.set("token", message.token);
        const expiration = message.expiresAt.toISOString();

        await this.transporter.sendMail({
            from: this.config.from,
            to: message.to,
            subject: "Recupera tu contraseña",
            text: [
                `Hola ${message.userName},`,
                "",
                "Usa este enlace para crear una nueva contraseña:",
                resetUrl.toString(),
                "",
                `El enlace vence en ${expiration} y sólo puede usarse una vez.`,
                "Si no solicitaste el cambio, ignora este mensaje.",
            ].join("\n"),
            html: [
                `<p>Hola ${escapeHtml(message.userName)},</p>`,
                "<p>Recibimos una solicitud para cambiar tu contraseña.</p>",
                `<p><a href="${escapeHtml(resetUrl.toString())}">Crear una nueva contraseña</a></p>`,
                `<p>El enlace vence en ${escapeHtml(expiration)} y sólo puede usarse una vez.</p>`,
                "<p>Si no solicitaste el cambio, ignora este mensaje.</p>",
            ].join(""),
        });
    }
}
