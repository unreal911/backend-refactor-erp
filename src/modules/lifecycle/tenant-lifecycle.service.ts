import {
    Prisma,
    TenantKind,
    TenantMembershipRole,
    TenantMembershipStatus,
    TenantPlanCode,
    TenantStatus,
    TenantSubscriptionStatus,
} from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";
import { tenantPrisma } from "../../data/tenant-prisma";
import { CustomError } from "../../domain/errors/custom.error";
import { TenantDataContext } from "../tenant/tenant-data-context";
import { TenantPurgeService } from "./tenant-purge.service";
import { getPlanDefinition, planLimitsAsTenantFields } from "../plans/plan-catalog";
import { PlanAccessService } from "../plans/plan-access.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GRACE_DAYS = 90;

/** @deprecated Usar getPlanDefinition/planLimitsAsTenantFields. */
export const PLAN_LIMITS = Object.fromEntries(
    Object.values(TenantPlanCode).map((code) => [code, planLimitsAsTenantFields(code)]),
) as Record<TenantPlanCode, ReturnType<typeof planLimitsAsTenantFields>>;

export type LegalProfileInput = {
    ruc: string;
    legalName: string;
    address: string;
    contactPhone?: string | null;
    contactEmail?: string | null;
    confirmRuc?: boolean;
};

function normalizeText(value: unknown, maxLength: number): string {
    return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function isValidPeruvianRuc(value: string): boolean {
    if (!/^\d{11}$/.test(value)) return false;
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => (
        total + Number(value[index]) * weight
    ), 0);
    const raw = 11 - (sum % 11);
    const expected = raw === 10 ? 0 : raw === 11 ? 1 : raw;
    return Number(value[10]) === expected;
}

function lifecycleMetadata(value: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function assertOwnerOrAdmin(role: TenantMembershipRole): void {
    if (role !== TenantMembershipRole.OWNER && role !== TenantMembershipRole.ADMIN) {
        throw CustomError.forbidden("Solo un propietario o administrador puede realizar esta acción");
    }
}

type QuotaResource = "users" | "products" | "stores";

function limaDateParts(value: Date): { year: number; month: number; day: number } {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(value);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return { year: get("year"), month: get("month"), day: get("day") };
}

function limaDayBounds(value: Date): { start: Date; end: Date } {
    const { year, month, day } = limaDateParts(value);
    // Perú usa UTC-05:00 y no aplica horario de verano.
    const start = new Date(Date.UTC(year, month - 1, day, 5, 0, 0, 0));
    return { start, end: new Date(start.getTime() + DAY_MS) };
}

function limaMonthBounds(value: Date): { start: Date; end: Date } {
    const { year, month } = limaDateParts(value);
    return {
        start: new Date(Date.UTC(year, month - 1, 1, 5, 0, 0, 0)),
        end: new Date(Date.UTC(year, month, 1, 5, 0, 0, 0)),
    };
}

export class TenantQuotaService {
    private static async lock(resource: string): Promise<void> {
        const tenantId = TenantDataContext.requireTenantId();
        // $executeRaw evita que Prisma intente deserializar el retorno `void`
        // de pg_advisory_xact_lock; el bloqueo vive hasta el commit/rollback.
        await tenantPrisma.$executeRaw(Prisma.sql`
            SELECT pg_advisory_xact_lock(
                hashtextextended(${`quota:${tenantId}:${resource}`}, 0)
            )
        `);
    }

    static async assertAvailable(resource: QuotaResource, requested = 1): Promise<void> {
        const tenantId = TenantDataContext.requireTenantId();
        await this.lock(resource);
        if (!Number.isInteger(requested) || requested < 1) {
            throw CustomError.badRequest("La cantidad solicitada no es válida");
        }
        const tenant = await tenantPrisma.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: {
                status: true,
                planCode: true,
                maxUsers: true,
                maxProducts: true,
                maxStores: true,
                welcomeStorePromotionEndsAt: true,
            },
        });
        if (tenant.status === TenantStatus.EXPIRED || tenant.status === TenantStatus.SUSPENDED) {
            throw CustomError.forbidden("La empresa está en modo de solo lectura");
        }
        if (tenant.status !== TenantStatus.TRIAL && tenant.status !== TenantStatus.ACTIVE) {
            throw CustomError.forbidden("La empresa no está disponible");
        }

        let used: number | bigint;
        let limit: number | bigint;
        if (resource === "users") {
            const [memberships, invitations] = await Promise.all([
                tenantPrisma.tenantMembership.count({
                    where: { tenantId, status: { in: ["ACTIVE", "INVITED"] } },
                }),
                tenantPrisma.tenantInvitation.count({
                    where: { tenantId, status: "PENDING", expiresAt: { gt: new Date() } },
                }),
            ]);
            used = memberships + invitations;
            limit = tenant.maxUsers;
        } else if (resource === "products") {
            used = await tenantPrisma.product.count({ where: { tenantId, isActive: true } });
            limit = tenant.maxProducts;
        } else {
            used = await tenantPrisma.store.count({ where: { tenantId, isActive: true } });
            const promotionActive = tenant.planCode === TenantPlanCode.STARTER
                && Boolean(
                    tenant.welcomeStorePromotionEndsAt
                    && tenant.welcomeStorePromotionEndsAt.getTime() > Date.now(),
                );
            limit = promotionActive ? Math.max(2, tenant.maxStores) : tenant.maxStores;
        }

        if (BigInt(used) + BigInt(requested) > BigInt(limit)) {
            throw new CustomError(`Se alcanzó la cuota del plan para ${resource}`, 409);
        }
    }

    static async assertVariantsAvailable(
        productId: number,
        requestedActive: number,
        replacingExisting = false,
    ): Promise<void> {
        if (!Number.isInteger(requestedActive) || requestedActive < 0) {
            throw CustomError.badRequest("La cantidad de variantes no es válida");
        }
        const tenantId = TenantDataContext.requireTenantId();
        await this.lock(`variants:${productId}`);
        const tenant = await tenantPrisma.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: { maxVariantsPerProduct: true },
        });
        const current = replacingExisting ? 0 : await tenantPrisma.productVariant.count({
            where: { tenantId, productId, isActive: true },
        });
        if (current + requestedActive > tenant.maxVariantsPerProduct) {
            throw new CustomError("Se alcanzó la cuota de variantes activas para este producto", 409);
        }
    }

    static async assertMainImagesAvailable(
        productId: number,
        requested: number,
        replacingExisting = false,
    ): Promise<void> {
        const tenantId = TenantDataContext.requireTenantId();
        await this.lock(`main-images:${productId}`);
        const tenant = await tenantPrisma.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: { maxMainImagesPerProduct: true },
        });
        const current = replacingExisting ? 0 : await tenantPrisma.productImage.count({
            where: { tenantId, productId },
        });
        if (current + requested > tenant.maxMainImagesPerProduct) {
            throw new CustomError("Se alcanzó la cuota de imágenes principales para este producto", 409);
        }
    }

    static async assertVariantImagesAllowed(requested: number): Promise<void> {
        if (requested <= 0) return;
        const tenantId = TenantDataContext.requireTenantId();
        await this.lock("variant-images");
        const tenant = await tenantPrisma.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: { maxImagesPerVariant: true },
        });
        if (tenant.maxImagesPerVariant < 1) {
            throw new CustomError("El plan actual no permite imágenes por variante", 403);
        }
    }

    static async getPosSalesUsage(now = new Date()) {
        const tenantId = TenantDataContext.requireTenantId();
        const tenant = await tenantPrisma.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: {
                planCode: true,
                maxPosSalesPerMonth: true,
                trialStartedAt: true,
                trialEndsAt: true,
                createdAt: true,
            },
        });
        const period = tenant.planCode === TenantPlanCode.TRIAL
            ? {
                start: tenant.trialStartedAt ?? tenant.createdAt,
                end: tenant.trialEndsAt ?? new Date(now.getTime() + DAY_MS),
            }
            : limaMonthBounds(now);
        const day = limaDayBounds(now);
        const [used, usedToday] = await Promise.all([
            tenantPrisma.order.count({
                where: {
                    tenantId,
                    salesChannel: "POS",
                    createdAt: { gte: period.start, lt: period.end },
                },
            }),
            tenantPrisma.order.count({
                where: {
                    tenantId,
                    salesChannel: "POS",
                    createdAt: { gte: day.start, lt: day.end },
                },
            }),
        ]);
        return {
            used,
            usedToday,
            limit: tenant.maxPosSalesPerMonth,
            periodStart: period.start,
            periodEnd: period.end,
            graceUntil: used >= tenant.maxPosSalesPerMonth && usedToday > 0 ? day.end : null,
        };
    }

    static async assertPosSaleAllowed(now = new Date()): Promise<void> {
        await this.lock("pos-sales");
        const usage = await this.getPosSalesUsage(now);
        if (usage.used < usage.limit || usage.usedToday > 0) return;
        throw new CustomError(
            "Se alcanzó la cuota de ventas POS. Actualiza el plan o espera la renovación del periodo",
            409,
        );
    }
}

export class TenantLifecycleService {
    static async checkCertificateExpiry(now = new Date()) {
        const tenantId = TenantDataContext.requireTenantId();
        const config = await tenantPrisma.sunatEmisorConfig.findUnique({
            where: { tenantId },
            select: {
                certNotAfter: true,
                certificateValidatedAt: true,
                environment: true,
            },
        });
        if (!config?.certNotAfter) return { configured: false, alerts: [] as number[], expired: false };
        const daysRemaining = Math.ceil((config.certNotAfter.getTime() - now.getTime()) / DAY_MS);
        const alerts: number[] = [];
        for (const threshold of [30, 15, 7, 1]) {
            if (daysRemaining > threshold || daysRemaining < 0) continue;
            const type = `SUNAT_CERTIFICATE_EXPIRES_${threshold}D`;
            const exists = await tenantPrisma.tenantLifecycleEvent.findFirst({
                where: {
                    tenantId,
                    type,
                    createdAt: { gte: config.certificateValidatedAt ?? new Date(0) },
                },
            });
            if (!exists) {
                await tenantPrisma.tenantLifecycleEvent.create({
                    data: {
                        tenantId,
                        type,
                        source: "certificate-worker",
                        metadata: lifecycleMetadata({ daysRemaining, expiresAt: config.certNotAfter.toISOString() }),
                    },
                });
                alerts.push(threshold);
            }
        }
        const expired = config.certNotAfter <= now;
        if (expired && config.environment === "PRODUCCION") {
            await tenantPrisma.tenant.update({
                where: { id: tenantId },
                data: { sunatProductionEnabled: false },
            });
            const previous = await tenantPrisma.tenantLifecycleEvent.findFirst({
                where: {
                    tenantId,
                    type: "SUNAT_CERTIFICATE_EXPIRED",
                    createdAt: { gte: config.certificateValidatedAt ?? new Date(0) },
                },
            });
            if (!previous) {
                await tenantPrisma.tenantLifecycleEvent.create({
                    data: {
                        tenantId,
                        type: "SUNAT_CERTIFICATE_EXPIRED",
                        source: "certificate-worker",
                        metadata: lifecycleMetadata({ expiresAt: config.certNotAfter.toISOString() }),
                    },
                });
            }
        }
        return { configured: true, alerts, expired, daysRemaining };
    }

    static async getCurrent() {
        const tenantId = TenantDataContext.requireTenantId();
        const tenant = await tenantPrisma.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            include: {
                subscription: true,
                activePlanVersion: { include: { plan: true } },
            },
        });
        const [
            memberships,
            invitations,
            products,
            stores,
            activeVariants,
            storage,
            posSales,
            variantsByProduct,
            mainImagesByProduct,
            variantsWithImages,
        ] = await Promise.all([
            tenantPrisma.tenantMembership.count({
                where: { tenantId, status: { in: ["ACTIVE", "INVITED"] } },
            }),
            tenantPrisma.tenantInvitation.count({
                where: { tenantId, status: "PENDING", expiresAt: { gt: new Date() } },
            }),
            tenantPrisma.product.count({ where: { tenantId, isActive: true } }),
            tenantPrisma.store.count({ where: { tenantId, isActive: true } }),
            tenantPrisma.productVariant.count({ where: { tenantId, isActive: true } }),
            tenantPrisma.commercialAsset.aggregate({
                where: { tenantId, status: "ACTIVE" },
                _sum: { sizeBytes: true },
            }),
            TenantQuotaService.getPosSalesUsage(),
            tenantPrisma.productVariant.groupBy({
                by: ["productId"],
                where: { tenantId, isActive: true },
                _count: { _all: true },
            }),
            tenantPrisma.productImage.groupBy({
                by: ["productId"],
                where: { tenantId },
                _count: { _all: true },
            }),
            tenantPrisma.productVariant.count({
                where: { tenantId, imageUrl: { not: null } },
            }),
        ]);
        const definition = getPlanDefinition(tenant.planCode);
        const activePlanVersion = tenant.activePlanVersion;
        const effectiveFeatures = Array.from(PlanAccessService.effectiveFeatures(tenant)).sort();
        const promotionActive = tenant.planCode === TenantPlanCode.STARTER
            && Boolean(
                tenant.welcomeStorePromotionEndsAt
                && tenant.welcomeStorePromotionEndsAt.getTime() > Date.now(),
            );
        const effectiveMaxStores = promotionActive ? Math.max(2, tenant.maxStores) : tenant.maxStores;
        const quotaConflict = (used: number, limit: number) => ({
            used,
            limit,
            excess: Math.max(0, used - limit),
        });
        const conflicts = {
            users: quotaConflict(memberships + invitations, tenant.maxUsers),
            products: quotaConflict(products, tenant.maxProducts),
            stores: quotaConflict(stores, effectiveMaxStores),
            productsOverVariantLimit: variantsByProduct.filter(
                (row) => row._count._all > tenant.maxVariantsPerProduct,
            ).length,
            productsOverMainImageLimit: mainImagesByProduct.filter(
                (row) => row._count._all > tenant.maxMainImagesPerProduct,
            ).length,
            variantsWithImagesNotAllowed: tenant.maxImagesPerVariant === 0 ? variantsWithImages : 0,
        };
        const hasConflicts = conflicts.users.excess > 0
            || conflicts.products.excess > 0
            || conflicts.stores.excess > 0
            || conflicts.productsOverVariantLimit > 0
            || conflicts.productsOverMainImageLimit > 0
            || conflicts.variantsWithImagesNotAllowed > 0;
        const { activePlanVersion: _activePlanVersion, ...tenantSnapshot } = tenant;
        return {
            tenant: {
                ...tenantSnapshot,
                maxStorageBytes: tenant.maxStorageBytes.toString(),
            },
            plan: {
                code: definition.code,
                name: activePlanVersion?.plan.displayName ?? definition.publicName,
                version: activePlanVersion?.version ?? null,
                planVersionId: activePlanVersion?.id ?? null,
                monthlyPricePen: activePlanVersion?.monthlyPrice
                    ? Number(activePlanVersion.monthlyPrice.toString())
                    : definition.monthlyPricePen,
                features: effectiveFeatures,
                effectiveMaxStores,
                welcomeStorePromotion: {
                    active: promotionActive,
                    startedAt: tenant.welcomeStorePromotionStartedAt,
                    endsAt: tenant.welcomeStorePromotionEndsAt,
                    primaryStoreId: tenant.primaryStoreId,
                    warning: promotionActive
                        && tenant.welcomeStorePromotionEndsAt!.getTime() - Date.now() <= 5 * DAY_MS,
                },
            },
            usage: {
                users: memberships + invitations,
                products,
                stores,
                activeVariants,
                posSales: posSales.used,
                posSalesToday: posSales.usedToday,
                posSalesPeriodStart: posSales.periodStart,
                posSalesPeriodEnd: posSales.periodEnd,
                posSalesGraceUntil: posSales.graceUntil,
                storageBytes: (storage._sum.sizeBytes ?? 0n).toString(),
            },
            conflicts: {
                hasConflicts,
                ...conflicts,
            },
            readOnly: tenant.status === TenantStatus.EXPIRED
                || tenant.status === TenantStatus.SUSPENDED,
        };
    }

    static async setPrimaryStore(
        storeId: number,
        actor: { userId: number; role: TenantMembershipRole },
    ) {
        assertOwnerOrAdmin(actor.role);
        if (!Number.isInteger(storeId) || storeId < 1) {
            throw CustomError.badRequest("La tienda principal no es válida");
        }
        const tenantId = TenantDataContext.requireTenantId();
        const store = await tenantPrisma.store.findFirst({
            where: { id: storeId, tenantId, isActive: true },
            select: { id: true, name: true },
        });
        if (!store) throw CustomError.notFound("La tienda principal no existe o está inactiva");
        await tenantPrisma.tenant.update({
            where: { id: tenantId },
            data: { primaryStoreId: store.id },
        });
        await tenantPrisma.tenantLifecycleEvent.create({
            data: {
                tenantId,
                type: "PRIMARY_STORE_SELECTED",
                actorUserId: actor.userId,
                source: "tenant-api",
                metadata: lifecycleMetadata({ storeId: store.id }),
            },
        });
        return store;
    }

    static async expireWelcomeStorePromotions(now = new Date()) {
        const due = await platformPrisma.tenant.findMany({
            where: {
                status: TenantStatus.ACTIVE,
                planCode: TenantPlanCode.STARTER,
                welcomeStorePromotionEndsAt: { lte: now },
                stores: { some: { isActive: true } },
            },
            select: { id: true },
        });
        let deactivatedStores = 0;
        let processed = 0;
        for (const { id } of due) {
            const result = await platformPrisma.$transaction(async (tx) => {
                const alreadyEnded = await tx.tenantLifecycleEvent.findFirst({
                    where: { tenantId: id, type: "WELCOME_STORE_PROMOTION_ENDED" },
                    select: { id: true },
                });
                if (alreadyEnded) return 0;
                const tenant = await tx.tenant.findUniqueOrThrow({
                    where: { id },
                    select: { primaryStoreId: true },
                });
                const stores = await tx.store.findMany({
                    where: { tenantId: id, isActive: true },
                    select: { id: true },
                    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                });
                const primaryStoreId = stores.some((store) => store.id === tenant.primaryStoreId)
                    ? tenant.primaryStoreId!
                    : stores[0]?.id ?? null;
                const changed = primaryStoreId
                    ? await tx.store.updateMany({
                        where: { tenantId: id, isActive: true, id: { not: primaryStoreId } },
                        data: { isActive: false },
                    })
                    : { count: 0 };
                await tx.tenant.update({
                    where: { id },
                    data: { primaryStoreId },
                });
                await tx.tenantLifecycleEvent.create({
                    data: {
                        tenantId: id,
                        type: "WELCOME_STORE_PROMOTION_ENDED",
                        source: "lifecycle-worker",
                        metadata: lifecycleMetadata({
                            primaryStoreId,
                            deactivatedStores: changed.count,
                            endedAt: now.toISOString(),
                        }),
                    },
                });
                return changed.count;
            });
            processed += 1;
            deactivatedStores += result;
        }
        return { processed, deactivatedStores, checkedAt: now };
    }

    static async suspendSubscriptionsPastGrace(now = new Date()) {
        const due = await platformPrisma.tenant.findMany({
            where: {
                status: TenantStatus.ACTIVE,
                graceEndsAt: { lte: now },
                subscription: {
                    status: {
                        in: [TenantSubscriptionStatus.PAST_DUE, TenantSubscriptionStatus.CANCELLED],
                    },
                },
            },
            select: { id: true },
        });
        let suspended = 0;
        for (const { id } of due) {
            await platformPrisma.$transaction(async (tx) => {
                const changed = await tx.tenant.updateMany({
                    where: { id, status: TenantStatus.ACTIVE, graceEndsAt: { lte: now } },
                    data: { status: TenantStatus.SUSPENDED, readOnlyAt: now },
                });
                if (changed.count === 0) return;
                const subscription = await tx.tenantSubscription.findUnique({
                    where: { tenantId: id },
                    select: { status: true },
                });
                if (subscription?.status === TenantSubscriptionStatus.PAST_DUE) {
                    await tx.tenantSubscription.update({
                        where: { tenantId: id },
                        data: { status: TenantSubscriptionStatus.SUSPENDED, suspendedAt: now },
                    });
                } else if (subscription) {
                    await tx.tenantSubscription.update({
                        where: { tenantId: id },
                        data: { suspendedAt: now },
                    });
                }
                await tx.tenantLifecycleEvent.create({
                    data: {
                        tenantId: id,
                        type: "SUBSCRIPTION_GRACE_EXPIRED",
                        source: "lifecycle-worker",
                        metadata: lifecycleMetadata({ suspendedAt: now.toISOString() }),
                    },
                });
                suspended += 1;
            });
        }
        return { suspended, checkedAt: now };
    }

    static async updateLegalProfile(
        input: LegalProfileInput,
        actor: { userId: number; role: TenantMembershipRole },
        now = new Date(),
    ) {
        assertOwnerOrAdmin(actor.role);
        const tenantId = TenantDataContext.requireTenantId();
        const ruc = String(input.ruc ?? "").replace(/\D/g, "");
        if (!isValidPeruvianRuc(ruc)) {
            throw CustomError.badRequest("El RUC no supera la validación de dígito de control");
        }
        const legalName = normalizeText(input.legalName, 200);
        const address = normalizeText(input.address, 300);
        if (!legalName || !address) {
            throw CustomError.badRequest("Razón social y dirección son obligatorias");
        }
        const contactPhone = normalizeText(input.contactPhone, 40) || null;
        const contactEmail = normalizeText(input.contactEmail, 320).toLowerCase() || null;
        if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
            throw CustomError.badRequest("El correo de contacto no es válido");
        }

        const current = await tenantPrisma.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: { ruc: true, rucConfirmedAt: true },
        });
        if (current.rucConfirmedAt && current.ruc !== ruc) {
            throw new CustomError(
                "Un RUC confirmado solo puede cambiarse mediante revision de plataforma",
                409,
            );
        }
        const rucConfirmedAt = current.rucConfirmedAt ?? (input.confirmRuc ? now : null);

        try {
            const tenant = await tenantPrisma.tenant.update({
                where: { id: tenantId },
                data: {
                    ruc,
                    legalName,
                    address,
                    contactPhone,
                    contactEmail,
                    rucConfirmedAt,
                },
            });
            await tenantPrisma.tenantLifecycleEvent.create({
                data: {
                    tenantId,
                    type: !current.rucConfirmedAt && rucConfirmedAt
                        ? "LEGAL_PROFILE_CONFIRMED"
                        : "LEGAL_PROFILE_UPDATED",
                    actorUserId: actor.userId,
                    source: "tenant-api",
                    metadata: lifecycleMetadata({ rucLast4: ruc.slice(-4) }),
                },
            });
            await tenantPrisma.$executeRawUnsafe(
                `UPDATE "SystemSetting"
                 SET "value" = CASE "key"
                    WHEN 'company_legal_name' THEN $2
                    WHEN 'company_ruc' THEN $3
                    WHEN 'company_address' THEN $4
                    WHEN 'company_phone' THEN $5
                    WHEN 'company_email' THEN $6
                    ELSE "value" END,
                    "updatedAt" = CURRENT_TIMESTAMP
                 WHERE "tenantId" = $1::uuid
                   AND "key" = ANY($7::text[])`,
                tenantId,
                legalName,
                ruc,
                address,
                contactPhone ?? "",
                contactEmail ?? "",
                ["company_legal_name", "company_ruc", "company_address", "company_phone", "company_email"],
            );
            return tenant;
        } catch (caught) {
            if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002") {
                throw new CustomError("El RUC confirmado ya pertenece a otra empresa", 409);
            }
            throw caught;
        }
    }

    static async expireDueTrials(now = new Date(), graceDays = DEFAULT_GRACE_DAYS) {
        const due = await platformPrisma.tenant.findMany({
            where: { status: TenantStatus.TRIAL, trialEndsAt: { lte: now } },
            select: { id: true },
        });
        for (const { id } of due) {
            await platformPrisma.$transaction(async (tx) => {
                const graceEndsAt = new Date(now.getTime() + graceDays * DAY_MS);
                const changed = await tx.tenant.updateMany({
                    where: { id, status: TenantStatus.TRIAL, trialEndsAt: { lte: now } },
                    data: {
                        status: TenantStatus.EXPIRED,
                        readOnlyAt: now,
                        graceEndsAt,
                        purgeScheduledAt: graceEndsAt,
                        sunatProductionEnabled: false,
                    },
                });
                if (changed.count === 0) return;
                await tx.tenantLifecycleEvent.create({
                    data: {
                        tenantId: id,
                        type: "TRIAL_EXPIRED",
                        source: "lifecycle-worker",
                        metadata: lifecycleMetadata({ graceEndsAt: graceEndsAt.toISOString() }),
                    },
                });
                await tx.sunatJob.upsert({
                    where: {
                        tenantId_type_idempotencyKey: {
                            tenantId: id,
                            type: "PURGE_TRIAL",
                            idempotencyKey: `purge-trial:${id}`,
                        },
                    },
                    create: {
                        tenantId: id,
                        type: "PURGE_TRIAL",
                        idempotencyKey: `purge-trial:${id}`,
                        correlationId: `trial-expiry:${id}`,
                        payload: lifecycleMetadata({ tenantId: id }),
                        nextRunAt: graceEndsAt,
                    },
                    update: { nextRunAt: graceEndsAt, status: "PENDING" },
                });
                await tx.sunatJob.upsert({
                    where: {
                        tenantId_type_idempotencyKey: {
                            tenantId: id,
                            type: "NOTIFY_TRIAL_EXPIRY",
                            idempotencyKey: `notify-trial-expiry:${id}`,
                        },
                    },
                    create: {
                        tenantId: id,
                        type: "NOTIFY_TRIAL_EXPIRY",
                        idempotencyKey: `notify-trial-expiry:${id}`,
                        correlationId: `trial-expiry:${id}`,
                        payload: lifecycleMetadata({ tenantId: id }),
                        nextRunAt: now,
                    },
                    update: {},
                });
            });
        }
        return { expired: due.length, checkedAt: now };
    }

    static async purgeDueTrials(now = new Date(), onlyTenantId?: string) {
        const due = await platformPrisma.tenant.findMany({
            where: {
                ...(onlyTenantId ? { id: onlyTenantId } : {}),
                OR: [
                    { status: TenantStatus.EXPIRED, graceEndsAt: { lte: now } },
                    {
                        status: TenantStatus.PURGED,
                        lifecycleEvents: { none: { type: "TRIAL_PURGED" } },
                    },
                ],
            },
            select: { id: true },
        });
        const results = [];
        for (const { id } of due) {
            results.push(await TenantPurgeService.purgeExpiredTenant(id, now));
        }
        return {
            purged: results.filter((result) => result.purged).length,
            deletedRows: results.reduce((sum, result) => sum + result.deletedRows, 0),
            batches: results.reduce((sum, result) => sum + result.batches, 0),
            deletedUsers: results.reduce((sum, result) => sum + result.deletedUsers, 0),
            checkedAt: now,
        };
    }

    static async approveProduction(
        tenantId: string,
        platformActorUserId: number,
        now = new Date(),
    ) {
        return platformPrisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.findUnique({
                where: { id: tenantId },
                include: {
                    subscription: true,
                    memberships: {
                        where: {
                            role: TenantMembershipRole.OWNER,
                            status: TenantMembershipStatus.ACTIVE,
                        },
                        include: {
                            user: {
                                select: {
                                    isActive: true,
                                    trialRegistration: { select: { emailVerifiedAt: true } },
                                },
                            },
                        },
                    },
                    sunatEmisorConfigs: true,
                    comprobanteSeries: { where: { isActive: true }, take: 1 },
                },
            });
            if (!tenant) throw CustomError.notFound("Empresa no encontrada");
            if (tenant.kind === TenantKind.TRIAL || tenant.status === TenantStatus.TRIAL) {
                throw CustomError.forbidden("Un trial nunca puede activar SUNAT producción");
            }
            if (!tenant.ruc || !tenant.rucConfirmedAt || !isValidPeruvianRuc(tenant.ruc)) {
                throw CustomError.badRequest("La empresa requiere un RUC confirmado");
            }
            if (tenant.subscription?.status !== TenantSubscriptionStatus.ACTIVE) {
                throw CustomError.badRequest("La suscripción debe estar activa");
            }
            if (!tenant.memberships.some((membership) => (
                membership.user.isActive
                && Boolean(membership.user.trialRegistration?.emailVerifiedAt)
            ))) {
                throw CustomError.badRequest("La empresa requiere un propietario activo con correo verificado");
            }
            const config = tenant.sunatEmisorConfigs[0];
            if (
                !config
                || config.environment !== "PRODUCCION"
                || config.ruc !== tenant.ruc
                || !config.activo
                || !config.certP12Enc
                || !config.certPasswordEnc
                || !config.solPasswordEnc
                || !config.certificateValidatedAt
                || !config.credentialsVerifiedAt
                || !config.certNotAfter
                || config.certNotAfter <= now
            ) {
                throw CustomError.badRequest("Certificado y credenciales SUNAT deben estar vigentes y verificados");
            }
            if (tenant.comprobanteSeries.length === 0) {
                throw CustomError.badRequest("Configura al menos una serie SUNAT activa");
            }

            const updated = await tx.tenant.update({
                where: { id: tenant.id },
                data: {
                    productionApprovedAt: now,
                    productionApprovedById: platformActorUserId,
                    sunatProductionEnabled: true,
                },
            });
            await tx.tenantLifecycleEvent.create({
                data: {
                    tenantId: tenant.id,
                    type: "SUNAT_PRODUCTION_APPROVED",
                    actorUserId: platformActorUserId,
                    source: "platform-api",
                },
            });
            return updated;
        });
    }
}
