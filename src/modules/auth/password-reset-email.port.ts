export type PasswordResetEmail = {
    to: string;
    userName: string;
    token: string;
    expiresAt: Date;
};

export interface PasswordResetEmailSender {
    sendPasswordResetEmail(message: PasswordResetEmail): Promise<void>;
}
