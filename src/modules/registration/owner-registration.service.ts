import { createHmac, randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { OwnerRegistrationStatus, Prisma } from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";
import { normalizeOwnerPhone, OwnerSignupDto } from "./owner-registration.dto";
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

export class OwnerRegistrationEmailDeliveryError extends Error {
    readonly statusCode = 503;

    constructor(channel: "email" | "whatsapp" = "email") {
        super(channel === "whatsapp"
            ? "No pudimos enviar el código por WhatsApp. Inténtalo nuevamente en unos minutos"
            : "No pudimos enviar el correo de verificación. Inténtalo nuevamente en unos minutos");
    }
}

export type VerifiedOwnerIdentity = {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    passwordHash: string;
    businessName: string;
    termsAcceptedAt: Date;
    termsVersion: string;
    emailVerifiedAt: Date;
    signupEmailFingerprint: string | null;
    signupIpFingerprint: string | null;
    signupDeviceFingerprint: string | null;
};

export type ConsumedOwnerIdentity = {
    id: string;
    provisionedTenantId: string;
    provisionedUserId: number;
};

export type OwnerRegistrationServiceOptions = {
    tokenPepper: string;
    verificationTtlMinutes: number;
    whatsappOtpTtlMinutes?: number;
    whatsappOtpMaxAttempts?: number;
    trialProvisioningTtlMinutes: number;
    termsVersion: string;
    now?: () => Date;
    createToken?: () => string;
    createWhatsappOtp?: () => string;
    bcryptRounds?: number;
};

export class OwnerRegistrationService {
    private readonly now: () => Date;
    private readonly createToken: () => string;
    private readonly createWhatsappOtp: () => string;
    private readonly bcryptRounds: number;
    private readonly whatsappOtpTtlMinutes: number;
    private readonly whatsappOtpMaxAttempts: number;

    constructor(
        private readonly emailSender: OwnerVerificationEmailSender,
        private readonly options: OwnerRegistrationServiceOptions,
    ) {
        this.now = options.now ?? (() => new Date());
        this.createToken = options.createToken
            ?? (() => randomBytes(32).toString("base64url"));
        this.createWhatsappOtp = options.createWhatsappOtp
            ?? (() => randomInt(100_000, 1_000_000).toString());
        this.bcryptRounds = options.bcryptRounds ?? DEFAULT_BCRYPT_ROUNDS;
        this.whatsappOtpTtlMinutes = options.whatsappOtpTtlMinutes ?? 10;
        this.whatsappOtpMaxAttempts = options.whatsappOtpMaxAttempts ?? 5;
    }

    private hashToken(token: string): string {
        return createHmac("sha256", this.options.tokenPepper)
            .update(token, "utf8")
            .digest("hex");
    }

    private hashVerificationCredential(token: string, phone?: string | null): string {
        return this.hashToken(phone ? `whatsapp:${phone}:${token}` : token);
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
        const channel = dto.email ? "email" as const : "whatsapp" as const;
        const token = channel === "whatsapp" ? this.createWhatsappOtp() : this.createToken();
        const verificationTokenHash = this.hashVerificationCredential(token, dto.phone);
        const now = this.now();
        const verificationTokenExpiresAt = this.expiresAt(
            now,
            channel === "whatsapp"
                ? this.whatsappOtpTtlMinutes
                : this.options.verificationTtlMinutes,
        );

        const delivery = await platformPrisma.$transaction(async (tx) => {
            const existingUser = await tx.user.findFirst({
                where: {
                    OR: [
                        ...(dto.email ? [{ email: { equals: dto.email, mode: "insensitive" as const } }] : []),
                        ...(dto.phone ? [{ phone: dto.phone }] : []),
                    ],
                },
                select: { id: true },
            });
            if (existingUser) return null;

            const inserted = await tx.ownerRegistration.createMany({
                data: {
                    firstName: dto.firstName,
                    lastName: dto.lastName,
                    email: dto.email,
                    phone: dto.phone,
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
                    verificationFailedAttempts: 0,
                },
                skipDuplicates: true,
            });
            const registration = await tx.ownerRegistration.findFirstOrThrow({
                where: dto.email ? { email: dto.email } : { phone: dto.phone! },
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
                        verificationFailedAttempts: 0,
                    },
                });
                if (renewed.count !== 1) return null;
            }

            return {
                registrationId: registration.id,
                to: dto.email ?? dto.phone!,
                ownerName: registration.firstName,
                channel,
            };
        });

        if (!delivery) return;

        try {
            await this.emailSender.sendVerificationEmail({
                to: delivery.to,
                ownerName: delivery.ownerName,
                channel: delivery.channel,
                token,
                expiresAt: verificationTokenExpiresAt,
            });
        } catch (caught) {
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
                error: caught instanceof Error ? caught.message : String(caught),
            });
            throw new OwnerRegistrationEmailDeliveryError(delivery.channel);
        }
    }

    async resendVerification(identifier: string, password: string): Promise<void> {
        const normalizedIdentifier = String(identifier || "").trim();
        const normalizedEmail = normalizedIdentifier.includes("@")
            ? normalizedIdentifier.toLowerCase()
            : null;
        const normalizedPhone = normalizedEmail ? null : normalizeOwnerPhone(normalizedIdentifier);
        if (!normalizedEmail && !normalizedPhone) return;
        const registration = await platformPrisma.ownerRegistration.findFirst({
            where: normalizedEmail ? { email: normalizedEmail } : { phone: normalizedPhone! },
            select: {
                id: true,
                email: true,
                phone: true,
                firstName: true,
                passwordHash: true,
                status: true,
            },
        });
        if (!registration) return;

        const passwordMatches = await bcrypt.compare(password, registration.passwordHash);
        if (!passwordMatches) return;
        if (
            registration.status !== OwnerRegistrationStatus.EMAIL_PENDING
            && registration.status !== OwnerRegistrationStatus.EMAIL_VERIFIED
        ) return;

        const channel = registration.email ? "email" as const : "whatsapp" as const;
        const token = channel === "whatsapp" ? this.createWhatsappOtp() : this.createToken();
        const verificationTokenHash = this.hashVerificationCredential(token, registration.phone);
        const now = this.now();
        const verificationTokenExpiresAt = this.expiresAt(
            now,
            channel === "whatsapp"
                ? this.whatsappOtpTtlMinutes
                : this.options.verificationTtlMinutes,
        );
        const renewed = await platformPrisma.ownerRegistration.updateMany({
            where: {
                id: registration.id,
                status: {
                    in: [
                        OwnerRegistrationStatus.EMAIL_PENDING,
                        OwnerRegistrationStatus.EMAIL_VERIFIED,
                    ],
                },
            },
            data: {
                verificationTokenHash,
                verificationTokenExpiresAt,
                verificationRequestedAt: now,
                verificationFailedAttempts: 0,
            },
        });
        if (renewed.count !== 1) return;

        try {
            await this.emailSender.sendVerificationEmail({
                to: registration.email ?? registration.phone!,
                ownerName: registration.firstName,
                channel,
                token,
                expiresAt: verificationTokenExpiresAt,
            });
        } catch (caught) {
            await platformPrisma.ownerRegistration.updateMany({
                where: { id: registration.id, verificationTokenHash },
                data: {
                    verificationTokenHash: null,
                    verificationTokenExpiresAt: null,
                },
            });
            console.error("[owner-signup] verification resend failed", {
                registrationId: registration.id,
                error: caught instanceof Error ? caught.message : String(caught),
            });
            throw new OwnerRegistrationEmailDeliveryError(registration.email ? "email" : "whatsapp");
        }
    }

    async verifyEmail(token: string, identifier?: string | null): Promise<{
        trialToken: string;
        expiresAt: Date;
    }> {
        const isWhatsappOtp = /^\d{6}$/.test(token);
        const phone = isWhatsappOtp ? normalizeOwnerPhone(identifier) : null;
        if (isWhatsappOtp && !phone) throw new OwnerRegistrationTokenError();
        const verificationTokenHash = this.hashVerificationCredential(token, phone);
        const trialToken = this.createToken();
        const trialProvisioningTokenHash = this.hashToken(trialToken);
        const now = this.now();
        const trialProvisioningTokenExpiresAt = this.expiresAt(
            now,
            this.options.trialProvisioningTtlMinutes,
        );

        if (isWhatsappOtp) {
            const registration = await platformPrisma.ownerRegistration.findUnique({
                where: { phone: phone! },
                select: {
                    id: true,
                    status: true,
                    verificationTokenHash: true,
                    verificationTokenExpiresAt: true,
                    verificationFailedAttempts: true,
                },
            });
            const statusAcceptsVerification = registration
                && (
                    registration.status === OwnerRegistrationStatus.EMAIL_PENDING
                    || registration.status === OwnerRegistrationStatus.EMAIL_VERIFIED
                );
            const credentialIsActive = statusAcceptsVerification
                && registration.verificationTokenExpiresAt
                && registration.verificationTokenExpiresAt > now
                && registration.verificationFailedAttempts < this.whatsappOtpMaxAttempts;
            if (!credentialIsActive || registration.verificationTokenHash !== verificationTokenHash) {
                if (credentialIsActive) {
                    await platformPrisma.ownerRegistration.updateMany({
                        where: {
                            id: registration.id,
                            verificationFailedAttempts: { lt: this.whatsappOtpMaxAttempts },
                        },
                        data: { verificationFailedAttempts: { increment: 1 } },
                    });
                }
                throw new OwnerRegistrationTokenError();
            }
        }

        const accepted = await platformPrisma.ownerRegistration.updateMany({
            where: {
                verificationTokenHash,
                verificationTokenExpiresAt: { gt: now },
                ...(isWhatsappOtp ? {
                    phone: phone!,
                    verificationFailedAttempts: { lt: this.whatsappOtpMaxAttempts },
                } : {}),
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
                verificationFailedAttempts: 0,
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
        replay?: (
            registration: ConsumedOwnerIdentity,
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
                replay
                && registration?.status === OwnerRegistrationStatus.CONSUMED
                && registration.consumedAt
                && registration.provisionedTenantId
                && registration.provisionedUserId
                && registration.trialProvisioningTokenExpiresAt
                && registration.trialProvisioningTokenExpiresAt > now
            ) {
                return replay({
                    id: registration.id,
                    provisionedTenantId: registration.provisionedTenantId,
                    provisionedUserId: registration.provisionedUserId,
                }, tx);
            }
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
                    user: registration.email
                        ? { email: { equals: registration.email, mode: "insensitive" } }
                        : { phone: registration.phone! },
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
                },
            });
            if (claimed.count !== 1) {
                const concurrentlyConsumed = replay
                    ? await tx.ownerRegistration.findUnique({
                        where: { trialProvisioningTokenHash },
                    })
                    : null;
                if (
                    replay
                    && concurrentlyConsumed?.status === OwnerRegistrationStatus.CONSUMED
                    && concurrentlyConsumed.consumedAt
                    && concurrentlyConsumed.provisionedTenantId
                    && concurrentlyConsumed.provisionedUserId
                    && concurrentlyConsumed.trialProvisioningTokenExpiresAt
                    && concurrentlyConsumed.trialProvisioningTokenExpiresAt > now
                ) {
                    return replay({
                        id: concurrentlyConsumed.id,
                        provisionedTenantId: concurrentlyConsumed.provisionedTenantId,
                        provisionedUserId: concurrentlyConsumed.provisionedUserId,
                    }, tx);
                }
                throw new OwnerRegistrationTokenError();
            }

            return consumer({
                id: registration.id,
                firstName: registration.firstName,
                lastName: registration.lastName,
                email: registration.email,
                phone: registration.phone,
                passwordHash: registration.passwordHash,
                businessName: registration.businessName,
                termsAcceptedAt: registration.termsAcceptedAt,
                termsVersion: registration.termsVersion,
                emailVerifiedAt: registration.emailVerifiedAt,
                signupEmailFingerprint: registration.signupEmailFingerprint,
                signupIpFingerprint: registration.signupIpFingerprint,
                signupDeviceFingerprint: registration.signupDeviceFingerprint,
            }, tx);
        }, {
            maxWait: 10_000,
            timeout: 30_000,
        });
    }
}
