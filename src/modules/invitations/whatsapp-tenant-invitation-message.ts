import {
    TenantInvitationEmail,
    TenantInvitationEmailSender,
} from "./ports/tenant-invitation-email.port";
import { WhatsAppCloudApiSender } from "../../shared/whatsapp-cloud-api";
import { tenantInvitationRoleLabel } from "./tenant-invitation-role";

export type WhatsAppTenantInvitationConfig = {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    templateName: string;
    templateLanguage: string;
    timeoutMs: number;
};

export class WhatsAppTenantInvitationMessageSender implements TenantInvitationEmailSender {
    private readonly sender: WhatsAppCloudApiSender;

    constructor(private readonly config: WhatsAppTenantInvitationConfig) {
        this.sender = new WhatsAppCloudApiSender(config);
    }

    async sendInvitation(message: TenantInvitationEmail): Promise<void> {
        await this.sender.sendTemplate({
            to: message.to,
            templateName: this.config.templateName,
            templateLanguage: this.config.templateLanguage,
            bodyParameters: [
                message.inviterName,
                message.tenantName,
                tenantInvitationRoleLabel(message.role),
            ],
            buttonParameters: [{
                index: 0,
                subType: "url",
                parameters: [message.token],
            }],
        });
    }
}
