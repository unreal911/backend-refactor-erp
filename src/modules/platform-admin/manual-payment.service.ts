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

const DAY_MS = 24 * 60 * 60 * 1000;

type Actor = {
    platformAdminId: string;
    correlationId: string | null;
};

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
    return {
        ...request,
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
        const proofUrl = cleanText(input.proofUrl, 1000);
        if (proofUrl && !/^https:\/\//i.test(proofUrl)) throw CustomError.badRequest("proofUrl debe usar HTTPS");

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
                proofUrl,
                applicantNote: cleanText(input.applicantNote, 500),
                requestedByUserId: userId ?? null,
                expiresAt: new Date(now.getTime() + 7 * DAY_MS),
            },
            include: { planVersion: { include: { plan: true } }, paymentMethod: true, assignment: true },
        });
        return serializeRequest(created);
    }

    static async listTenantRequests() {
        const tenantId = TenantDataContext.requireTenantId();
        const requests = await tenantPrisma.manualPaymentRequest.findMany({
            where: { tenantId },
            include: { planVersion: { include: { plan: true } }, paymentMethod: true, assignment: true },
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
            },
            orderBy: { createdAt: "desc" },
            take: 200,
        });
        return requests.map(serializeRequest);
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
                },
            });
            if (!request) throw CustomError.notFound("La solicitud no existe");
            if (request.status === ManualPaymentRequestStatus.APPROVED) return serializeRequest(request);
            if (request.status !== ManualPaymentRequestStatus.PENDING_REVIEW) {
                throw CustomError.conflict("La solicitud ya fue resuelta");
            }
            if (request.expiresAt <= new Date()) throw CustomError.conflict("La solicitud venció");
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

            const baseDate = request.tenant.subscription?.currentPeriodEndsAt
                && request.tenant.subscription.currentPeriodEndsAt > new Date()
                && request.tenant.planCode === request.planVersion.plan.code
                ? request.tenant.subscription.currentPeriodEndsAt
                : new Date();
            const periodEndsAt = addMonthsClamped(baseDate, request.periodMonths);
            const assignment = await PlanAssignmentService.apply(tx, request.tenantId, request.planVersionId, {
                source: TenantPlanAssignmentSource.MANUAL_PAYMENT,
                actorPlatformAdminId: actor.platformAdminId,
                startsAt: new Date(),
                endsAt: periodEndsAt,
                currentPeriodEndsAt: periodEndsAt,
                price: request.offeredPrice,
                reason: `Pago manual aprobado: ${request.code}`,
            });
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
