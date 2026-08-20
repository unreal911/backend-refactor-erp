import { TenantPlanCode } from "@prisma/client";

export type PlanFeature =
    | "marketplace"
    | "picking.basic"
    | "picking.collaborative"
    | "picking.advanced"
    | "transfers"
    | "roles.partial"
    | "roles.custom"
    | "reports.advanced"
    | "images.variant"
    | "sunat";

export const PLAN_FEATURE_CODES: readonly PlanFeature[] = [
    "marketplace",
    "picking.basic",
    "picking.collaborative",
    "picking.advanced",
    "transfers",
    "roles.partial",
    "roles.custom",
    "reports.advanced",
    "images.variant",
    "sunat",
] as const;

const PLAN_FEATURE_CODE_SET = new Set<string>(PLAN_FEATURE_CODES);

export function isPlanFeature(value: unknown): value is PlanFeature {
    return typeof value === "string" && PLAN_FEATURE_CODE_SET.has(value);
}

export type PlanLimits = {
    maxUsers: number;
    maxProducts: number;
    maxVariantsPerProduct: number;
    maxStores: number;
    maxPosSalesPerMonth: number;
    maxStorageBytes: bigint;
    maxMainImagesPerProduct: number;
    maxImagesPerVariant: number;
};

export type PlanDefinition = {
    code: TenantPlanCode;
    publicName: string;
    monthlyPricePen: number | null;
    trialDays: number | null;
    limits: PlanLimits;
    features: ReadonlySet<PlanFeature>;
};

const GB = 1024n * 1024n * 1024n;

function features(...values: PlanFeature[]): ReadonlySet<PlanFeature> {
    return new Set(values);
}

export const PLAN_CATALOG: Readonly<Record<TenantPlanCode, PlanDefinition>> = {
    TRIAL: {
        code: TenantPlanCode.TRIAL,
        publicName: "Trial",
        monthlyPricePen: null,
        trialDays: 15,
        limits: {
            maxUsers: 2,
            maxProducts: 10,
            maxVariantsPerProduct: 20,
            maxStores: 5,
            maxPosSalesPerMonth: 70,
            maxStorageBytes: 5n * GB,
            maxMainImagesPerProduct: 3,
            maxImagesPerVariant: 1,
        },
        features: features(
            "marketplace",
            "picking.basic",
            "picking.collaborative",
            "picking.advanced",
            "transfers",
            "roles.partial",
            "roles.custom",
            "reports.advanced",
            "images.variant",
        ),
    },
    STARTER: {
        code: TenantPlanCode.STARTER,
        publicName: "Económico",
        monthlyPricePen: 30,
        trialDays: null,
        limits: {
            maxUsers: 2,
            maxProducts: 25,
            maxVariantsPerProduct: 20,
            maxStores: 1,
            maxPosSalesPerMonth: 70,
            maxStorageBytes: 5n * GB,
            maxMainImagesPerProduct: 3,
            maxImagesPerVariant: 0,
        },
        features: features("picking.basic", "sunat"),
    },
    GROWTH: {
        code: TenantPlanCode.GROWTH,
        publicName: "Negocio",
        monthlyPricePen: 70,
        trialDays: null,
        limits: {
            maxUsers: 5,
            maxProducts: 50,
            maxVariantsPerProduct: 100,
            maxStores: 2,
            maxPosSalesPerMonth: 300,
            maxStorageBytes: 20n * GB,
            maxMainImagesPerProduct: 5,
            maxImagesPerVariant: 1,
        },
        features: features(
            "marketplace",
            "picking.basic",
            "picking.collaborative",
            "transfers",
            "roles.partial",
            "images.variant",
            "sunat",
        ),
    },
    PREMIUM: {
        code: TenantPlanCode.PREMIUM,
        publicName: "Pro",
        monthlyPricePen: 130,
        trialDays: null,
        limits: {
            maxUsers: 15,
            maxProducts: 200,
            maxVariantsPerProduct: 300,
            maxStores: 5,
            maxPosSalesPerMonth: 1_500,
            maxStorageBytes: 50n * GB,
            maxMainImagesPerProduct: 8,
            maxImagesPerVariant: 1,
        },
        features: features(
            "marketplace",
            "picking.basic",
            "picking.collaborative",
            "picking.advanced",
            "transfers",
            "roles.partial",
            "roles.custom",
            "reports.advanced",
            "images.variant",
            "sunat",
        ),
    },
};

export function getPlanDefinition(code: TenantPlanCode): PlanDefinition {
    return PLAN_CATALOG[code];
}

export function planLimitsAsTenantFields(code: TenantPlanCode) {
    const limits = getPlanDefinition(code).limits;
    return {
        maxUsers: limits.maxUsers,
        maxProducts: limits.maxProducts,
        // Compatibilidad temporal para consumidores antiguos de maxOrders.
        maxOrders: limits.maxPosSalesPerMonth,
        maxVariantsPerProduct: limits.maxVariantsPerProduct,
        maxStores: limits.maxStores,
        maxPosSalesPerMonth: limits.maxPosSalesPerMonth,
        maxStorageBytes: limits.maxStorageBytes,
        maxMainImagesPerProduct: limits.maxMainImagesPerProduct,
        maxImagesPerVariant: limits.maxImagesPerVariant,
        planFeatures: Array.from(getPlanDefinition(code).features),
    };
}
