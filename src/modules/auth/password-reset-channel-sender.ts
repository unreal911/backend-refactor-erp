import {
    PasswordResetEmail,
    PasswordResetEmailSender,
} from "./password-reset-email.port";

export class PasswordResetChannelSender implements PasswordResetEmailSender {
    constructor(
        private readonly emailSender: PasswordResetEmailSender | null,
        private readonly whatsappSender: PasswordResetEmailSender | null,
    ) {}

    async sendPasswordResetEmail(message: PasswordResetEmail): Promise<void> {
        const sender = message.channel === "whatsapp"
            ? this.whatsappSender
            : this.emailSender;
        if (!sender) {
            throw new Error(`Canal de recuperación no configurado: ${message.channel ?? "email"}`);
        }
        await sender.sendPasswordResetEmail(message);
    }
}
