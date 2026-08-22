export type OwnerVerificationEmail = {
    to: string;
    ownerName: string;
    token: string;
    expiresAt: Date;
};

export interface OwnerVerificationEmailSender {
    sendVerificationEmail(message: OwnerVerificationEmail): Promise<void>;
}
