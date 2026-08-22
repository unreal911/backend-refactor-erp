import { PlanVersionStatus } from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";

export class PublicPlanService {
    static async list(now = new Date()) {
        const plans = await platformPrisma.plan.findMany({
            where: { isPublic: true, isAvailableForNewSubscriptions: true },
            include: {
                versions: {
                    where: {
                        status: PlanVersionStatus.ACTIVE,
                        effectiveFrom: { lte: now },
                        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
                    },
                    orderBy: { version: "desc" },
                    take: 1,
                },
            },
            orderBy: { code: "asc" },
        });
        return plans.flatMap((plan) => {
            const version = plan.versions[0];
            if (!version) return [];
            return [{
                code: plan.code,
                displayName: plan.displayName,
                description: plan.description,
                planVersionId: version.id,
                version: version.version,
                currency: version.currency,
                monthlyPrice: version.monthlyPrice?.toFixed(2) ?? null,
                annualPrice: version.annualPrice?.toFixed(2) ?? null,
                trialDays: version.trialDays,
                limits: {
                    maxUsers: version.maxUsers,
                    maxProducts: version.maxProducts,
                    maxVariantsPerProduct: version.maxVariantsPerProduct,
                    maxStores: version.maxStores,
                    maxPosSalesPerMonth: version.maxPosSalesPerMonth,
                    maxStorageBytes: version.maxStorageBytes.toString(),
                    maxMainImagesPerProduct: version.maxMainImagesPerProduct,
                    maxImagesPerVariant: version.maxImagesPerVariant,
                },
                features: version.featureCodes,
                effectiveFrom: version.effectiveFrom,
            }];
        });
    }
}
