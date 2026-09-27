import {
    OwnerVerificationEmail,
    OwnerVerificationEmailSender,
} from "./ports/owner-verification-email.port";

export class OwnerVerificationChannelSender implements OwnerVerificationEmailSender {
    constructor(
        private readonly emailSender: OwnerVerificationEmailSender | null,
        private readonly whatsappSender: OwnerVerificationEmailSender | null,
    ) {}

    async sendVerificationEmail(message: OwnerVerificationEmail): Promise<void> {
        const sender = message.channel === "whatsapp"
            ? this.whatsappSender
            : this.emailSender;
        if (!sender) {
            throw new Error(`Canal de verificación no configurado: ${message.channel ?? "email"}`);
        }
        await sender.sendVerificationEmail(message);
    }
}
