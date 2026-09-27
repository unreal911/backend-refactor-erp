import { TenantMembershipRole } from "@prisma/client";

export type TenantInvitationEmail = {
    to: string;
    tenantName: string;
    inviterName: string;
    role: TenantMembershipRole;
    token: string;
    expiresAt: Date;
    channel?: "email" | "whatsapp";
};

export interface TenantInvitationEmailSender {
    sendInvitation(message: TenantInvitationEmail): Promise<void>;
}
