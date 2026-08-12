import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
    BillingWebhookStatus,
    Prisma,
    TenantKind,
    TenantPlanCode,
    TenantStatus,
    TenantSubscriptionStatus,
} from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";
import { CustomError } from "../../domain/errors/custom.error";
import { planLimitsAsTenantFields } from "../plans/plan-catalog";

type BillingWebhookPayload = {
    id: string;
    type: "subscription.activated" | "payment.succeeded" | "subscription.suspended" | "payment.failed" | "subscription.cancelled";
    tenantId: string;
    plan: TenantPlanCode;
    customerId?: string;
    subscriptionId?: string;
    currentPeriodEndsAt?: string;
};

const PAYMENT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function sha256(value: Buffer | string): string {
    return createHash("sha256").update(value).digest("hex");
}

function parseSignature(value: string): Buffer {
    const normalized = value.trim().replace(/^sha256=/i, "");
    if (!/^[0-9a-f]{64}$/i.test(normalized)) {
        throw CustomError.unauthorized("Firma de webhook inválida");
    }
    return Buffer.from(normalized, "hex");
}

function parsePayload(raw: Buffer): BillingWebhookPayload {
    let value: unknown;
    try {
        value = JSON.parse(raw.toString("utf8"));
    } catch {
        throw CustomError.badRequest("Payload de webhook inválido");
    }
    if (!value || typeof value !== "object") {
        throw CustomError.badRequest("Payload de webhook inválido");
    }
    const payload = value as Partial<BillingWebhookPayload>;
    const allowedTypes = new Set([
        "subscription.activated",
        "payment.succeeded",
        "subscription.suspended",
        "payment.failed",
        "subscription.cancelled",
    ]);
    if (
        !payload.id || !payload.tenantId || !payload.type || !allowedTypes.has(payload.type)
        || !payload.plan || !Object.values(TenantPlanCode).includes(payload.plan)
        || payload.plan === TenantPlanCode.TRIAL
    ) {
        throw CustomError.badRequest("Evento de facturación incompleto");
    }
    if (!/^[0-9a-f-]{36}$/i.test(payload.tenantId)) {
        throw CustomError.badRequest("tenantId inválido");
    }
    return payload as BillingWebhookPayload;
}

export class BillingWebhookService {
    constructor(private readonly secret: string) {
        if (secret.length < 32) {
            throw new Error("BILLING_WEBHOOK_SECRET debe tener al menos 32 caracteres");
        }
    }

    private verify(raw: Buffer, signatureHeader: string): string {
        const received = parseSignature(signatureHeader);
        const expected = createHmac("sha256", this.secret).update(raw).digest();
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
            throw CustomError.unauthorized("Firma de webhook inválida");
        }
        return sha256(received);
    }

    async process(provider: string, raw: Buffer, signatureHeader: string) {
        const normalizedProvider = String(provider || "").trim().toLowerCase();
        if (!/^[a-z0-9_-]{2,40}$/.test(normalizedProvider)) {
            throw CustomError.badRequest("Proveedor de facturación inválido");
        }
        const signatureSha256 = this.verify(raw, signatureHeader);
        const payload = parsePayload(raw);
        const payloadSha256 = sha256(raw);
        const now = new Date();
        const validatedPeriodEnd = payload.currentPeriodEndsAt
            ? new Date(payload.currentPeriodEndsAt)
            : null;
        if (validatedPeriodEnd && Number.isNaN(validatedPeriodEnd.getTime())) {
            throw CustomError.badRequest("currentPeriodEndsAt inválido");
        }

        try {
            const result = await platformPrisma.$transaction(async (tx) => {
                const existing = await tx.billingWebhookEvent.findUnique({
                    where: {
                        provider_externalEventId: {
                            provider: normalizedProvider,
                            externalEventId: payload.id,
                        },
                    },
                });
                if (existing) {
                    if (existing.payloadSha256 !== payloadSha256) {
                        throw new CustomError("El identificador del evento ya fue usado con otro payload", 409);
                    }
                    return { replayed: true, event: existing };
                }

                const event = await tx.billingWebhookEvent.create({
                    data: {
                        provider: normalizedProvider,
                        externalEventId: payload.id,
                        eventType: payload.type,
                        payloadSha256,
                        signatureSha256,
                        tenantId: payload.tenantId,
                    },
                });
                const tenant = await tx.tenant.findUnique({ where: { id: payload.tenantId } });
                if (!tenant || tenant.status === TenantStatus.PURGED) {
                    const rejected = await tx.billingWebhookEvent.update({
                        where: { id: event.id },
                        data: {
                            status: BillingWebhookStatus.REJECTED,
                            rejectionReason: "TENANT_UNAVAILABLE",
                            processedAt: now,
                        },
                    });
                    return { replayed: false, event: rejected, rejection: "TENANT_UNAVAILABLE" as const };
                }

                const activate = payload.type === "subscription.activated" || payload.type === "payment.succeeded";
                const hardSuspension = payload.type === "subscription.suspended";
                const paymentFailed = payload.type === "payment.failed";
                const cancelled = payload.type === "subscription.cancelled";
                const subscriptionStatus = activate
                    ? TenantSubscriptionStatus.ACTIVE
                    : cancelled
                        ? TenantSubscriptionStatus.CANCELLED
                        : paymentFailed
                            ? TenantSubscriptionStatus.PAST_DUE
                            : TenantSubscriptionStatus.SUSPENDED;
                const periodEnd = validatedPeriodEnd;
                const effectivePlan = activate ? payload.plan : tenant.planCode;
                const cancellationStillPaid = cancelled
                    && Boolean(periodEnd && periodEnd.getTime() > now.getTime());
                const tenantRemainsActive = activate || paymentFailed || cancellationStillPaid;

                await tx.tenantSubscription.upsert({
                    where: { tenantId: tenant.id },
                    create: {
                        tenantId: tenant.id,
                        provider: normalizedProvider,
                        externalCustomerId: payload.customerId ?? null,
                        externalSubscriptionId: payload.subscriptionId ?? null,
                        planCode: effectivePlan,
                        status: subscriptionStatus,
                        currentPeriodEndsAt: periodEnd,
                        suspendedAt: hardSuspension ? now : null,
                    },
                    update: {
                        provider: normalizedProvider,
                        externalCustomerId: payload.customerId ?? null,
                        externalSubscriptionId: payload.subscriptionId ?? null,
                        planCode: effectivePlan,
                        status: subscriptionStatus,
                        currentPeriodEndsAt: periodEnd,
                        suspendedAt: hardSuspension ? now : null,
                    },
                });

                const limits = planLimitsAsTenantFields(effectivePlan);
                const status = tenantRemainsActive ? TenantStatus.ACTIVE : TenantStatus.SUSPENDED;
                const grantStarterWelcomePromotion = activate
                    && payload.plan === TenantPlanCode.STARTER
                    && tenant.planCode === TenantPlanCode.TRIAL;
                await tx.tenant.update({
                    where: { id: tenant.id },
                    data: {
                        kind: activate ? TenantKind.CUSTOMER : tenant.kind,
                        status,
                        planCode: effectivePlan,
                        ...limits,
                        welcomeStorePromotionStartedAt: grantStarterWelcomePromotion
                            ? now
                            : tenant.welcomeStorePromotionStartedAt,
                        welcomeStorePromotionEndsAt: grantStarterWelcomePromotion
                            ? new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000)
                            : tenant.welcomeStorePromotionEndsAt,
                        readOnlyAt: tenantRemainsActive ? null : now,
                        graceEndsAt: activate
                            ? null
                            : paymentFailed
                                ? new Date(now.getTime() + PAYMENT_GRACE_MS)
                                : cancellationStillPaid
                                    ? periodEnd
                                    : tenant.graceEndsAt,
                        purgeScheduledAt: activate ? null : tenant.purgeScheduledAt,
                        // Una suspensión es comercial: se conserva la aprobación
                        // para completar obligaciones fiscales ya comprometidas.
                        sunatProductionEnabled: tenant.sunatProductionEnabled,
                    },
                });
                await tx.tenantLifecycleEvent.create({
                    data: {
                        tenantId: tenant.id,
                        type: activate
                            ? "SUBSCRIPTION_ACTIVATED"
                            : paymentFailed
                                ? "SUBSCRIPTION_PAST_DUE"
                                : cancelled
                                    ? "SUBSCRIPTION_CANCELLED"
                                    : "SUBSCRIPTION_SUSPENDED",
                        source: `billing:${normalizedProvider}`,
                        metadata: {
                            plan: effectivePlan,
                            eventType: payload.type,
                            graceEndsAt: paymentFailed
                                ? new Date(now.getTime() + PAYMENT_GRACE_MS).toISOString()
                                : cancellationStillPaid
                                    ? periodEnd?.toISOString()
                                    : null,
                        },
                    },
                });
                const processed = await tx.billingWebhookEvent.update({
                    where: { id: event.id },
                    data: { status: BillingWebhookStatus.PROCESSED, processedAt: now },
                });
                return { replayed: false, event: processed };
            });
            if ("rejection" in result) throw CustomError.notFound("Empresa no disponible");
            return result;
        } catch (caught) {
            if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002") {
                const event = await platformPrisma.billingWebhookEvent.findUnique({
                    where: {
                        provider_externalEventId: {
                            provider: normalizedProvider,
                            externalEventId: payload.id,
                        },
                    },
                });
                if (event?.payloadSha256 === payloadSha256) return { replayed: true, event };
            }
            throw caught;
        }
    }
}
