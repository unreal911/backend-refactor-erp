export type PasswordResetEmail = {
    to: string;
    userName: string;
    token: string;
    expiresAt: Date;
    channel?: "email" | "whatsapp";
};

export interface PasswordResetEmailSender {
    sendPasswordResetEmail(message: PasswordResetEmail): Promise<void>;
}
