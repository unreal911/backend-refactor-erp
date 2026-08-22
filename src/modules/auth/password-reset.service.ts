import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { platformPrisma as prisma } from "../../data/platform-prisma";
import { PasswordResetEmailSender } from "./password-reset-email.port";

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
    cooldownSeconds: number;
    bcryptRounds?: number;
    now?: () => Date;
};

export class PasswordResetService {
    private readonly now: () => Date;
    private readonly bcryptRounds: number;

    constructor(
        private readonly sender: PasswordResetEmailSender,
        private readonly options: PasswordResetOptions,
    ) {
        this.now = options.now ?? (() => new Date());
        this.bcryptRounds = options.bcryptRounds ?? 12;
    }

    private hashToken(token: string): string {
        return createHmac("sha256", this.options.tokenPepper)
            .update(token)
            .digest("hex");
    }

    async request(email: string): Promise<void> {
        const user = await prisma.user.findUnique({
            where: { email: email.trim().toLowerCase() },
            select: { id: true, email: true, firstName: true, isActive: true },
        });
        if (!user?.isActive) return;

        const now = this.now();
        const cooldownStartedAt = new Date(
            now.getTime() - this.options.cooldownSeconds * 1000,
        );
        const recent = await prisma.passwordResetToken.findFirst({
            where: { userId: user.id, createdAt: { gte: cooldownStartedAt } },
            select: { id: true },
        });
        if (recent) return;

        const token = randomBytes(32).toString("base64url");
        const expiresAt = new Date(now.getTime() + this.options.ttlMinutes * 60_000);
        const created = await prisma.passwordResetToken.create({
            data: {
                userId: user.id,
                tokenHash: this.hashToken(token),
                expiresAt,
            },
            select: { id: true },
        });

        try {
            await this.sender.sendPasswordResetEmail({
                to: user.email,
                userName: user.firstName,
                token,
                expiresAt,
            });
        } catch (error) {
            await prisma.passwordResetToken.deleteMany({ where: { id: created.id } });
            console.error("[password-reset] email delivery failed", {
                userId: user.id,
                reason: error instanceof Error ? error.message : "unknown",
            });
        }
    }

    async confirm(token: string, password: string): Promise<void> {
        const now = this.now();
        const reset = await prisma.passwordResetToken.findUnique({
            where: { tokenHash: this.hashToken(token) },
            select: { id: true, userId: true, expiresAt: true, usedAt: true },
        });
        if (!reset || reset.usedAt || reset.expiresAt.getTime() <= now.getTime()) {
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
                where: { id: reset.id, usedAt: null, expiresAt: { gt: now } },
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
