import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { OwnerRegistrationStatus, Prisma } from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";
import { OwnerSignupDto } from "./owner-registration.dto";
import { OwnerVerificationEmailSender } from "./ports/owner-verification-email.port";
import type { OwnerSignupAbuseIdentity } from "./owner-signup-abuse.service";

const DEFAULT_BCRYPT_ROUNDS = 12;

export class OwnerRegistrationTokenError extends Error {
    readonly statusCode = 400;

    constructor() {
        super("La credencial de registro es inválida o venció");
    }
}

export class OwnerRegistrationTrialLimitError extends Error {
    readonly statusCode = 409;

    constructor() {
        super("La identidad ya tiene una prueba activa");
    }
}

export type VerifiedOwnerIdentity = {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
    businessName: string;
    termsAcceptedAt: Date;
    termsVersion: string;
    emailVerifiedAt: Date;
    signupEmailFingerprint: string | null;
    signupIpFingerprint: string | null;
    signupDeviceFingerprint: string | null;
};

export type OwnerRegistrationServiceOptions = {
    tokenPepper: string;
    verificationTtlMinutes: number;
    trialProvisioningTtlMinutes: number;
    termsVersion: string;
    now?: () => Date;
    createToken?: () => string;
    bcryptRounds?: number;
};

export class OwnerRegistrationService {
    private readonly now: () => Date;
    private readonly createToken: () => string;
    private readonly bcryptRounds: number;

    constructor(
        private readonly emailSender: OwnerVerificationEmailSender,
        private readonly options: OwnerRegistrationServiceOptions,
    ) {
        this.now = options.now ?? (() => new Date());
        this.createToken = options.createToken
            ?? (() => randomBytes(32).toString("base64url"));
        this.bcryptRounds = options.bcryptRounds ?? DEFAULT_BCRYPT_ROUNDS;
    }

    private hashToken(token: string): string {
        return createHmac("sha256", this.options.tokenPepper)
            .update(token, "utf8")
            .digest("hex");
    }

    private expiresAt(now: Date, minutes: number): Date {
        return new Date(now.getTime() + minutes * 60_000);
    }

    async signup(
        dto: OwnerSignupDto,
        abuseIdentity?: OwnerSignupAbuseIdentity,
    ): Promise<void> {
        // Se calcula siempre, incluso si el correo ya existe, para reducir la
        // diferencia observable entre respuestas y no enumerar identidades.
        const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds);
        const token = this.createToken();
        const verificationTokenHash = this.hashToken(token);
        const now = this.now();
        const verificationTokenExpiresAt = this.expiresAt(
            now,
            this.options.verificationTtlMinutes,
        );

        const delivery = await platformPrisma.$transaction(async (tx) => {
            const existingUser = await tx.user.findFirst({
                where: {
                    email: { equals: dto.email, mode: "insensitive" },
                },
                select: { id: true },
            });
            if (existingUser) return null;

            const inserted = await tx.ownerRegistration.createMany({
                data: {
                    firstName: dto.firstName,
                    lastName: dto.lastName,
                    email: dto.email,
                    passwordHash,
                    businessName: dto.businessName,
                    signupEmailFingerprint: abuseIdentity?.emailFingerprint ?? null,
                    signupIpFingerprint: abuseIdentity?.ipFingerprint ?? null,
                    signupDeviceFingerprint: abuseIdentity?.deviceFingerprint ?? null,
                    status: OwnerRegistrationStatus.EMAIL_PENDING,
                    termsAcceptedAt: now,
                    termsVersion: this.options.termsVersion,
                    verificationTokenHash,
                    verificationTokenExpiresAt,
                    verificationRequestedAt: now,
                },
                skipDuplicates: true,
            });
            const registration = await tx.ownerRegistration.findUniqueOrThrow({
                where: { email: dto.email },
            });
            if (registration.status !== OwnerRegistrationStatus.EMAIL_PENDING) {
                return null;
            }

            // ON CONFLICT evita que solicitudes concurrentes fallen o creen
            // dos identidades. Solo la transacción insertora envía el correo.
            const createdByThisRequest = inserted.count === 1;
            if (!createdByThisRequest) {
                const renewed = await tx.ownerRegistration.updateMany({
                    where: {
                        id: registration.id,
                        status: OwnerRegistrationStatus.EMAIL_PENDING,
                        OR: [
                            { verificationTokenHash: null },
                            { verificationTokenExpiresAt: null },
                            { verificationTokenExpiresAt: { lte: now } },
                        ],
                    },
                    data: {
                        verificationTokenHash,
                        verificationTokenExpiresAt,
                        verificationRequestedAt: now,
                    },
                });
                if (renewed.count !== 1) return null;
            }

            return {
                registrationId: registration.id,
                to: registration.email,
                ownerName: registration.firstName,
            };
        });

        if (!delivery) return;

        try {
            await this.emailSender.sendVerificationEmail({
                to: delivery.to,
                ownerName: delivery.ownerName,
                token,
                expiresAt: verificationTokenExpiresAt,
            });
        } catch {
            await platformPrisma.ownerRegistration.updateMany({
                where: {
                    id: delivery.registrationId,
                    verificationTokenHash,
                },
                data: {
                    verificationTokenHash: null,
                    verificationTokenExpiresAt: null,
                },
            });
            console.error("[owner-signup] verification delivery failed", {
                registrationId: delivery.registrationId,
            });
        }
    }

    async verifyEmail(token: string): Promise<{
        trialToken: string;
        expiresAt: Date;
    }> {
        const verificationTokenHash = this.hashToken(token);
        const trialToken = this.createToken();
        const trialProvisioningTokenHash = this.hashToken(trialToken);
        const now = this.now();
        const trialProvisioningTokenExpiresAt = this.expiresAt(
            now,
            this.options.trialProvisioningTtlMinutes,
        );

        const accepted = await platformPrisma.ownerRegistration.updateMany({
            where: {
                verificationTokenHash,
                verificationTokenExpiresAt: { gt: now },
                status: {
                    in: [
                        OwnerRegistrationStatus.EMAIL_PENDING,
                        OwnerRegistrationStatus.EMAIL_VERIFIED,
                    ],
                },
            },
            data: {
                status: OwnerRegistrationStatus.EMAIL_VERIFIED,
                emailVerifiedAt: now,
                verificationTokenHash: null,
                verificationTokenExpiresAt: null,
                trialProvisioningTokenHash,
                trialProvisioningTokenExpiresAt,
            },
        });

        if (accepted.count !== 1) {
            throw new OwnerRegistrationTokenError();
        }

        return {
            trialToken,
            expiresAt: trialProvisioningTokenExpiresAt,
        };
    }

    async consumeVerifiedIdentity<T>(
        trialToken: string,
        consumer: (
            identity: VerifiedOwnerIdentity,
            tx: Prisma.TransactionClient,
        ) => Promise<T>,
    ): Promise<T> {
        const trialProvisioningTokenHash = this.hashToken(trialToken);
        const now = this.now();

        return platformPrisma.$transaction(async (tx) => {
            const registration = await tx.ownerRegistration.findUnique({
                where: { trialProvisioningTokenHash },
            });
            if (
                !registration
                || registration.status !== OwnerRegistrationStatus.EMAIL_VERIFIED
                || !registration.emailVerifiedAt
                || !registration.trialProvisioningTokenExpiresAt
                || registration.trialProvisioningTokenExpiresAt <= now
                || registration.consumedAt
            ) {
                throw new OwnerRegistrationTokenError();
            }

            const activeTrial = await tx.tenantMembership.findFirst({
                where: {
                    status: "ACTIVE",
                    user: {
                        email: { equals: registration.email, mode: "insensitive" },
                    },
                    tenant: {
                        status: "TRIAL",
                        OR: [
                            { trialEndsAt: null },
                            { trialEndsAt: { gt: now } },
                        ],
                    },
                },
                select: { id: true },
            });
            if (activeTrial) {
                throw new OwnerRegistrationTrialLimitError();
            }

            const claimed = await tx.ownerRegistration.updateMany({
                where: {
                    id: registration.id,
                    status: OwnerRegistrationStatus.EMAIL_VERIFIED,
                    consumedAt: null,
                    trialProvisioningTokenHash,
                    trialProvisioningTokenExpiresAt: { gt: now },
                },
                data: {
                    status: OwnerRegistrationStatus.CONSUMED,
                    consumedAt: now,
                    trialProvisioningTokenHash: null,
                    trialProvisioningTokenExpiresAt: null,
                },
            });
            if (claimed.count !== 1) {
                throw new OwnerRegistrationTokenError();
            }

            return consumer({
                id: registration.id,
                firstName: registration.firstName,
                lastName: registration.lastName,
                email: registration.email,
                passwordHash: registration.passwordHash,
                businessName: registration.businessName,
                termsAcceptedAt: registration.termsAcceptedAt,
                termsVersion: registration.termsVersion,
                emailVerifiedAt: registration.emailVerifiedAt,
                signupEmailFingerprint: registration.signupEmailFingerprint,
                signupIpFingerprint: registration.signupIpFingerprint,
                signupDeviceFingerprint: registration.signupDeviceFingerprint,
            }, tx);
        });
    }
}
