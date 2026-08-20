import { randomUUID } from "node:crypto";
import {
    BillingCycle,
    ManualPaymentMethodType,
    ManualPaymentRequestStatus,
    Prisma,
    TenantPlanAssignmentSource,
    TenantPlanCode,
} from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";
import { tenantPrisma } from "../../data/tenant-prisma";
import { CustomError } from "../../domain/errors/custom.error";
import { TenantDataContext } from "../tenant/tenant-data-context";
import { PlanAssignmentService } from "./plan-assignment.service";
import { PlatformAuditService } from "./platform-audit.service";
import { openPaymentProof, protectPaymentProof } from "./payment-proof-crypto";

const DAY_MS = 24 * 60 * 60 * 1000;

type Actor = {
    platformAdminId: string;
    correlationId: string | null;
};

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

function addMonthsClamped(value: Date, months: number): Date {
    const year = value.getUTCFullYear();
    const month = value.getUTCMonth() + months;
    const day = value.getUTCDate();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(
        new Date(Date.UTC(year, month, 1)).getUTCFullYear(),
        new Date(Date.UTC(year, month, 1)).getUTCMonth(),
        Math.min(day, lastDay),
        value.getUTCHours(),
        value.getUTCMinutes(),
        value.getUTCSeconds(),
        value.getUTCMilliseconds(),
    ));
}

function serializeRequest(request: any) {
    const { proof: _proof, ...safeRequest } = request;
    return {
        ...safeRequest,
        proofUrl: undefined,
        hasProof: Boolean(request.proof),
        proofDownloadUrl: request.proof ? `/api/platform/payment-requests/${request.id}/proof` : null,
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

export class ManualPaymentService {
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

    private static async applyDowngradeSelection(tx: Prisma.TransactionClient, tenantId: string, planVersionId: string, raw: unknown) {
        const preview = await this.downgradePreviewWith(tx, tenantId, planVersionId);
        const selection = this.validateDowngradeSelection(preview, raw);
        if (!selection) return;
        const membershipIds = selection.userIds.filter((id) => id.startsWith("membership:")).map((id) => id.slice(11));
        const invitationIds = selection.userIds.filter((id) => id.startsWith("invitation:")).map((id) => id.slice(11));
        const storesToDisable = preview.stores.map((item: any) => item.id).filter((id: number) => !selection.storeIds.includes(id));
        if (storesToDisable.length > 0) {
            const operations = await tx.stockTransfer.count({
                where: { tenantId, status: { in: ["PENDING", "IN_TRANSIT"] }, OR: [{ fromStoreId: { in: storesToDisable } }, { toStoreId: { in: storesToDisable } }] },
            });
            if (operations > 0) throw CustomError.conflict("Hay transferencias en curso en una tienda que se desactivará; complétalas o cancélalas antes de aprobar");
        }
        await tx.tenantMembership.updateMany({ where: { tenantId, status: { in: ["ACTIVE", "INVITED"] }, id: { notIn: membershipIds }, role: { not: "OWNER" } }, data: { status: "INACTIVE", deactivatedAt: new Date() } });
        await tx.tenantInvitation.updateMany({ where: { tenantId, status: "PENDING", id: { notIn: invitationIds } }, data: { status: "REVOKED", revokedAt: new Date() } });
        await tx.product.updateMany({ where: { tenantId, isActive: true, id: { notIn: selection.productIds } }, data: { isActive: false } });
        await tx.store.updateMany({ where: { tenantId, isActive: true, id: { notIn: selection.storeIds } }, data: { isActive: false } });
        const activeProducts = await tx.product.findMany({ where: { tenantId, isActive: true }, select: { id: true } });
        for (const product of activeProducts) {
            const variants = await tx.productVariant.findMany({ where: { tenantId, productId: product.id, isActive: true }, select: { id: true }, orderBy: { createdAt: "asc" } });
            const excess = variants.slice(preview.limits.maxVariantsPerProduct);
            if (excess.length) await tx.productVariant.updateMany({ where: { tenantId, id: { in: excess.map((item: any) => item.id) } }, data: { isActive: false } });
        }
        await tx.tenantLifecycleEvent.create({ data: { tenantId, type: "DOWNGRADE_SELECTION_APPLIED", source: "manual-payment", metadata: selection } });
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

    static async listMethodsForPlatform() {
        return platformPrisma.manualPaymentMethod.findMany({
            orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
        });
    }

    private static methodData(input: Record<string, unknown>): Prisma.ManualPaymentMethodUncheckedCreateInput {
        const type = String(input.type || "").trim().toUpperCase();
        if (!Object.values(ManualPaymentMethodType).includes(type as ManualPaymentMethodType)) {
            throw CustomError.badRequest("El tipo de medio de pago no es válido");
        }
        const name = cleanText(input.name, 100);
        if (!name) throw CustomError.badRequest("El nombre es obligatorio");
        const currency = String(input.currency || "PEN").trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) throw CustomError.badRequest("La moneda no es válida");
        const qrImageUrl = cleanText(input.qrImageUrl, 1000);
        if (qrImageUrl && !/^https:\/\//i.test(qrImageUrl)) {
            throw CustomError.badRequest("La imagen QR debe usar HTTPS");
        }
        const bankName = cleanText(input.bankName, 100);
        const accountHolder = cleanText(input.accountHolder, 160);
        const accountNumber = cleanText(input.accountNumber, 80);
        const cci = cleanText(input.cci, 80);
        if (type === ManualPaymentMethodType.BANK_TRANSFER && (!bankName || !accountHolder || (!accountNumber && !cci))) {
            throw CustomError.badRequest("La transferencia requiere banco, titular y cuenta o CCI");
        }
        if (type === ManualPaymentMethodType.QR && !qrImageUrl) {
            throw CustomError.badRequest("El pago QR requiere una imagen HTTPS");
        }
        return {
            type: type as ManualPaymentMethodType,
            name,
            bankName,
            accountHolder,
            accountNumber,
            cci,
            currency,
            qrImageUrl,
            instructions: cleanText(input.instructions, 1000),
            displayOrder: Number.isInteger(Number(input.displayOrder)) ? Number(input.displayOrder) : 0,
            isActive: typeof input.isActive === "boolean" ? input.isActive : true,
            effectiveFrom: input.effectiveFrom ? new Date(String(input.effectiveFrom)) : null,
            effectiveUntil: input.effectiveUntil ? new Date(String(input.effectiveUntil)) : null,
        };
    }

    static async createMethod(input: Record<string, unknown>, actor: Actor) {
        const data = this.methodData(input);
        const created = await platformPrisma.manualPaymentMethod.create({
            data: { ...data, createdByPlatformAdminId: actor.platformAdminId },
        });
        await PlatformAuditService.record({
            actorPlatformAdminId: actor.platformAdminId,
            action: "MANUAL_PAYMENT_METHOD_CREATED",
            entityType: "ManualPaymentMethod",
            entityId: created.id,
            correlationId: actor.correlationId,
            after: created,
        });
        return created;
    }

    static async updateMethod(id: string, input: Record<string, unknown>, actor: Actor) {
        const before = await platformPrisma.manualPaymentMethod.findUnique({ where: { id } });
        if (!before) throw CustomError.notFound("El medio de pago no existe");
        const data = this.methodData({ ...before, ...input });
        const after = await platformPrisma.manualPaymentMethod.update({ where: { id }, data });
        await PlatformAuditService.record({
            actorPlatformAdminId: actor.platformAdminId,
            action: "MANUAL_PAYMENT_METHOD_UPDATED",
            entityType: "ManualPaymentMethod",
            entityId: id,
            correlationId: actor.correlationId,
            before,
            after,
        });
        return after;
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

    static async listPlatformRequests(status?: string) {
        const normalized = status?.trim().toUpperCase();
        if (normalized && !Object.values(ManualPaymentRequestStatus).includes(normalized as ManualPaymentRequestStatus)) {
            throw CustomError.badRequest("El estado no es válido");
        }
        const requests = await platformPrisma.manualPaymentRequest.findMany({
            ...(normalized ? { where: { status: normalized as ManualPaymentRequestStatus } } : {}),
            include: {
                tenant: { select: { id: true, name: true, slug: true, planCode: true } },
                planVersion: { include: { plan: true } },
                paymentMethod: true,
                assignment: true,
                proof: { select: { id: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 200,
        });
        return requests.map(serializeRequest);
    }

    static async openProof(id: string, actor: Actor) {
        const proof = await platformPrisma.manualPaymentProof.findUnique({
            where: { paymentRequestId: id },
            include: { paymentRequest: { select: { code: true, tenantId: true } } },
        });
        if (!proof) throw CustomError.notFound("La solicitud no tiene una constancia privada");
        const buffer = openPaymentProof(proof);
        await PlatformAuditService.record({
            actorPlatformAdminId: actor.platformAdminId,
            action: "MANUAL_PAYMENT_PROOF_VIEWED",
            entityType: "ManualPaymentRequest",
            entityId: id,
            reason: "Revisión de constancia privada",
            correlationId: actor.correlationId,
            after: { code: proof.paymentRequest.code, tenantId: proof.paymentRequest.tenantId, sha256: proof.sha256 },
        });
        return { buffer, filename: proof.filename, contentType: proof.contentType, sizeBytes: proof.sizeBytes };
    }

    static async approveRequest(
        id: string,
        input: { verifiedAmount?: unknown; operationReference?: unknown; internalNote?: unknown },
        actor: Actor,
    ) {
        return platformPrisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`
                SELECT pg_advisory_xact_lock(hashtextextended(${`manual-payment:${id}`}, 0))
            `);
            const request = await tx.manualPaymentRequest.findUnique({
                where: { id },
                include: {
                    tenant: { include: { subscription: true } },
                    planVersion: { include: { plan: true } },
                    proof: { select: { id: true } },
                },
            });
            if (!request) throw CustomError.notFound("La solicitud no existe");
            if (request.status === ManualPaymentRequestStatus.APPROVED) return serializeRequest(request);
            if (request.status !== ManualPaymentRequestStatus.PENDING_REVIEW) {
                throw CustomError.conflict("La solicitud ya fue resuelta");
            }
            if (request.expiresAt <= new Date()) throw CustomError.conflict("La solicitud venció");
            if (!request.proof) throw CustomError.conflict("La solicitud no tiene constancia de pago adjunta");
            const verifiedAmount = money(input.verifiedAmount, "verifiedAmount");
            if (!verifiedAmount || !verifiedAmount.equals(request.offeredPrice)) {
                throw CustomError.badRequest("El monto verificado debe coincidir con el precio ofrecido");
            }
            const operationReference = cleanText(input.operationReference, 100)
                || request.operationReference;
            if (!operationReference) throw CustomError.badRequest("La referencia bancaria es obligatoria");
            const duplicate = await tx.manualPaymentRequest.findFirst({
                where: {
                    id: { not: request.id },
                    status: ManualPaymentRequestStatus.APPROVED,
                    operationReference: { equals: operationReference, mode: "insensitive" },
                },
                select: { id: true, code: true },
            });
            if (duplicate) throw CustomError.conflict(`La referencia ya fue aprobada en ${duplicate.code}`);

            const now = new Date();
            const preview = await this.downgradePreviewWith(tx, request.tenantId, request.planVersionId);
            const paidUntil = request.tenant.subscription?.currentPeriodEndsAt;
            const scheduleDowngrade = preview.isDowngrade && Boolean(paidUntil && paidUntil > now);
            const effectiveAt = scheduleDowngrade ? paidUntil! : (
                paidUntil && paidUntil > now && request.tenant.planCode === request.planVersion.plan.code ? paidUntil : now
            );
            const periodEndsAt = addMonthsClamped(effectiveAt, request.periodMonths);
            if (!scheduleDowngrade) {
                await this.applyDowngradeSelection(tx, request.tenantId, request.planVersionId, request.downgradeSelection);
            }
            const assignmentOptions = {
                source: TenantPlanAssignmentSource.MANUAL_PAYMENT,
                actorPlatformAdminId: actor.platformAdminId,
                startsAt: effectiveAt,
                endsAt: periodEndsAt,
                currentPeriodEndsAt: periodEndsAt,
                price: request.offeredPrice,
                reason: `Pago manual aprobado: ${request.code}`,
            };
            const assignment = scheduleDowngrade
                ? await PlanAssignmentService.schedule(tx, request.tenantId, request.planVersionId, assignmentOptions)
                : await PlanAssignmentService.apply(tx, request.tenantId, request.planVersionId, assignmentOptions);
            const updated = await tx.manualPaymentRequest.update({
                where: { id: request.id },
                data: {
                    status: ManualPaymentRequestStatus.APPROVED,
                    assignmentId: assignment.id,
                    amountReported: verifiedAmount,
                    operationReference,
                    internalNote: cleanText(input.internalNote, 1000),
                    reviewedByPlatformAdminId: actor.platformAdminId,
                    reviewedAt: new Date(),
                },
                include: {
                    tenant: { select: { id: true, name: true, slug: true, planCode: true } },
                    planVersion: { include: { plan: true } },
                    paymentMethod: true,
                    assignment: true,
                },
            });
            await PlatformAuditService.record({
                actorPlatformAdminId: actor.platformAdminId,
                action: "MANUAL_PAYMENT_APPROVED",
                entityType: "ManualPaymentRequest",
                entityId: request.id,
                reason: cleanText(input.internalNote, 1000),
                correlationId: actor.correlationId,
                before: serializeRequest(request),
                after: serializeRequest(updated),
            }, tx);
            return serializeRequest(updated);
        });
    }

    static async activateDueDowngrades(now = new Date()) {
        const due = await platformPrisma.tenantPlanAssignment.findMany({
            where: { status: "SCHEDULED", source: TenantPlanAssignmentSource.MANUAL_PAYMENT, startsAt: { lte: now } },
            include: { manualPaymentRequest: true },
            orderBy: { startsAt: "asc" },
            take: 100,
        });
        let activated = 0;
        for (const scheduled of due) {
            await platformPrisma.$transaction(async (tx) => {
                await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`scheduled-downgrade:${scheduled.tenantId}`}, 0))`);
                const current = await tx.tenantPlanAssignment.findFirst({ where: { id: scheduled.id, status: "SCHEDULED", startsAt: { lte: now } } });
                if (!current) return;
                await this.applyDowngradeSelection(tx, current.tenantId, current.planVersionId, scheduled.manualPaymentRequest?.downgradeSelection);
                await PlanAssignmentService.apply(tx, current.tenantId, current.planVersionId, {
                    source: current.source,
                    actorPlatformAdminId: current.createdByPlatformAdminId,
                    startsAt: current.startsAt,
                    endsAt: current.endsAt,
                    currentPeriodEndsAt: current.endsAt,
                    price: current.price,
                    reason: current.reason || "Downgrade programado aplicado",
                    existingAssignmentId: current.id,
                });
                activated += 1;
            });
        }
        return { activated };
    }

    static async rejectRequest(id: string, reasonValue: unknown, actor: Actor) {
        const reason = cleanText(reasonValue, 500);
        if (!reason || reason.length < 5) throw CustomError.badRequest("Indica el motivo del rechazo");
        return platformPrisma.$transaction(async (tx) => {
            const before = await tx.manualPaymentRequest.findUnique({ where: { id } });
            if (!before) throw CustomError.notFound("La solicitud no existe");
            if (before.status !== ManualPaymentRequestStatus.PENDING_REVIEW) {
                throw CustomError.conflict("La solicitud ya fue resuelta");
            }
            const after = await tx.manualPaymentRequest.update({
                where: { id },
                data: {
                    status: ManualPaymentRequestStatus.REJECTED,
                    rejectionReason: reason,
                    reviewedByPlatformAdminId: actor.platformAdminId,
                    reviewedAt: new Date(),
                },
            });
            await PlatformAuditService.record({
                actorPlatformAdminId: actor.platformAdminId,
                action: "MANUAL_PAYMENT_REJECTED",
                entityType: "ManualPaymentRequest",
                entityId: id,
                reason,
                correlationId: actor.correlationId,
                before: serializeRequest(before),
                after: serializeRequest(after),
            }, tx);
            return serializeRequest(after);
        });
    }

    static async expirePending(now = new Date()) {
        const result = await platformPrisma.manualPaymentRequest.updateMany({
            where: { status: ManualPaymentRequestStatus.PENDING_REVIEW, expiresAt: { lte: now } },
            data: { status: ManualPaymentRequestStatus.EXPIRED },
        });
        return { expired: result.count };
    }
}
