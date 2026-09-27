import { OwnerVerificationEmail, OwnerVerificationEmailSender } from "./ports/owner-verification-email.port";
import { WhatsAppCloudApiSender } from "../../shared/whatsapp-cloud-api";

export type WhatsAppOwnerVerificationConfig = {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    templateName: string;
    templateLanguage: string;
    timeoutMs: number;
};

export class WhatsAppOwnerVerificationMessageSender implements OwnerVerificationEmailSender {
    private readonly sender: WhatsAppCloudApiSender;

    constructor(private readonly config: WhatsAppOwnerVerificationConfig) {
        this.sender = new WhatsAppCloudApiSender(config);
    }

    async sendVerificationEmail(message: OwnerVerificationEmail): Promise<void> {
        if (message.channel !== "whatsapp") {
            throw new Error("El emisor WhatsApp requiere un mensaje con canal whatsapp");
        }

        if (!/^\d{6}$/.test(message.token)) {
            throw new Error("El código OTP de verificación debe tener 6 dígitos");
        }
        await this.sender.sendTemplate({
            to: message.to,
            templateName: this.config.templateName,
            templateLanguage: this.config.templateLanguage,
            bodyParameters: [message.token],
            buttonParameters: [{
                index: 0,
                subType: "url",
                parameters: [message.token],
            }],
        });
    }
}
