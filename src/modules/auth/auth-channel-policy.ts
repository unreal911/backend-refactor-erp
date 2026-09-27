import { Prisma } from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";
import { isWhatsAppCloudApiConfigured } from "../../config/whatsapp";

export type AuthChannelPolicy = {
    signupEmailEnabled: boolean;
    signupWhatsappEnabled: boolean;
    loginEmailEnabled: boolean;
    loginWhatsappEnabled: boolean;
    passwordResetEmailEnabled: boolean;
    passwordResetWhatsappEnabled: boolean;
    invitationEmailEnabled: boolean;
    invitationWhatsappEnabled: boolean;
};

export const DEFAULT_AUTH_CHANNEL_POLICY: AuthChannelPolicy = {
    signupEmailEnabled: false,
    signupWhatsappEnabled: true,
    loginEmailEnabled: false,
    loginWhatsappEnabled: true,
    passwordResetEmailEnabled: false,
    passwordResetWhatsappEnabled: true,
    invitationEmailEnabled: false,
    invitationWhatsappEnabled: true,
};

type AuthPolicyRow = AuthChannelPolicy;

function mapPolicy(row?: Partial<AuthPolicyRow> | null): AuthChannelPolicy {
    return {
        signupEmailEnabled: row?.signupEmailEnabled ?? DEFAULT_AUTH_CHANNEL_POLICY.signupEmailEnabled,
        signupWhatsappEnabled: row?.signupWhatsappEnabled ?? DEFAULT_AUTH_CHANNEL_POLICY.signupWhatsappEnabled,
        loginEmailEnabled: row?.loginEmailEnabled ?? DEFAULT_AUTH_CHANNEL_POLICY.loginEmailEnabled,
        loginWhatsappEnabled: row?.loginWhatsappEnabled ?? DEFAULT_AUTH_CHANNEL_POLICY.loginWhatsappEnabled,
        passwordResetEmailEnabled: row?.passwordResetEmailEnabled ?? DEFAULT_AUTH_CHANNEL_POLICY.passwordResetEmailEnabled,
        passwordResetWhatsappEnabled: row?.passwordResetWhatsappEnabled ?? DEFAULT_AUTH_CHANNEL_POLICY.passwordResetWhatsappEnabled,
        invitationEmailEnabled: row?.invitationEmailEnabled ?? DEFAULT_AUTH_CHANNEL_POLICY.invitationEmailEnabled,
        invitationWhatsappEnabled: row?.invitationWhatsappEnabled ?? DEFAULT_AUTH_CHANNEL_POLICY.invitationWhatsappEnabled,
    };
}

export async function getAuthChannelPolicy(): Promise<AuthChannelPolicy> {
    const rows = await platformPrisma.$queryRaw<AuthPolicyRow[]>(Prisma.sql`
        SELECT
            "signupEmailEnabled",
            "signupWhatsappEnabled",
            "loginEmailEnabled",
            "loginWhatsappEnabled",
            "passwordResetEmailEnabled",
            "passwordResetWhatsappEnabled",
            "invitationEmailEnabled",
            "invitationWhatsappEnabled"
        FROM "PlatformAuthPolicy"
        WHERE "id" = 1
        LIMIT 1
    `);
    const policy = mapPolicy(rows[0]);
    if (!isWhatsAppCloudApiConfigured()) {
        policy.signupWhatsappEnabled = false;
        policy.passwordResetWhatsappEnabled = false;
        policy.invitationWhatsappEnabled = false;
    }
    return policy;
}
