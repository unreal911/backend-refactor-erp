import { createHmac, randomUUID } from "node:crypto";
import {
    Prisma,
    SignupAbuseReason,
    SignupAbuseReviewStatus,
    SignupRateLimitDimension,
} from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";
import { OwnerSignupCaptchaVerifier } from "./ports/owner-signup-captcha.port";

type DimensionPolicy = {
    dimension: SignupRateLimitDimension;
    limit: number;
    windowMinutes: number;
};

export type OwnerSignupAbuseIdentity = {
    emailFingerprint: string;
    ipFingerprint: string;
    deviceFingerprint: string;
};

export type OwnerSignupAbuseDecision =
    | { allowed: true; identity: OwnerSignupAbuseIdentity }
    | {
        allowed: false;
        statusCode: 400 | 429 | 503;
        message: string;
        referenceId: string;
        retryAfterSeconds?: number;
    };

export interface OwnerSignupAbuseGuard {
    assess(input: {
        email: string;
        ipAddress: string;
        deviceId: string;
        captchaToken: string;
    }): Promise<OwnerSignupAbuseDecision>;
}

export type OwnerSignupAbuseOptions = {
    fingerprintPepper: string;
    ipLimit: number;
    ipWindowMinutes: number;
    emailLimit: number;
    emailWindowMinutes: number;
    deviceLimit: number;
    deviceWindowMinutes: number;
    now?: () => Date;
};

const RATE_LIMIT_MESSAGE = "No se pudo procesar el registro. Inténtalo más tarde o contacta a soporte.";
const CAPTCHA_MESSAGE = "No se pudo validar la verificación humana. Inténtalo de nuevo.";
const CAPTCHA_UNAVAILABLE_MESSAGE = "La verificación humana no está disponible temporalmente.";

export class OwnerSignupAbuseService implements OwnerSignupAbuseGuard {
    private readonly now: () => Date;
    private readonly policies: DimensionPolicy[];

    constructor(
        private readonly captcha: OwnerSignupCaptchaVerifier,
        private readonly options: OwnerSignupAbuseOptions,
    ) {
        this.now = options.now ?? (() => new Date());
        this.policies = [
            {
                dimension: SignupRateLimitDimension.IP,
                limit: options.ipLimit,
                windowMinutes: options.ipWindowMinutes,
            },
            {
                dimension: SignupRateLimitDimension.EMAIL,
                limit: options.emailLimit,
                windowMinutes: options.emailWindowMinutes,
            },
            {
                dimension: SignupRateLimitDimension.DEVICE,
                limit: options.deviceLimit,
                windowMinutes: options.deviceWindowMinutes,
            },
        ];
    }

    private fingerprint(dimension: string, value: string): string {
        return createHmac("sha256", this.options.fingerprintPepper)
            .update(`${dimension}:${value}`, "utf8")
            .digest("hex");
    }

    private bucketStart(now: Date, windowMinutes: number): Date {
        const windowMs = windowMinutes * 60_000;
        return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    }

    private eventBucketStart(now: Date): Date {
        return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    }

    private fingerprintFor(
        dimension: SignupRateLimitDimension,
        identity: OwnerSignupAbuseIdentity,
    ): string {
        if (dimension === SignupRateLimitDimension.IP) return identity.ipFingerprint;
        if (dimension === SignupRateLimitDimension.EMAIL) return identity.emailFingerprint;
        return identity.deviceFingerprint;
    }

    private reasonFor(dimension: SignupRateLimitDimension): SignupAbuseReason {
        if (dimension === SignupRateLimitDimension.IP) return SignupAbuseReason.IP_RATE_LIMIT;
        if (dimension === SignupRateLimitDimension.EMAIL) return SignupAbuseReason.EMAIL_RATE_LIMIT;
        return SignupAbuseReason.DEVICE_RATE_LIMIT;
    }

    private aggregationKey(
        reason: SignupAbuseReason,
        identity: OwnerSignupAbuseIdentity,
    ): string {
        if (reason === SignupAbuseReason.EMAIL_RATE_LIMIT
            || reason === SignupAbuseReason.ACTIVE_TRIAL_LIMIT) {
            return identity.emailFingerprint;
        }
        if (reason === SignupAbuseReason.DEVICE_RATE_LIMIT) {
            return identity.deviceFingerprint;
        }
        return identity.ipFingerprint;
    }

    private async recordRejection(
        prisma: Prisma.TransactionClient | typeof platformPrisma,
        input: {
            reason: SignupAbuseReason;
            identity: OwnerSignupAbuseIdentity;
            captchaVerified: boolean;
            now: Date;
        },
    ): Promise<string> {
        const id = randomUUID();
        const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            INSERT INTO "SignupAbuseEvent" (
                "id",
                "reason",
                "aggregationKey",
                "emailFingerprint",
                "ipFingerprint",
                "deviceFingerprint",
                "captchaVerified",
                "bucketStartedAt",
                "firstOccurredAt",
                "lastOccurredAt",
                "occurrences",
                "reviewStatus",
                "createdAt",
                "updatedAt"
            ) VALUES (
                ${id}::uuid,
                ${input.reason}::"SignupAbuseReason",
                ${this.aggregationKey(input.reason, input.identity)},
                ${input.identity.emailFingerprint},
                ${input.identity.ipFingerprint},
                ${input.identity.deviceFingerprint},
                ${input.captchaVerified},
                ${this.eventBucketStart(input.now)},
                ${input.now},
                ${input.now},
                1,
                'UNREVIEWED'::"SignupAbuseReviewStatus",
                ${input.now},
                ${input.now}
            )
            ON CONFLICT (
                "reason",
                "aggregationKey",
                "bucketStartedAt"
            ) DO UPDATE SET
                "lastOccurredAt" = EXCLUDED."lastOccurredAt",
                "occurrences" = "SignupAbuseEvent"."occurrences" + 1,
                "captchaVerified" = "SignupAbuseEvent"."captchaVerified"
                    OR EXCLUDED."captchaVerified",
                "reviewStatus" = CASE
                    WHEN "SignupAbuseEvent"."reviewStatus" = 'FALSE_POSITIVE'
                        AND "SignupAbuseEvent"."overrideUntil" <= EXCLUDED."lastOccurredAt"
                    THEN 'UNREVIEWED'::"SignupAbuseReviewStatus"
                    ELSE "SignupAbuseEvent"."reviewStatus"
                END,
                "reviewNote" = CASE
                    WHEN "SignupAbuseEvent"."reviewStatus" = 'FALSE_POSITIVE'
                        AND "SignupAbuseEvent"."overrideUntil" <= EXCLUDED."lastOccurredAt"
                    THEN NULL
                    ELSE "SignupAbuseEvent"."reviewNote"
                END,
                "reviewedAt" = CASE
                    WHEN "SignupAbuseEvent"."reviewStatus" = 'FALSE_POSITIVE'
                        AND "SignupAbuseEvent"."overrideUntil" <= EXCLUDED."lastOccurredAt"
                    THEN NULL
                    ELSE "SignupAbuseEvent"."reviewedAt"
                END,
                "reviewedByPlatformAdminId" = CASE
                    WHEN "SignupAbuseEvent"."reviewStatus" = 'FALSE_POSITIVE'
                        AND "SignupAbuseEvent"."overrideUntil" <= EXCLUDED."lastOccurredAt"
                    THEN NULL
                    ELSE "SignupAbuseEvent"."reviewedByPlatformAdminId"
                END,
                "overrideUntil" = CASE
                    WHEN "SignupAbuseEvent"."reviewStatus" = 'FALSE_POSITIVE'
                        AND "SignupAbuseEvent"."overrideUntil" <= EXCLUDED."lastOccurredAt"
                    THEN NULL
                    ELSE "SignupAbuseEvent"."overrideUntil"
                END,
                "updatedAt" = EXCLUDED."updatedAt"
            RETURNING "id"
        `);
        return rows[0]?.id ?? id;
    }

    private async consumeLimits(
        identity: OwnerSignupAbuseIdentity,
        now: Date,
    ): Promise<{
        reason: SignupAbuseReason;
        referenceId: string;
        retryAfterSeconds: number;
    } | null> {
        return platformPrisma.$transaction(async (tx) => {
            const locks = this.policies
                .map((policy) => {
                    const start = this.bucketStart(now, policy.windowMinutes);
                    return `${policy.dimension}:${this.fingerprintFor(policy.dimension, identity)}:${start.toISOString()}`;
                })
                .sort();
            for (const lock of locks) {
                await tx.$queryRaw(Prisma.sql`
                    SELECT pg_advisory_xact_lock(
                        hashtextextended(${lock}, 0)
                    )::text AS "locked"
                `);
            }

            const activeOverride = await tx.signupAbuseEvent.findFirst({
                where: {
                    emailFingerprint: identity.emailFingerprint,
                    deviceFingerprint: identity.deviceFingerprint,
                    reviewStatus: SignupAbuseReviewStatus.FALSE_POSITIVE,
                    overrideUntil: { gt: now },
                },
                select: { id: true },
            });

            await tx.signupRateLimitBucket.deleteMany({
                where: {
                    windowEndsAt: {
                        lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
                    },
                },
            });

            let exceeded: {
                dimension: SignupRateLimitDimension;
                retryAfterSeconds: number;
            } | null = null;
            for (const policy of this.policies) {
                const windowStartedAt = this.bucketStart(now, policy.windowMinutes);
                const windowEndsAt = new Date(
                    windowStartedAt.getTime() + policy.windowMinutes * 60_000,
                );
                const fingerprint = this.fingerprintFor(policy.dimension, identity);
                const bucket = await tx.signupRateLimitBucket.upsert({
                    where: {
                        dimension_fingerprint_windowStartedAt: {
                            dimension: policy.dimension,
                            fingerprint,
                            windowStartedAt,
                        },
                    },
                    create: {
                        dimension: policy.dimension,
                        fingerprint,
                        windowStartedAt,
                        windowEndsAt,
                        attempts: 1,
                    },
                    update: { attempts: { increment: 1 } },
                    select: { attempts: true },
                });
                if (!exceeded && bucket.attempts > policy.limit) {
                    exceeded = {
                        dimension: policy.dimension,
                        retryAfterSeconds: Math.max(
                            1,
                            Math.ceil((windowEndsAt.getTime() - now.getTime()) / 1000),
                        ),
                    };
                }
            }

            if (!exceeded || activeOverride) return null;
            const reason = this.reasonFor(exceeded.dimension);
            const referenceId = await this.recordRejection(tx, {
                reason,
                identity,
                captchaVerified: false,
                now,
            });
            return { reason, referenceId, retryAfterSeconds: exceeded.retryAfterSeconds };
        });
    }

    private async findPreviouslyConsumedTrial(
        identity: OwnerSignupAbuseIdentity,
        now: Date,
    ): Promise<string | null> {
        const activeOverride = await platformPrisma.signupAbuseEvent.findFirst({
            where: {
                emailFingerprint: identity.emailFingerprint,
                deviceFingerprint: identity.deviceFingerprint,
                reviewStatus: SignupAbuseReviewStatus.FALSE_POSITIVE,
                overrideUntil: { gt: now },
            },
            select: { id: true },
        });
        if (activeOverride) return null;

        const previous = await platformPrisma.trialBenefitClaim.findFirst({
            where: { OR: [
                { emailFingerprint: identity.emailFingerprint },
                { deviceFingerprint: identity.deviceFingerprint },
            ] },
            select: { id: true },
        }) ?? await platformPrisma.ownerRegistration.findFirst({
            where: { consumedAt: { not: null }, OR: [
                { signupEmailFingerprint: identity.emailFingerprint },
                { signupDeviceFingerprint: identity.deviceFingerprint },
            ] },
            select: { id: true },
        });
        if (!previous) return null;

        return this.recordRejection(platformPrisma, {
            reason: SignupAbuseReason.ACTIVE_TRIAL_LIMIT,
            identity,
            captchaVerified: true,
            now,
        });
    }

    async assess(input: {
        email: string;
        ipAddress: string;
        deviceId: string;
        captchaToken: string;
    }): Promise<OwnerSignupAbuseDecision> {
        const now = this.now();
        const identity: OwnerSignupAbuseIdentity = {
            emailFingerprint: this.fingerprint("email", input.email),
            ipFingerprint: this.fingerprint("ip", input.ipAddress),
            deviceFingerprint: this.fingerprint("device", input.deviceId),
        };

        const limited = await this.consumeLimits(identity, now);
        if (limited) {
            return {
                allowed: false,
                statusCode: 429,
                message: RATE_LIMIT_MESSAGE,
                referenceId: limited.referenceId,
                retryAfterSeconds: limited.retryAfterSeconds,
            };
        }

        const captcha = await this.captcha.verify({
            token: input.captchaToken,
            ipAddress: input.ipAddress,
        });
        if (captcha.status === "VALID") {
            const referenceId = await this.findPreviouslyConsumedTrial(identity, now);
            if (referenceId) {
                return {
                    allowed: false,
                    statusCode: 429,
                    message: RATE_LIMIT_MESSAGE,
                    referenceId,
                };
            }
            return { allowed: true, identity };
        }

        const unavailable = captcha.status === "UNAVAILABLE";
        const referenceId = await this.recordRejection(platformPrisma, {
            reason: unavailable
                ? SignupAbuseReason.CAPTCHA_UNAVAILABLE
                : SignupAbuseReason.CAPTCHA_FAILED,
            identity,
            captchaVerified: false,
            now,
        });
        return {
            allowed: false,
            statusCode: unavailable ? 503 : 400,
            message: unavailable ? CAPTCHA_UNAVAILABLE_MESSAGE : CAPTCHA_MESSAGE,
            referenceId,
        };
    }
}

export async function recordTrialRucConflict(tenantId: string, rucFingerprint: string, now = new Date()): Promise<string> {
    const identity = await platformPrisma.trialBenefitClaim.findUnique({ where: { tenantId } });
    const fallback = rucFingerprint;
    const bucketStartedAt = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    const event = await platformPrisma.signupAbuseEvent.upsert({
        where: { reason_aggregationKey_bucketStartedAt: {
            reason: SignupAbuseReason.RUC_TRIAL_LIMIT,
            aggregationKey: rucFingerprint,
            bucketStartedAt,
        } },
        create: {
            reason: SignupAbuseReason.RUC_TRIAL_LIMIT,
            aggregationKey: rucFingerprint,
            emailFingerprint: identity?.emailFingerprint ?? fallback,
            ipFingerprint: identity?.ipFingerprint ?? fallback,
            deviceFingerprint: identity?.deviceFingerprint ?? fallback,
            rucFingerprint,
            captchaVerified: true,
            bucketStartedAt,
            firstOccurredAt: now,
            lastOccurredAt: now,
        },
        update: { occurrences: { increment: 1 }, lastOccurredAt: now, reviewStatus: SignupAbuseReviewStatus.UNREVIEWED },
        select: { id: true },
    });
    return event.id;
}
