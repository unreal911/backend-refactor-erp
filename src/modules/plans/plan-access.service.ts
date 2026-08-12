import { TenantPlanCode } from "@prisma/client";
import { tenantPrisma } from "../../data/tenant-prisma";
import { CustomError } from "../../domain/errors/custom.error";
import { TenantDataContext } from "../tenant/tenant-data-context";
import { getPlanDefinition, isPlanFeature, PlanFeature } from "./plan-catalog";

type TenantPlanSnapshot = {
    planCode: TenantPlanCode;
    welcomeStorePromotionEndsAt: Date | null;
    planFeatures?: string[];
};

export class PlanAccessService {
    static effectiveFeatures(tenant: TenantPlanSnapshot, now = new Date()): Set<PlanFeature> {
        const configured = tenant.planFeatures?.filter(isPlanFeature) ?? [];
        const result = new Set<PlanFeature>(
            configured.length > 0
                ? configured
                : getPlanDefinition(tenant.planCode).features,
        );
        // Invariante tributaria: ninguna configuración dinámica habilita SUNAT
        // durante el trial.
        if (tenant.planCode === TenantPlanCode.TRIAL) {
            result.delete("sunat");
        }
        if (
            tenant.planCode === TenantPlanCode.STARTER
            && tenant.welcomeStorePromotionEndsAt
            && tenant.welcomeStorePromotionEndsAt.getTime() > now.getTime()
        ) {
            result.add("transfers");
        }
        return result;
    }

    static async currentSnapshot(): Promise<TenantPlanSnapshot> {
        const tenantId = TenantDataContext.requireTenantId();
        return tenantPrisma.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: {
                planCode: true,
                planFeatures: true,
                welcomeStorePromotionEndsAt: true,
            },
        });
    }

    static async has(feature: PlanFeature, now = new Date()): Promise<boolean> {
        const tenant = await this.currentSnapshot();
        return this.effectiveFeatures(tenant, now).has(feature);
    }

    static async assert(feature: PlanFeature, now = new Date()): Promise<void> {
        if (!await this.has(feature, now)) {
            throw new CustomError("La función no está incluida en el plan actual", 403);
        }
    }
}
