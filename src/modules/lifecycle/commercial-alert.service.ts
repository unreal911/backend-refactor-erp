import { Prisma } from "@prisma/client";
import { tenantPrisma } from "../../data/tenant-prisma";
import { CustomError } from "../../domain/errors/custom.error";
import { TenantDataContext } from "../tenant/tenant-data-context";
import { TenantQuotaService } from "./tenant-lifecycle.service";

type AlertDefinition = {
    key: string;
    type: string;
    severity: "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";
    title: string;
    message: string;
    percent?: number;
    metadata?: Prisma.InputJsonObject;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function commercialAlertThreshold(percent: number, levels = [70, 85, 100]): number | null {
    return levels.filter((level) => percent >= level).at(-1) ?? null;
}

function severity(level: number): AlertDefinition["severity"] {
    if (level >= 100) return "CRITICAL";
    if (level >= 85) return "WARNING";
    return "INFO";
}

export function buildQuotaAlert(key: string, label: string, used: number | bigint, limit: number | bigint, levels?: number[]): AlertDefinition | null {
    if (BigInt(limit) <= 0n) return null;
    const percent = Number((BigInt(used) * 100n) / BigInt(limit));
    const level = commercialAlertThreshold(percent, levels);
    if (level == null) return null;
    return {
        key: `quota:${key}`,
        type: "QUOTA_USAGE",
        severity: severity(level),
        title: `${label}: ${percent}% utilizado`,
        message: level >= 100
            ? `Alcanzaste el límite de ${label.toLowerCase()}. Revisa recursos o cambia de plan.`
            : `Tu consumo de ${label.toLowerCase()} superó el ${level}%.`,
        percent: level,
        metadata: { resource: key, used: String(used), limit: String(limit), actualPercent: percent, href: "/admin/empresa" },
    };
}

export function buildPaymentAlert(request: {
    id: string;
    code: string;
    status: string;
    planVersion?: { plan?: { displayName?: string | null } | null } | null;
}): AlertDefinition | null {
    const planName = request.planVersion?.plan?.displayName || "seleccionado";
    if (request.status === "PENDING_REVIEW") return {
        key: `payment:${request.id}`,
        type: "PAYMENT_REVIEW",
        severity: "INFO",
        title: "Tu pago está en revisión",
        message: `Recibimos el comprobante ${request.code} para el plan ${planName}. Te avisaremos cuando termine la validación.`,
        percent: 10,
        metadata: { paymentRequestId: request.id, status: request.status, href: "/admin/empresa#seguimiento-pagos" },
    };
    if (request.status === "APPROVED") return {
        key: `payment:${request.id}`,
        type: "PAYMENT_APPROVED",
        severity: "SUCCESS",
        title: "Pago realizado",
        message: `Validamos el comprobante ${request.code}. El plan ${planName} ya fue procesado correctamente.`,
        percent: 20,
        metadata: { paymentRequestId: request.id, status: request.status, href: "/admin/empresa#seguimiento-pagos" },
    };
    return null;
}

function maxGroupPercent(rows: Array<{ _count: { _all: number } }>, limit: number): number {
    if (limit <= 0) return rows.length > 0 ? 100 : 0;
    return rows.reduce((max, row) => Math.max(max, Math.floor((row._count._all * 100) / limit)), 0);
}

export class CommercialAlertService {
    private static async sync(definitions: AlertDefinition[]) {
        const tenantId = TenantDataContext.requireTenantId();
        const desired = new Map(definitions.map((definition) => [definition.key, definition]));
        const existing = await tenantPrisma.commercialAlert.findMany({ where: { tenantId } });
        const now = new Date();
        for (const current of existing) {
            if (!current.isActive || desired.has(current.key)) continue;
            await tenantPrisma.commercialAlert.update({
                where: { id: current.id },
                data: { isActive: false, resolvedAt: now },
            });
        }
        for (const definition of definitions) {
            const current = existing.find((alert) => alert.key === definition.key);
            const escalated = Number(definition.percent || 0) > Number(current?.percent || 0);
            await tenantPrisma.commercialAlert.upsert({
                where: { tenantId_key: { tenantId, key: definition.key } },
                create: {
                    tenantId,
                    ...definition,
                    metadata: definition.metadata ?? {},
                },
                update: {
                    type: definition.type,
                    severity: definition.severity,
                    title: definition.title,
                    message: definition.message,
                    percent: definition.percent ?? null,
                    metadata: definition.metadata ?? {},
                    isActive: true,
                    lastTriggeredAt: now,
                    resolvedAt: null,
                    ...(escalated ? { dismissedAt: null } : {}),
                },
            });
        }
    }

    static async evaluateCurrent(now = new Date()) {
        const tenantId = TenantDataContext.requireTenantId();
        const tenant = await tenantPrisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
        const [memberships, invitations, products, stores, storage, variantsByProduct, mainImagesByProduct, variantsWithImages, pos, latestPayment] = await Promise.all([
            tenantPrisma.tenantMembership.count({ where: { tenantId, status: { in: ["ACTIVE", "INVITED"] } } }),
            tenantPrisma.tenantInvitation.count({ where: { tenantId, status: "PENDING", expiresAt: { gt: now } } }),
            tenantPrisma.product.count({ where: { tenantId, isActive: true } }),
            tenantPrisma.store.count({ where: { tenantId, isActive: true } }),
            tenantPrisma.commercialAsset.aggregate({ where: { tenantId, status: "ACTIVE" }, _sum: { sizeBytes: true } }),
            tenantPrisma.productVariant.groupBy({ by: ["productId"], where: { tenantId, isActive: true }, _count: { _all: true } }),
            tenantPrisma.productImage.groupBy({ by: ["productId"], where: { tenantId }, _count: { _all: true } }),
            tenantPrisma.productVariant.count({ where: { tenantId, imageUrl: { not: null } } }),
            TenantQuotaService.getPosSalesUsage(now),
            tenantPrisma.manualPaymentRequest.findFirst({
                where: { tenantId, status: { in: ["PENDING_REVIEW", "APPROVED"] } },
                include: { planVersion: { include: { plan: true } } },
                orderBy: { createdAt: "desc" },
            }),
        ]);
        const definitions: AlertDefinition[] = [
            buildQuotaAlert("products", "Productos", products, tenant.maxProducts),
            buildQuotaAlert("users", "Usuarios", memberships + invitations, tenant.maxUsers),
            buildQuotaAlert("stores", "Tiendas", stores, tenant.maxStores),
            buildQuotaAlert("pos", "Ventas POS", pos.used, pos.limit),
            buildQuotaAlert("storage", "Almacenamiento comercial", storage._sum.sizeBytes ?? 0n, tenant.maxStorageBytes, [75, 80, 100]),
            buildQuotaAlert("variants", "Variantes por producto", maxGroupPercent(variantsByProduct, tenant.maxVariantsPerProduct), 100),
            buildQuotaAlert("main-images", "Imágenes principales", maxGroupPercent(mainImagesByProduct, tenant.maxMainImagesPerProduct), 100),
        ].filter((alert): alert is AlertDefinition => Boolean(alert));

        if (latestPayment) {
            const paymentAlert = buildPaymentAlert(latestPayment);
            if (paymentAlert) definitions.push(paymentAlert);
        }

        if (tenant.maxImagesPerVariant === 0 && variantsWithImages > 0) definitions.push({
            key: "quota:variant-images",
            type: "QUOTA_USAGE",
            severity: "CRITICAL",
            title: "Imágenes de variante fuera del plan",
            message: `Hay ${variantsWithImages} variante(s) con imagen y el plan actual no las permite.`,
            percent: 100,
            metadata: { resource: "variant-images", used: String(variantsWithImages), limit: "0", href: "/admin/empresa" },
        });

        if (tenant.planCode === "TRIAL" && tenant.trialEndsAt) {
            const daysRemaining = Math.max(0, Math.ceil((tenant.trialEndsAt.getTime() - now.getTime()) / DAY_MS));
            if (daysRemaining <= 5) definitions.push({
                key: "trial:ending",
                type: "TRIAL_ENDING",
                severity: daysRemaining <= 1 ? "CRITICAL" : "WARNING",
                title: `Tu prueba termina en ${daysRemaining} día(s)`,
                message: "Elige un plan para conservar las operaciones comerciales sin interrupción.",
                metadata: { daysRemaining, endsAt: tenant.trialEndsAt.toISOString(), href: "/admin/empresa" },
            });
        }
        if (tenant.welcomeStorePromotionEndsAt && tenant.welcomeStorePromotionEndsAt > now) {
            const daysRemaining = Math.max(0, Math.ceil((tenant.welcomeStorePromotionEndsAt.getTime() - now.getTime()) / DAY_MS));
            if (daysRemaining <= 5) definitions.push({
                key: "promotion:second-store",
                type: "STORE_PROMOTION_ENDING",
                severity: daysRemaining <= 1 ? "CRITICAL" : "WARNING",
                title: `La segunda tienda vence en ${daysRemaining} día(s)`,
                message: "Elige la tienda principal o cambia a Negocio antes del vencimiento.",
                metadata: { daysRemaining, endsAt: tenant.welcomeStorePromotionEndsAt.toISOString(), href: "/admin/empresa" },
            });
        }
        await this.sync(definitions);
        return this.listCurrent();
    }

    static async listCurrent() {
        const tenantId = TenantDataContext.requireTenantId();
        return tenantPrisma.commercialAlert.findMany({
            where: { tenantId, isActive: true, dismissedAt: null },
            orderBy: [{ severity: "asc" }, { lastTriggeredAt: "desc" }],
            take: 20,
        });
    }

    static async dismiss(id: string) {
        const tenantId = TenantDataContext.requireTenantId();
        const result = await tenantPrisma.commercialAlert.updateMany({
            where: { id, tenantId, isActive: true },
            data: { dismissedAt: new Date() },
        });
        if (result.count !== 1) throw CustomError.notFound("La alerta no existe");
        return { dismissed: true };
    }
}
