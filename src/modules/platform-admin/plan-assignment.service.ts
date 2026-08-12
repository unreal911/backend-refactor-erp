import {
    PlanApplicationPolicy,
    Prisma,
    TenantPlanAssignmentSource,
    TenantPlanCode,
    TenantStatus,
    TenantSubscriptionStatus,
} from "@prisma/client";
import { CustomError } from "../../domain/errors/custom.error";

const DAY_MS = 24 * 60 * 60 * 1000;

type AssignmentOptions = {
    source: TenantPlanAssignmentSource;
    actorPlatformAdminId?: string | null;
    startsAt?: Date;
    endsAt?: Date | null;
    price?: Prisma.Decimal | number | string | null;
    reason: string;
    currentPeriodEndsAt?: Date | null;
};

export class PlanAssignmentService {
    static async apply(
        tx: Prisma.TransactionClient,
        tenantId: string,
        planVersionId: string,
        options: AssignmentOptions,
    ) {
        const now = options.startsAt ?? new Date();
        const [tenant, version] = await Promise.all([
            tx.tenant.findUnique({
                where: { id: tenantId },
                select: {
                    id: true,
                    planCode: true,
                    status: true,
                    welcomeStorePromotionStartedAt: true,
                    welcomeStorePromotionEndsAt: true,
                },
            }),
            tx.planVersion.findUnique({
                where: { id: planVersionId },
                include: { plan: true },
            }),
        ]);
        if (!tenant) throw CustomError.notFound("La empresa no existe");
        if (!version || version.status !== "ACTIVE") {
            throw CustomError.badRequest("La versión del plan no está activa");
        }
        if (version.plan.code === TenantPlanCode.TRIAL && options.source !== TenantPlanAssignmentSource.TRIAL) {
            throw CustomError.badRequest("El trial no puede asignarse como plan pagado");
        }

        const isTrial = version.plan.code === TenantPlanCode.TRIAL;
        const grantsStarterPromotion = tenant.planCode === TenantPlanCode.TRIAL
            && version.plan.code === TenantPlanCode.STARTER
            && !tenant.welcomeStorePromotionStartedAt;

        await tx.tenantPlanAssignment.updateMany({
            where: { tenantId, status: "ACTIVE" },
            data: { status: "ENDED", endsAt: now },
        });

        const assignment = await tx.tenantPlanAssignment.create({
            data: {
                tenantId,
                planVersionId: version.id,
                status: "ACTIVE",
                source: options.source,
                price: options.price === undefined
                    ? version.monthlyPrice
                    : options.price === null
                        ? null
                        : new Prisma.Decimal(String(options.price)),
                currency: version.currency,
                startsAt: now,
                endsAt: options.endsAt ?? null,
                reason: options.reason,
                createdByPlatformAdminId: options.actorPlatformAdminId ?? null,
            },
        });

        await tx.tenant.update({
            where: { id: tenantId },
            data: {
                planCode: version.plan.code,
                activePlanVersionId: version.id,
                planFeatures: version.featureCodes,
                maxUsers: version.maxUsers,
                maxProducts: version.maxProducts,
                maxOrders: version.maxPosSalesPerMonth,
                maxVariantsPerProduct: version.maxVariantsPerProduct,
                maxStores: version.maxStores,
                maxPosSalesPerMonth: version.maxPosSalesPerMonth,
                maxStorageBytes: version.maxStorageBytes,
                maxMainImagesPerProduct: version.maxMainImagesPerProduct,
                maxImagesPerVariant: version.maxImagesPerVariant,
                status: isTrial ? TenantStatus.TRIAL : TenantStatus.ACTIVE,
                readOnlyAt: null,
                ...(grantsStarterPromotion ? {
                    welcomeStorePromotionStartedAt: now,
                    welcomeStorePromotionEndsAt: new Date(now.getTime() + 45 * DAY_MS),
                } : {}),
            },
        });

        await tx.tenantSubscription.upsert({
            where: { tenantId },
            create: {
                tenantId,
                provider: options.source === TenantPlanAssignmentSource.MANUAL_PAYMENT ? "manual" : "internal",
                planCode: version.plan.code,
                planVersionId: version.id,
                status: isTrial ? TenantSubscriptionStatus.TRIALING : TenantSubscriptionStatus.ACTIVE,
                currentPeriodEndsAt: options.currentPeriodEndsAt ?? options.endsAt ?? null,
            },
            update: {
                ...(options.source === TenantPlanAssignmentSource.MANUAL_PAYMENT
                    ? { provider: "manual" }
                    : {}),
                planCode: version.plan.code,
                planVersionId: version.id,
                status: isTrial ? TenantSubscriptionStatus.TRIALING : TenantSubscriptionStatus.ACTIVE,
                ...(options.currentPeriodEndsAt !== undefined || options.endsAt !== undefined
                    ? { currentPeriodEndsAt: options.currentPeriodEndsAt ?? options.endsAt ?? null }
                    : {}),
                suspendedAt: null,
            },
        });

        await tx.tenantLifecycleEvent.create({
            data: {
                tenantId,
                type: "PLAN_VERSION_ASSIGNED",
                actorUserId: null,
                source: "platform-plan-assignment",
                metadata: {
                    assignmentId: assignment.id,
                    planCode: version.plan.code,
                    planVersionId: version.id,
                    planVersion: version.version,
                    applicationPolicy: version.applicationPolicy as PlanApplicationPolicy,
                    reason: options.reason,
                },
            },
        });
        return assignment;
    }
}
