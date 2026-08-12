import {
    PlanApplicationPolicy,
    PlanVersionStatus,
    Prisma,
    TenantPlanAssignmentSource,
    TenantPlanCode,
} from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";
import { CustomError } from "../../domain/errors/custom.error";
import {
    getPlanDefinition,
    isPlanFeature,
    PLAN_FEATURE_CODES,
    PlanFeature,
} from "../plans/plan-catalog";
import { PlanAssignmentService } from "./plan-assignment.service";
import { PlatformAuditService } from "./platform-audit.service";

type Actor = {
    platformAdminId: string;
    correlationId: string | null;
};

type VersionInput = Partial<{
    currency: string;
    monthlyPrice: string | number | null;
    annualPrice: string | number | null;
    trialDays: number | null;
    maxUsers: number;
    maxProducts: number;
    maxVariantsPerProduct: number;
    maxStores: number;
    maxPosSalesPerMonth: number;
    maxStorageBytes: string | number | bigint;
    maxMainImagesPerProduct: number;
    maxImagesPerVariant: number;
    featureCodes: string[];
}>;

const NUMERIC_LIMITS = [
    "maxUsers",
    "maxProducts",
    "maxVariantsPerProduct",
    "maxStores",
    "maxPosSalesPerMonth",
    "maxMainImagesPerProduct",
    "maxImagesPerVariant",
] as const;

function parsePlanCode(value: string): TenantPlanCode {
    const normalized = String(value || "").trim().toUpperCase();
    if (!Object.values(TenantPlanCode).includes(normalized as TenantPlanCode)) {
        throw CustomError.badRequest("El código del plan no es válido");
    }
    return normalized as TenantPlanCode;
}

function parseMoney(value: unknown, field: string): Prisma.Decimal | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    const parsed = new Prisma.Decimal(String(value));
    if (parsed.isNegative() || parsed.decimalPlaces() > 2 || parsed.greaterThan(99_999_999.99)) {
        throw CustomError.badRequest(`${field} no es válido`);
    }
    return parsed;
}

function parsePositiveInt(value: unknown, field: string, allowZero = false): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed < 1)) {
        throw CustomError.badRequest(`${field} no es válido`);
    }
    return parsed;
}

function normalizeFeatures(value: unknown): PlanFeature[] {
    if (!Array.isArray(value)) throw CustomError.badRequest("featureCodes debe ser un arreglo");
    const unique = [...new Set(value.map((item) => String(item).trim()))];
    const unknown = unique.filter((item) => !isPlanFeature(item));
    if (unknown.length > 0) {
        throw CustomError.badRequest(`Capacidades desconocidas: ${unknown.join(", ")}`);
    }
    return unique.filter(isPlanFeature).sort();
}

function publicVersion(version: any) {
    return {
        ...version,
        monthlyPrice: version.monthlyPrice?.toFixed(2) ?? null,
        annualPrice: version.annualPrice?.toFixed(2) ?? null,
        maxStorageBytes: version.maxStorageBytes.toString(),
    };
}

export class PlanVersionService {
    private static normalizeVersionInput(code: TenantPlanCode, input: VersionInput) {
        const data: Record<string, unknown> = {};
        if (input.currency !== undefined) {
            const currency = String(input.currency).trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(currency)) throw CustomError.badRequest("La moneda no es válida");
            data.currency = currency;
        }
        const monthlyPrice = parseMoney(input.monthlyPrice, "monthlyPrice");
        const annualPrice = parseMoney(input.annualPrice, "annualPrice");
        if (monthlyPrice !== undefined) data.monthlyPrice = monthlyPrice;
        if (annualPrice !== undefined) data.annualPrice = annualPrice;
        for (const field of NUMERIC_LIMITS) {
            if (input[field] !== undefined) {
                data[field] = parsePositiveInt(
                    input[field],
                    field,
                    field === "maxImagesPerVariant",
                );
            }
        }
        if (input.maxStorageBytes !== undefined) {
            const storage = BigInt(input.maxStorageBytes);
            if (storage < 1n) throw CustomError.badRequest("maxStorageBytes no es válido");
            data.maxStorageBytes = storage;
        }
        if (input.trialDays !== undefined) {
            data.trialDays = input.trialDays === null
                ? null
                : parsePositiveInt(input.trialDays, "trialDays");
        }
        if (input.featureCodes !== undefined) data.featureCodes = normalizeFeatures(input.featureCodes);

        const features = (data.featureCodes as string[] | undefined) ?? undefined;
        if (code === TenantPlanCode.TRIAL) {
            if (features?.includes("sunat")) {
                throw CustomError.forbidden("El trial nunca puede incluir SUNAT");
            }
            if (data.monthlyPrice instanceof Prisma.Decimal && !data.monthlyPrice.isZero()) {
                throw CustomError.badRequest("El trial no puede tener precio mensual");
            }
        }
        return data;
    }

    static async listForPlatform() {
        const plans = await platformPrisma.plan.findMany({
            include: { versions: { orderBy: { version: "desc" } } },
            orderBy: { code: "asc" },
        });
        return plans.map((plan) => ({
            ...plan,
            versions: plan.versions.map(publicVersion),
        }));
    }

    static async listPublic(now = new Date()) {
        await this.activateDueVersions(now);
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

    static async updatePlanMetadata(codeValue: string, input: Record<string, unknown>, actor: Actor) {
        const code = parsePlanCode(codeValue);
        const before = await platformPrisma.plan.findUnique({ where: { code } });
        if (!before) throw CustomError.notFound("El plan no existe");
        const displayName = input.displayName === undefined ? undefined : String(input.displayName).trim();
        if (displayName !== undefined && !displayName) throw CustomError.badRequest("El nombre es obligatorio");
        const planData: Prisma.PlanUpdateInput = {
            ...(displayName !== undefined ? { displayName } : {}),
            ...(input.description !== undefined
                ? { description: String(input.description || "").trim() || null }
                : {}),
            ...(typeof input.isPublic === "boolean" ? { isPublic: input.isPublic } : {}),
            ...(typeof input.isAvailableForNewSubscriptions === "boolean"
                ? { isAvailableForNewSubscriptions: input.isAvailableForNewSubscriptions }
                : {}),
        };
        const after = await platformPrisma.plan.update({
            where: { code },
            data: planData,
        });
        await PlatformAuditService.record({
            actorPlatformAdminId: actor.platformAdminId,
            action: "PLAN_METADATA_UPDATED",
            entityType: "Plan",
            entityId: before.id,
            correlationId: actor.correlationId,
            before,
            after,
        });
        return after;
    }

    static async createDraft(codeValue: string, input: VersionInput & { baseVersionId?: string }, actor: Actor) {
        const code = parsePlanCode(codeValue);
        const plan = await platformPrisma.plan.findUnique({
            where: { code },
            include: { versions: { orderBy: { version: "desc" } } },
        });
        if (!plan) throw CustomError.notFound("El plan no existe");
        const base = input.baseVersionId
            ? plan.versions.find((version) => version.id === input.baseVersionId)
            : plan.versions[0];
        if (!base) throw CustomError.badRequest("El plan no tiene una versión base");
        const overrides = this.normalizeVersionInput(code, input);
        const created = await platformPrisma.planVersion.create({
            data: {
                planId: plan.id,
                version: (plan.versions[0]?.version ?? 0) + 1,
                status: PlanVersionStatus.DRAFT,
                currency: base.currency,
                monthlyPrice: base.monthlyPrice,
                annualPrice: base.annualPrice,
                trialDays: base.trialDays,
                applicationPolicy: PlanApplicationPolicy.NEW_CUSTOMERS,
                maxUsers: base.maxUsers,
                maxProducts: base.maxProducts,
                maxVariantsPerProduct: base.maxVariantsPerProduct,
                maxStores: base.maxStores,
                maxPosSalesPerMonth: base.maxPosSalesPerMonth,
                maxStorageBytes: base.maxStorageBytes,
                maxMainImagesPerProduct: base.maxMainImagesPerProduct,
                maxImagesPerVariant: base.maxImagesPerVariant,
                featureCodes: base.featureCodes,
                createdByPlatformAdminId: actor.platformAdminId,
                ...overrides,
            },
            include: { plan: true },
        });
        await PlatformAuditService.record({
            actorPlatformAdminId: actor.platformAdminId,
            action: "PLAN_VERSION_DRAFT_CREATED",
            entityType: "PlanVersion",
            entityId: created.id,
            correlationId: actor.correlationId,
            before: publicVersion(base),
            after: publicVersion(created),
        });
        return publicVersion(created);
    }

    static async updateDraft(id: string, input: VersionInput & { expectedUpdatedAt?: string }, actor: Actor) {
        const before = await platformPrisma.planVersion.findUnique({ where: { id }, include: { plan: true } });
        if (!before) throw CustomError.notFound("La versión no existe");
        if (before.status !== PlanVersionStatus.DRAFT) {
            throw CustomError.conflict("Solo se puede editar una versión en borrador");
        }
        const data = this.normalizeVersionInput(before.plan.code, input);
        const expectedUpdatedAt = input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt) : before.updatedAt;
        if (Number.isNaN(expectedUpdatedAt.getTime())) throw CustomError.badRequest("expectedUpdatedAt no es válido");
        const updated = await platformPrisma.planVersion.updateMany({
            where: { id, status: PlanVersionStatus.DRAFT, updatedAt: expectedUpdatedAt },
            data,
        });
        if (updated.count !== 1) {
            throw CustomError.conflict("El borrador cambió en otra sesión; vuelve a cargarlo");
        }
        const after = await platformPrisma.planVersion.findUniqueOrThrow({ where: { id }, include: { plan: true } });
        await PlatformAuditService.record({
            actorPlatformAdminId: actor.platformAdminId,
            action: "PLAN_VERSION_DRAFT_UPDATED",
            entityType: "PlanVersion",
            entityId: id,
            correlationId: actor.correlationId,
            before: publicVersion(before),
            after: publicVersion(after),
        });
        return publicVersion(after);
    }

    static async validateVersion(id: string) {
        const version = await platformPrisma.planVersion.findUnique({ where: { id }, include: { plan: true } });
        if (!version) throw CustomError.notFound("La versión no existe");
        this.normalizeVersionInput(version.plan.code, {
            currency: version.currency,
            monthlyPrice: version.monthlyPrice?.toString() ?? null,
            annualPrice: version.annualPrice?.toString() ?? null,
            trialDays: version.trialDays,
            maxUsers: version.maxUsers,
            maxProducts: version.maxProducts,
            maxVariantsPerProduct: version.maxVariantsPerProduct,
            maxStores: version.maxStores,
            maxPosSalesPerMonth: version.maxPosSalesPerMonth,
            maxStorageBytes: version.maxStorageBytes,
            maxMainImagesPerProduct: version.maxMainImagesPerProduct,
            maxImagesPerVariant: version.maxImagesPerVariant,
            featureCodes: version.featureCodes,
        });
        const current = await platformPrisma.planVersion.findFirst({
            where: { planId: version.planId, status: PlanVersionStatus.ACTIVE },
            orderBy: { version: "desc" },
        });
        const affectedTenants = await platformPrisma.tenant.count({ where: { planCode: version.plan.code } });
        return {
            valid: true,
            version: publicVersion(version),
            current: current ? publicVersion(current) : null,
            affectedTenants,
            allowedFeatures: PLAN_FEATURE_CODES,
        };
    }

    static async schedule(
        id: string,
        input: { effectiveFrom?: string; applicationPolicy?: string; reason?: string },
        actor: Actor,
    ) {
        await this.validateVersion(id);
        const before = await platformPrisma.planVersion.findUniqueOrThrow({ where: { id }, include: { plan: true } });
        if (before.status !== PlanVersionStatus.DRAFT) throw CustomError.conflict("Solo un borrador puede programarse");
        const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
        if (Number.isNaN(effectiveFrom.getTime())) throw CustomError.badRequest("effectiveFrom no es válido");
        const policy = String(input.applicationPolicy || PlanApplicationPolicy.NEW_CUSTOMERS).toUpperCase();
        if (!Object.values(PlanApplicationPolicy).includes(policy as PlanApplicationPolicy)) {
            throw CustomError.badRequest("La política de aplicación no es válida");
        }
        const reason = String(input.reason || "").trim();
        if (reason.length < 5) throw CustomError.badRequest("Indica el motivo de la publicación");
        const after = await platformPrisma.planVersion.update({
            where: { id },
            data: {
                status: PlanVersionStatus.SCHEDULED,
                effectiveFrom,
                applicationPolicy: policy as PlanApplicationPolicy,
                activationReason: reason,
            },
            include: { plan: true },
        });
        await PlatformAuditService.record({
            actorPlatformAdminId: actor.platformAdminId,
            action: "PLAN_VERSION_SCHEDULED",
            entityType: "PlanVersion",
            entityId: id,
            reason,
            correlationId: actor.correlationId,
            before: publicVersion(before),
            after: publicVersion(after),
        });
        if (effectiveFrom.getTime() <= Date.now()) await this.activateDueVersions(new Date());
        return publicVersion(await platformPrisma.planVersion.findUniqueOrThrow({ where: { id }, include: { plan: true } }));
    }

    static async cancelSchedule(id: string, reasonValue: unknown, actor: Actor) {
        const reason = String(reasonValue || "").trim();
        if (reason.length < 5) throw CustomError.badRequest("Indica el motivo de la cancelación");
        const before = await platformPrisma.planVersion.findUnique({ where: { id }, include: { plan: true } });
        if (!before) throw CustomError.notFound("La versión no existe");
        if (before.status !== PlanVersionStatus.SCHEDULED) throw CustomError.conflict("La versión no está programada");
        const after = await platformPrisma.planVersion.update({
            where: { id },
            data: { status: PlanVersionStatus.CANCELLED },
            include: { plan: true },
        });
        await PlatformAuditService.record({
            actorPlatformAdminId: actor.platformAdminId,
            action: "PLAN_VERSION_SCHEDULE_CANCELLED",
            entityType: "PlanVersion",
            entityId: id,
            reason,
            correlationId: actor.correlationId,
            before: publicVersion(before),
            after: publicVersion(after),
        });
        return publicVersion(after);
    }

    static async activateDueVersions(now = new Date()) {
        const due = await platformPrisma.planVersion.findMany({
            where: { status: PlanVersionStatus.SCHEDULED, effectiveFrom: { lte: now } },
            select: { id: true },
            orderBy: { effectiveFrom: "asc" },
        });
        let activated = 0;
        for (const item of due) {
            const didActivate = await platformPrisma.$transaction(async (tx) => {
                const candidate = await tx.planVersion.findUnique({ where: { id: item.id }, include: { plan: true } });
                if (!candidate || candidate.status !== PlanVersionStatus.SCHEDULED) return false;
                await tx.$executeRaw(Prisma.sql`
                    SELECT pg_advisory_xact_lock(hashtextextended(${`plan-version:${candidate.planId}`}, 0))
                `);
                const current = await tx.planVersion.findUnique({ where: { id: item.id }, include: { plan: true } });
                if (!current || current.status !== PlanVersionStatus.SCHEDULED) return false;
                await tx.planVersion.updateMany({
                    where: { planId: current.planId, status: PlanVersionStatus.ACTIVE },
                    data: { status: PlanVersionStatus.RETIRED, effectiveUntil: now, retiredAt: now },
                });
                await tx.planVersion.update({
                    where: { id: current.id },
                    data: { status: PlanVersionStatus.ACTIVE, activatedAt: now },
                });
                if (current.applicationPolicy === PlanApplicationPolicy.IMMEDIATE) {
                    const tenants = await tx.tenant.findMany({
                        where: { planCode: current.plan.code },
                        select: { id: true },
                    });
                    for (const tenant of tenants) {
                        await PlanAssignmentService.apply(tx, tenant.id, current.id, {
                            source: TenantPlanAssignmentSource.PLATFORM,
                            startsAt: now,
                            price: current.monthlyPrice,
                            reason: current.activationReason || "Aplicación inmediata de versión",
                        });
                    }
                }
                await PlatformAuditService.record({
                    actorPlatformAdminId: current.createdByPlatformAdminId,
                    action: "PLAN_VERSION_ACTIVATED",
                    entityType: "PlanVersion",
                    entityId: current.id,
                    reason: current.activationReason,
                    after: publicVersion({ ...current, status: PlanVersionStatus.ACTIVE, activatedAt: now }),
                }, tx);
                return true;
            });
            if (didActivate) activated += 1;
        }
        return { due: due.length, activated };
    }
}

export { parsePlanCode, publicVersion };
