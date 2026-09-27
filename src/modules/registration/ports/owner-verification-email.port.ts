export type OwnerVerificationChannel = "email" | "whatsapp";

export type OwnerVerificationEmail = {
    to: string;
    ownerName: string;
    token: string;
    expiresAt: Date;
    channel?: OwnerVerificationChannel;
};

export interface OwnerVerificationEmailSender {
    sendVerificationEmail(message: OwnerVerificationEmail): Promise<void>;
}
