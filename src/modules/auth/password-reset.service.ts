import { createHmac, randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { platformPrisma as prisma } from "../../data/platform-prisma";
import { PasswordResetEmailSender } from "./password-reset-email.port";
import { getAuthChannelPolicy } from "./auth-channel-policy";

export class PasswordResetTokenError extends Error {
    readonly statusCode = 400;

    constructor() {
        super("El enlace venció, ya fue utilizado o no es válido");
        this.name = "PasswordResetTokenError";
    }
}

export type PasswordResetOptions = {
    tokenPepper: string;
    ttlMinutes: number;
    whatsappOtpTtlMinutes?: number;
    whatsappOtpMaxAttempts?: number;
    cooldownSeconds: number;
    bcryptRounds?: number;
    now?: () => Date;
    createToken?: () => string;
    createWhatsappOtp?: () => string;
};

export class PasswordResetService {
    private readonly now: () => Date;
    private readonly bcryptRounds: number;
    private readonly createToken: () => string;
    private readonly createWhatsappOtp: () => string;
    private readonly whatsappOtpTtlMinutes: number;
    private readonly whatsappOtpMaxAttempts: number;

    constructor(
        private readonly sender: PasswordResetEmailSender,
        private readonly options: PasswordResetOptions,
    ) {
        this.now = options.now ?? (() => new Date());
        this.bcryptRounds = options.bcryptRounds ?? 12;
        this.createToken = options.createToken
            ?? (() => randomBytes(32).toString("base64url"));
        this.createWhatsappOtp = options.createWhatsappOtp
            ?? (() => randomInt(100_000, 1_000_000).toString());
        this.whatsappOtpTtlMinutes = options.whatsappOtpTtlMinutes ?? 10;
        this.whatsappOtpMaxAttempts = options.whatsappOtpMaxAttempts ?? 5;
    }

    private hashToken(token: string): string {
        return createHmac("sha256", this.options.tokenPepper)
            .update(token)
            .digest("hex");
    }

    private hashCredential(token: string, phone?: string | null): string {
        return this.hashToken(phone ? `whatsapp:${phone}:${token}` : token);
    }

    async request(identifier: string, requestedChannel: "email" | "whatsapp" = "email"): Promise<void> {
        const policy = await getAuthChannelPolicy();
        if (requestedChannel === "email" ? !policy.passwordResetEmailEnabled : !policy.passwordResetWhatsappEnabled) {
            return;
        }
        const user = await prisma.user.findUnique({
            where: requestedChannel === "email"
                ? { email: identifier.trim().toLowerCase() }
                : { phone: identifier.trim() },
            select: { id: true, email: true, phone: true, firstName: true, isActive: true },
        });
        if (!user?.isActive) return;
        const to = requestedChannel === "email" ? user.email : user.phone;
        if (!to) return;

        const now = this.now();
        const cooldownStartedAt = new Date(
            now.getTime() - this.options.cooldownSeconds * 1000,
        );
        const recent = await prisma.passwordResetToken.findFirst({
            where: { userId: user.id, createdAt: { gte: cooldownStartedAt } },
            select: { id: true },
        });
        if (recent) return;

        const token = requestedChannel === "whatsapp"
            ? this.createWhatsappOtp()
            : this.createToken();
        const tokenHash = this.hashCredential(
            token,
            requestedChannel === "whatsapp" ? to : null,
        );
        const ttlMinutes = requestedChannel === "whatsapp"
            ? this.whatsappOtpTtlMinutes
            : this.options.ttlMinutes;
        const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
        const created = await prisma.passwordResetToken.create({
            data: {
                userId: user.id,
                tokenHash,
                expiresAt,
                failedAttempts: 0,
            },
            select: { id: true },
        });

        try {
            await this.sender.sendPasswordResetEmail({
                to,
                userName: user.firstName,
                token,
                expiresAt,
                channel: requestedChannel,
            });
        } catch (error) {
            await prisma.passwordResetToken.deleteMany({ where: { id: created.id } });
            console.error("[password-reset] delivery failed", {
                userId: user.id,
                channel: requestedChannel,
                reason: error instanceof Error ? error.message : "unknown",
            });
        }
    }

    async confirm(token: string, password: string, identifier?: string | null): Promise<void> {
        const now = this.now();
        const isWhatsappOtp = /^\d{6}$/.test(token);
        const credentialHash = this.hashCredential(token, isWhatsappOtp ? identifier : null);
        const reset = isWhatsappOtp
            ? await (async () => {
                if (!identifier) return null;
                const user = await prisma.user.findUnique({
                    where: { phone: identifier },
                    select: { id: true },
                });
                if (!user) return null;
                return prisma.passwordResetToken.findFirst({
                    where: {
                        userId: user.id,
                        usedAt: null,
                        expiresAt: { gt: now },
                    },
                    orderBy: { createdAt: "desc" },
                    select: {
                        id: true,
                        userId: true,
                        tokenHash: true,
                        expiresAt: true,
                        usedAt: true,
                        failedAttempts: true,
                    },
                });
            })()
            : await prisma.passwordResetToken.findUnique({
                where: { tokenHash: credentialHash },
                select: {
                    id: true,
                    userId: true,
                    tokenHash: true,
                    expiresAt: true,
                    usedAt: true,
                    failedAttempts: true,
                },
            });
        if (
            !reset
            || reset.usedAt
            || reset.expiresAt.getTime() <= now.getTime()
            || (isWhatsappOtp && reset.failedAttempts >= this.whatsappOtpMaxAttempts)
        ) throw new PasswordResetTokenError();

        if (isWhatsappOtp && reset.tokenHash !== credentialHash) {
            await prisma.passwordResetToken.updateMany({
                where: {
                    id: reset.id,
                    usedAt: null,
                    failedAttempts: { lt: this.whatsappOtpMaxAttempts },
                },
                data: { failedAttempts: { increment: 1 } },
            });
            throw new PasswordResetTokenError();
        }

        const newest = await prisma.passwordResetToken.findFirst({
            where: {
                userId: reset.userId,
                usedAt: null,
                expiresAt: { gt: now },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
        });
        if (newest?.id !== reset.id) throw new PasswordResetTokenError();

        const passwordHash = await bcrypt.hash(password, this.bcryptRounds);
        await prisma.$transaction(async (tx) => {
            const claimed = await tx.passwordResetToken.updateMany({
                where: {
                    id: reset.id,
                    tokenHash: credentialHash,
                    usedAt: null,
                    expiresAt: { gt: now },
                    ...(isWhatsappOtp
                        ? { failedAttempts: { lt: this.whatsappOtpMaxAttempts } }
                        : {}),
                },
                data: { usedAt: now },
            });
            if (claimed.count !== 1) throw new PasswordResetTokenError();

            await tx.user.update({
                where: { id: reset.userId, isActive: true },
                data: {
                    password: passwordHash,
                    authVersion: { increment: 1 },
                },
            });
            await tx.passwordResetToken.updateMany({
                where: { userId: reset.userId, usedAt: null },
                data: { usedAt: now },
            });
        });
    }
}
