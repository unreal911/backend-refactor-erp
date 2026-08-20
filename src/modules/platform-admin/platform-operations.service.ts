import { ManualPaymentRequestStatus, Prisma, TenantStatus } from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";

function pageInput(value: unknown, fallback: number, max: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export class PlatformOperationsService {
    static async metrics() {
        const now = new Date();
        const [tenantGroups, planGroups, pendingPayments, scheduledPlans, recentAudit, imageProvider] = await Promise.all([
            platformPrisma.tenant.groupBy({
                by: ["status"],
                where: { status: { not: TenantStatus.PURGED } },
                _count: { _all: true },
            }),
            platformPrisma.tenant.groupBy({
                by: ["planCode"],
                where: { status: { not: TenantStatus.PURGED } },
                _count: { _all: true },
            }),
            platformPrisma.manualPaymentRequest.count({
                where: { status: ManualPaymentRequestStatus.PENDING_REVIEW, expiresAt: { gt: now } },
            }),
            platformPrisma.planVersion.count({ where: { status: "SCHEDULED", effectiveFrom: { gt: now } } }),
            platformPrisma.platformAuditEvent.count({ where: { occurredAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } }),
            platformPrisma.imageProviderProfile.findFirst({
                where: { isActive: true },
                select: { id: true, name: true, type: true, healthStatus: true, pauseNewUploads: true, lastHealthCheckedAt: true, capacityBytes: true, warningPercent: true },
            }),
        ]);
        const tenantByStatus = Object.fromEntries(tenantGroups.map((row) => [row.status, row._count._all]));
        const tenantByPlan = Object.fromEntries(planGroups.map((row) => [row.planCode, row._count._all]));
        const providerUsage = imageProvider ? await platformPrisma.commercialAsset.aggregate({
            where: { providerProfileId: imageProvider.id, status: "ACTIVE" },
            _sum: { sizeBytes: true },
        }) : null;
        const providerUsageBytes = providerUsage?._sum.sizeBytes ?? 0n;
        const capacityPercent = imageProvider?.capacityBytes && imageProvider.capacityBytes > 0n
            ? Number((providerUsageBytes * 10000n) / imageProvider.capacityBytes) / 100
            : null;
        return {
            tenantsTotal: tenantGroups.reduce((sum, row) => sum + row._count._all, 0),
            tenantsActive: tenantByStatus.ACTIVE ?? 0,
            trialsActive: tenantByStatus.TRIAL ?? 0,
            tenantsSuspended: tenantByStatus.SUSPENDED ?? 0,
            pendingPayments,
            scheduledPlanVersions: scheduledPlans,
            auditEventsLast24Hours: recentAudit,
            tenantsByPlan: tenantByPlan,
            imageProvider: imageProvider ? {
                ...imageProvider,
                capacityBytes: imageProvider.capacityBytes?.toString() ?? null,
                usageBytes: providerUsageBytes.toString(),
                capacityPercent,
                capacityWarning: capacityPercent !== null && capacityPercent >= imageProvider.warningPercent,
            } : null,
            generatedAt: now.toISOString(),
        };
    }

    static async listAudit(query: Record<string, unknown>) {
        const page = pageInput(query.page, 1, 1_000_000);
        const pageSize = pageInput(query.pageSize, 30, 100);
        const action = String(query.action || "").trim();
        const entityType = String(query.entityType || "").trim();
        const search = String(query.search || "").trim();
        const where: Prisma.PlatformAuditEventWhereInput = {
            ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
            ...(entityType ? { entityType: { equals: entityType, mode: "insensitive" } } : {}),
            ...(search ? {
                OR: [
                    { action: { contains: search, mode: "insensitive" } },
                    { entityType: { contains: search, mode: "insensitive" } },
                    { entityId: { contains: search, mode: "insensitive" } },
                    { reason: { contains: search, mode: "insensitive" } },
                    { correlationId: { contains: search, mode: "insensitive" } },
                ],
            } : {}),
        };
        const [items, total] = await Promise.all([
            platformPrisma.platformAuditEvent.findMany({
                where,
                orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            platformPrisma.platformAuditEvent.count({ where }),
        ]);
        return { items, total, page, pageSize };
    }

    static async listTenants(query: Record<string, unknown>) {
        const page = pageInput(query.page, 1, 1_000_000);
        const pageSize = pageInput(query.pageSize, 30, 100);
        const search = String(query.search || "").trim();
        const requestedStatus = String(query.status || "").trim().toUpperCase();
        const requestedPlan = String(query.planCode || "").trim().toUpperCase();
        const validStatuses = new Set(["TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED", "PURGED"]);
        const validPlans = new Set(["TRIAL", "STARTER", "GROWTH", "PREMIUM"]);
        const where: Prisma.TenantWhereInput = {
            ...(validStatuses.has(requestedStatus) ? { status: requestedStatus as TenantStatus } : {}),
            ...(validPlans.has(requestedPlan) ? { planCode: requestedPlan as "TRIAL" | "STARTER" | "GROWTH" | "PREMIUM" } : {}),
            ...(search ? {
                OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { legalName: { contains: search, mode: "insensitive" } },
                    { slug: { contains: search, mode: "insensitive" } },
                    { ruc: { contains: search } },
                    { contactEmail: { contains: search, mode: "insensitive" } },
                ],
            } : {}),
        };
        const [items, total] = await Promise.all([
            platformPrisma.tenant.findMany({
                where,
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: {
                    id: true,
                    slug: true,
                    name: true,
                    legalName: true,
                    ruc: true,
                    contactEmail: true,
                    status: true,
                    planCode: true,
                    trialEndsAt: true,
                    createdAt: true,
                    updatedAt: true,
                    activePlanVersion: { select: { id: true, version: true, monthlyPrice: true } },
                    subscription: { select: { status: true, currentPeriodEndsAt: true, suspendedAt: true } },
                    _count: { select: { memberships: true, products: true, stores: true, orders: true } },
                },
            }),
            platformPrisma.tenant.count({ where }),
        ]);
        return { items, total, page, pageSize };
    }
}
