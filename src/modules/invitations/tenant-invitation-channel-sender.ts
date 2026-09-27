import {
    TenantInvitationEmail,
    TenantInvitationEmailSender,
} from "./ports/tenant-invitation-email.port";

export class TenantInvitationChannelSender implements TenantInvitationEmailSender {
    constructor(
        private readonly emailSender: TenantInvitationEmailSender | null,
        private readonly whatsappSender: TenantInvitationEmailSender | null,
    ) {}

    async sendInvitation(message: TenantInvitationEmail): Promise<void> {
        const sender = message.channel === "whatsapp"
            ? this.whatsappSender
            : this.emailSender;
        if (!sender) {
            throw new Error(`Canal de invitación no configurado: ${message.channel ?? "email"}`);
        }
        await sender.sendInvitation(message);
    }
}
