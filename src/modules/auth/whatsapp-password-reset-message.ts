import {
    PasswordResetEmail,
    PasswordResetEmailSender,
} from "./password-reset-email.port";
import { WhatsAppCloudApiSender } from "../../shared/whatsapp-cloud-api";

export type WhatsAppPasswordResetConfig = {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    templateName: string;
    templateLanguage: string;
    timeoutMs: number;
};

export class WhatsAppPasswordResetMessageSender implements PasswordResetEmailSender {
    private readonly sender: WhatsAppCloudApiSender;

    constructor(private readonly config: WhatsAppPasswordResetConfig) {
        this.sender = new WhatsAppCloudApiSender(config);
    }

    async sendPasswordResetEmail(message: PasswordResetEmail): Promise<void> {
        if (!/^\d{6}$/.test(message.token)) {
            throw new Error("El código OTP de recuperación debe tener 6 dígitos");
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
