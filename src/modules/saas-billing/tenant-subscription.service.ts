import { randomUUID } from "node:crypto";
import {
    BillingCycle,
    ManualPaymentRequestStatus,
    Prisma,
    TenantPlanCode,
} from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";
import { tenantPrisma } from "../../data/tenant-prisma";
import { CustomError } from "../../domain/errors/custom.error";
import { TenantDataContext } from "../tenant/tenant-data-context";
import { protectPaymentProof } from "./payment-proof-crypto";

const DAY_MS = 24 * 60 * 60 * 1000;

type DowngradeSelection = { userIds: string[]; productIds: number[]; storeIds: number[] };

function uniqueStrings(value: unknown): string[] {
    return Array.isArray(value) ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))] : [];
}

function uniquePositiveInts(value: unknown): number[] {
    return Array.isArray(value) ? [...new Set(value.map(Number).filter((item) => Number.isInteger(item) && item > 0))] : [];
}

function cleanText(value: unknown, maxLength: number): string | null {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    return normalized ? normalized.slice(0, maxLength) : null;
}

function money(value: unknown, field: string): Prisma.Decimal | null {
    if (value === undefined || value === null || value === "") return null;
    const parsed = new Prisma.Decimal(String(value));
    if (parsed.isNegative() || parsed.isZero() || parsed.decimalPlaces() > 2) {
        throw CustomError.badRequest(`${field} no es válido`);
    }
    return parsed;
}

function serializeRequest(request: any) {
    const { proof: _proof, ...safeRequest } = request;
    return {
        ...safeRequest,
        proofUrl: undefined,
        hasProof: Boolean(request.proof),
        proofDownloadUrl: null,
        offeredPrice: request.offeredPrice?.toFixed(2) ?? null,
        amountReported: request.amountReported?.toFixed(2) ?? null,
        planVersion: request.planVersion ? {
            ...request.planVersion,
            monthlyPrice: request.planVersion.monthlyPrice?.toFixed(2) ?? null,
            annualPrice: request.planVersion.annualPrice?.toFixed(2) ?? null,
            maxStorageBytes: request.planVersion.maxStorageBytes?.toString(),
        } : undefined,
    };
}

export class TenantSubscriptionService {
    private static async downgradePreviewWith(client: any, tenantId: string, planVersionId: string) {
        const [tenant, version, memberships, invitations, products, stores] = await Promise.all([
            client.tenant.findUnique({ where: { id: tenantId } }),
            client.planVersion.findUnique({ where: { id: planVersionId }, include: { plan: true } }),
            client.tenantMembership.findMany({ where: { tenantId, status: { in: ["ACTIVE", "INVITED"] } }, include: { user: true }, orderBy: [{ role: "asc" }, { createdAt: "asc" }] }),
            client.tenantInvitation.findMany({ where: { tenantId, status: "PENDING", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "asc" } }),
            client.product.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
            client.store.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, code: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
        ]);
        if (!tenant) throw CustomError.notFound("La empresa no existe");
        if (!version || version.status !== "ACTIVE") throw CustomError.badRequest("La versión del plan no está disponible");
        const users = [
            ...memberships.map((membership: any) => ({
                id: `membership:${membership.id}`,
                kind: "MEMBERSHIP",
                label: `${membership.user.firstName || ""} ${membership.user.lastName || ""}`.trim() || membership.user.email,
                detail: `${membership.user.email} · ${membership.role}`,
                required: membership.role === "OWNER",
            })),
            ...invitations.map((invitation: any) => ({
                id: `invitation:${invitation.id}`,
                kind: "INVITATION",
                label: invitation.email,
                detail: `Invitación pendiente · ${invitation.role}`,
                required: false,
            })),
        ];
        const limits = { users: version.maxUsers, products: version.maxProducts, stores: version.maxStores, maxVariantsPerProduct: version.maxVariantsPerProduct };
        const isDowngrade = version.maxUsers < tenant.maxUsers || version.maxProducts < tenant.maxProducts || version.maxStores < tenant.maxStores
            || version.maxVariantsPerProduct < tenant.maxVariantsPerProduct || version.maxMainImagesPerProduct < tenant.maxMainImagesPerProduct
            || version.maxImagesPerVariant < tenant.maxImagesPerVariant || version.maxStorageBytes < tenant.maxStorageBytes;
        const conflicts = {
            users: Math.max(0, users.length - limits.users),
            products: Math.max(0, products.length - limits.products),
            stores: Math.max(0, stores.length - limits.stores),
        };
        return {
            isDowngrade,
            requiresSelection: Object.values(conflicts).some((value) => value > 0),
            targetPlan: { code: version.plan.code, name: version.plan.displayName, planVersionId: version.id },
            limits,
            conflicts,
            users,
            products: products.map((product: any) => ({ id: product.id, label: product.name })),
            stores: stores.map((store: any) => ({ id: store.id, label: store.name, detail: store.code, required: store.id === tenant.primaryStoreId })),
            suggested: {
                userIds: users.filter((item) => item.required).concat(users.filter((item) => !item.required)).slice(0, limits.users).map((item) => item.id),
                productIds: products.slice(0, limits.products).map((product: any) => product.id),
                storeIds: stores.slice().sort((a: any, b: any) => Number(b.id === tenant.primaryStoreId) - Number(a.id === tenant.primaryStoreId)).slice(0, limits.stores).map((store: any) => store.id),
            },
        };
    }

    static async previewDowngrade(planVersionId: string) {
        return this.downgradePreviewWith(tenantPrisma, TenantDataContext.requireTenantId(), planVersionId);
    }

    private static validateDowngradeSelection(preview: any, raw: unknown): DowngradeSelection | null {
        if (!preview.isDowngrade) return null;
        if (!preview.requiresSelection && !raw) return null;
        const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        const selection: DowngradeSelection = {
            userIds: uniqueStrings(input.userIds),
            productIds: uniquePositiveInts(input.productIds),
            storeIds: uniquePositiveInts(input.storeIds),
        };
        if (preview.requiresSelection && !raw) throw CustomError.conflict("El downgrade requiere elegir los recursos que seguirán activos");
        if (selection.userIds.length > preview.limits.users || selection.productIds.length > preview.limits.products || selection.storeIds.length > preview.limits.stores) {
            throw CustomError.badRequest("La selección supera las cuotas del plan elegido");
        }
        const validUsers = new Set(preview.users.map((item: any) => item.id));
        const validProducts = new Set(preview.products.map((item: any) => item.id));
        const validStores = new Set(preview.stores.map((item: any) => item.id));
        if (selection.userIds.some((id) => !validUsers.has(id)) || selection.productIds.some((id) => !validProducts.has(id)) || selection.storeIds.some((id) => !validStores.has(id))) {
            throw CustomError.badRequest("La selección contiene recursos que ya no están activos");
        }
        const owner = preview.users.find((item: any) => item.required)?.id;
        if (owner && !selection.userIds.includes(owner)) throw CustomError.badRequest("El propietario debe permanecer activo");
        const primaryStore = preview.stores.find((item: any) => item.required)?.id;
        if (primaryStore && preview.limits.stores > 0 && !selection.storeIds.includes(primaryStore)) throw CustomError.badRequest("La tienda principal debe permanecer activa");
        return selection;
    }

    static async listPublicMethods(now = new Date()) {
        return platformPrisma.manualPaymentMethod.findMany({
            where: {
                isActive: true,
                OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
                AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
            },
            select: {
                id: true,
                type: true,
                name: true,
                bankName: true,
                accountHolder: true,
                accountNumber: true,
                cci: true,
                currency: true,
                qrImageUrl: true,
                instructions: true,
                displayOrder: true,
            },
            orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        });
    }

    static async createRequest(input: Record<string, unknown>, userId?: number | null) {
        const tenantId = TenantDataContext.requireTenantId();
        const clientRequestId = String(input.clientRequestId || "").trim();
        if (!/^[A-Za-z0-9_-]{8,100}$/.test(clientRequestId)) {
            throw CustomError.badRequest("clientRequestId no es válido");
        }
        const existing = await tenantPrisma.manualPaymentRequest.findUnique({
            where: { tenantId_clientRequestId: { tenantId, clientRequestId } },
            include: { planVersion: { include: { plan: true } }, paymentMethod: true, assignment: true },
        });
        if (existing) return serializeRequest(existing);

        const planVersionId = String(input.planVersionId || "").trim();
        const paymentMethodId = String(input.paymentMethodId || "").trim();
        const [version, method] = await Promise.all([
            tenantPrisma.planVersion.findUnique({ where: { id: planVersionId }, include: { plan: true } }),
            tenantPrisma.manualPaymentMethod.findUnique({ where: { id: paymentMethodId } }),
        ]);
        if (!version || version.status !== "ACTIVE" || !version.plan.isAvailableForNewSubscriptions) {
            throw CustomError.badRequest("La versión solicitada no está disponible");
        }
        if (version.plan.code === TenantPlanCode.TRIAL) {
            throw CustomError.badRequest("El trial no se contrata mediante pago");
        }
        const downgradePreview = await this.downgradePreviewWith(tenantPrisma, tenantId, version.id);
        const downgradeSelection = this.validateDowngradeSelection(downgradePreview, input.downgradeSelection);
        const now = new Date();
        if (!method?.isActive
            || (method.effectiveFrom && method.effectiveFrom > now)
            || (method.effectiveUntil && method.effectiveUntil <= now)) {
            throw CustomError.badRequest("El medio de pago no está disponible");
        }
        const cycleRaw = String(input.billingCycle || BillingCycle.MONTHLY).toUpperCase();
        if (!Object.values(BillingCycle).includes(cycleRaw as BillingCycle)) {
            throw CustomError.badRequest("El ciclo de cobro no es válido");
        }
        const cycle = cycleRaw as BillingCycle;
        const offeredPrice = cycle === BillingCycle.ANNUAL ? version.annualPrice : version.monthlyPrice;
        if (!offeredPrice) throw CustomError.badRequest("El plan no tiene precio para ese ciclo");
        const amountReported = money(input.amountReported, "amountReported");
        const paidAt = input.paidAt ? new Date(String(input.paidAt)) : null;
        if (paidAt && (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 5 * 60 * 1000)) {
            throw CustomError.badRequest("La fecha del pago no es válida");
        }
        if (input.proofUrl) throw CustomError.badRequest("Las constancias por URL ya no se aceptan; adjunta un archivo privado");
        if (!input.proofFile) {
            throw CustomError.badRequest("Adjunta la constancia de pago");
        }
        const proof = protectPaymentProof(input.proofFile);

        const created = await tenantPrisma.manualPaymentRequest.create({
            data: {
                code: `PAY-${now.toISOString().slice(0, 7).replace("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
                clientRequestId,
                tenantId,
                planVersionId: version.id,
                paymentMethodId: method.id,
                status: ManualPaymentRequestStatus.PENDING_REVIEW,
                billingCycle: cycle,
                periodMonths: cycle === BillingCycle.ANNUAL ? 12 : 1,
                offeredPrice,
                currency: version.currency,
                amountReported,
                operationReference: cleanText(input.operationReference, 100),
                paidAt,
                proofUrl: null,
                applicantNote: cleanText(input.applicantNote, 500),
                ...(downgradeSelection ? { downgradeSelection: downgradeSelection as Prisma.InputJsonObject } : {}),
                requestedByUserId: userId ?? null,
                expiresAt: new Date(now.getTime() + 7 * DAY_MS),
                proof: { create: { tenantId, ...proof } },
            },
            include: { planVersion: { include: { plan: true } }, paymentMethod: true, assignment: true, proof: { select: { id: true } } },
        });
        return serializeRequest(created);
    }

    static async listTenantRequests() {
        const tenantId = TenantDataContext.requireTenantId();
        const requests = await tenantPrisma.manualPaymentRequest.findMany({
            where: { tenantId },
            include: { planVersion: { include: { plan: true } }, paymentMethod: true, assignment: true, proof: { select: { id: true } } },
            orderBy: { createdAt: "desc" },
        });
        return requests.map(serializeRequest);
    }
}
