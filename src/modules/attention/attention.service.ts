import { Prisma } from "@prisma/client";
import { CustomError } from "../../domain/errors/custom.error";
import { prisma as tenantPrisma } from "../../data/prisma";
import { TenantDataContext } from "../tenant/tenant-data-context";
import { AttentionMessagingProvider, createAttentionMessagingProvider } from "./messaging-provider";
import { WhatsAppConnectionService } from "./whatsapp-connection.service";

const STATUSES = new Set(["PENDING", "ATTENDING", "RESOLVED", "REOPENED"]);
const conversationInclude = {
    customer: { select: { id: true, name: true, phone: true, email: true } },
    order: { select: { id: true, code: true, status: true, total: true } },
    assignedUser: { select: { id: true, firstName: true, lastName: true } },
    messages: { orderBy: { sentAt: "desc" as const }, take: 1 },
};

function text(value: unknown, field: string, min = 1, max = 4000): string {
    const normalized = String(value ?? "").trim();
    if (normalized.length < min) throw CustomError.badRequest(`${field} es obligatorio`);
    if (normalized.length > max) throw CustomError.badRequest(`${field} supera ${max} caracteres`);
    return normalized;
}

function optionalId(value: unknown, field: string): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) throw CustomError.badRequest(`${field} inválido`);
    return parsed;
}

function phone(value: unknown): string {
    const digits = String(value ?? "").replace(/\D/g, "");
    const normalized = digits.length === 9 ? `51${digits}` : digits;
    if (normalized.length < 10 || normalized.length > 15) throw CustomError.badRequest("Número de WhatsApp inválido");
    return normalized;
}

export class AttentionService {
    constructor(private readonly explicitProvider?: AttentionMessagingProvider) {}

    private async provider(): Promise<AttentionMessagingProvider> {
        return this.explicitProvider ?? createAttentionMessagingProvider();
    }

    async list(input: { status?: unknown; search?: unknown; assignedTo?: unknown }) {
        const status = String(input.status ?? "").trim().toUpperCase();
        if (status && status !== "ALL" && !STATUSES.has(status)) throw CustomError.badRequest("Estado de atención inválido");
        const search = String(input.search ?? "").trim().slice(0, 160);
        const assignedTo = optionalId(input.assignedTo, "Responsable");
        const where: Prisma.AttentionConversationWhereInput = {
            ...(status && status !== "ALL" ? { status } : {}),
            ...(assignedTo !== undefined ? { assignedUserId: assignedTo } : {}),
            ...(search ? { OR: [
                { contactName: { contains: search, mode: "insensitive" } },
                { contactPhone: { contains: search } },
                { customer: { is: { name: { contains: search, mode: "insensitive" } } } },
                { order: { is: { code: { contains: search, mode: "insensitive" } } } },
            ] } : {}),
        };
        const [items, counts] = await Promise.all([
            tenantPrisma.attentionConversation.findMany({ where, include: conversationInclude, orderBy: { lastMessageAt: "desc" }, take: 200 }),
            tenantPrisma.attentionConversation.groupBy({ by: ["status"], _count: { _all: true } }),
        ]);
        const provider = await this.provider();
        return {
            provider: { code: provider.code, simulated: provider.simulated },
            items,
            counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
        };
    }

    async get(id: string) {
        const conversation = await tenantPrisma.attentionConversation.findFirst({
            where: { id },
            include: {
                ...conversationInclude,
                messages: {
                    orderBy: { sentAt: "asc" },
                    include: { sentByUser: { select: { id: true, firstName: true, lastName: true } } },
                },
                orderCases: {
                    orderBy: { createdAt: "desc" },
                    include: {
                        order: { select: { id: true, code: true, status: true } },
                        followUps: { orderBy: { createdAt: "asc" } },
                    },
                },
            },
        });
        if (!conversation) throw CustomError.notFound("La conversación no existe");
        return conversation;
    }

    async create(input: Record<string, unknown>, actorUserId: number) {
        const tenantId = TenantDataContext.requireTenantId();
        const contactPhone = phone(input.contactPhone);
        const contactName = String(input.contactName ?? "").trim().slice(0, 160) || null;
        const customerId = optionalId(input.customerId, "Cliente") ?? null;
        const orderId = optionalId(input.orderId, "Pedido") ?? null;
        const initialMessage = String(input.initialMessage ?? "").trim().slice(0, 4000);
        return tenantPrisma.$transaction(async (tx) => {
            if (orderId && !await tx.order.findFirst({ where: { id: orderId }, select: { id: true } })) {
                throw CustomError.notFound("Pedido no encontrado");
            }
            const conversation = await tx.attentionConversation.create({
                data: {
                    tenantId,
                    contactPhone,
                    contactName,
                    customerId,
                    orderId,
                    assignedUserId: actorUserId,
                    status: "ATTENDING",
                    unreadCount: initialMessage ? 1 : 0,
                },
            });
            if (orderId) await tx.attentionOrderCase.create({ data: {
                tenantId, conversationId: conversation.id, orderId,
            } });
            if (initialMessage) await tx.attentionMessage.create({ data: {
                tenantId,
                conversationId: conversation.id,
                direction: "INBOUND",
                body: initialMessage,
                deliveryStatus: "RECEIVED_LOCAL",
                metadata: { simulated: true },
            } });
            return tx.attentionConversation.findFirstOrThrow({ where: { id: conversation.id }, include: conversationInclude });
        });
    }

    async send(id: string, bodyValue: unknown, actorUserId: number) {
        const body = text(bodyValue, "Mensaje");
        const conversation = await tenantPrisma.attentionConversation.findFirst({ where: { id } });
        if (!conversation) throw CustomError.notFound("La conversación no existe");
        const provider = await this.provider();
        if (provider.code === "META") {
            const lastInbound = await tenantPrisma.attentionMessage.findFirst({
                where: { conversationId: id, direction: "INBOUND", deliveryStatus: "RECEIVED" },
                orderBy: { sentAt: "desc" }, select: { sentAt: true },
            });
            if (!lastInbound || lastInbound.sentAt.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
                throw CustomError.conflict("La ventana de atención de 24 horas está cerrada; usa una plantilla aprobada por Meta");
            }
        }
        let result;
        try {
            result = await provider.sendText({ to: conversation.contactPhone, body });
        } catch (caught) {
            if (provider.code === "META") {
                await new WhatsAppConnectionService().recordSendFailure(
                    caught instanceof Error && "providerCode" in caught ? String(caught.providerCode) : "SEND_FAILED",
                    "Meta rechazó el envío. Revisa la conexión y el detalle del error.",
                ).catch(() => undefined);
            }
            throw caught;
        }
        const tenantId = TenantDataContext.requireTenantId();
        return tenantPrisma.$transaction(async (tx) => {
            const message = await tx.attentionMessage.create({ data: {
                tenantId,
                conversationId: id,
                direction: "OUTBOUND",
                body,
                sentByUserId: actorUserId,
                providerMessageId: result.providerMessageId,
                deliveryStatus: result.deliveryStatus,
                metadata: { provider: provider.code, simulated: provider.simulated },
            } });
            await tx.attentionConversation.update({ where: { id }, data: {
                provider: provider.code,
                assignedUserId: conversation.assignedUserId ?? actorUserId,
                status: "ATTENDING",
                resolvedAt: null,
                unreadCount: 0,
                lastMessageAt: message.sentAt,
            } });
            return message;
        });
    }

    async receiveLocal(id: string, bodyValue: unknown) {
        const body = text(bodyValue, "Mensaje");
        const tenantId = TenantDataContext.requireTenantId();
        return tenantPrisma.$transaction(async (tx) => {
            const conversation = await tx.attentionConversation.findFirst({ where: { id } });
            if (!conversation) throw CustomError.notFound("La conversación no existe");
            const message = await tx.attentionMessage.create({ data: {
                tenantId, conversationId: id, direction: "INBOUND", body,
                deliveryStatus: "RECEIVED_LOCAL", metadata: { simulated: true },
            } });
            await tx.attentionConversation.update({ where: { id }, data: {
                status: conversation.status === "RESOLVED" ? "REOPENED" : conversation.status,
                resolvedAt: null,
                unreadCount: { increment: 1 },
                lastMessageAt: message.sentAt,
            } });
            return message;
        });
    }

    async receiveExternal(input: { phone: unknown; name?: unknown; body: unknown; providerMessageId: unknown; type?: unknown }) {
        const tenantId = TenantDataContext.requireTenantId();
        const contactPhone = phone(input.phone);
        const body = text(input.body, "Mensaje");
        const providerMessageId = text(input.providerMessageId, "Identificador del proveedor", 1, 180);
        const contactName = String(input.name ?? "").trim().slice(0, 160) || null;
        const type = String(input.type ?? "TEXT").trim().toUpperCase().slice(0, 30) || "TEXT";
        return tenantPrisma.$transaction(async (tx) => {
            const duplicate = await tx.attentionMessage.findUnique({
                where: { tenantId_providerMessageId: { tenantId, providerMessageId } },
            });
            if (duplicate) return { message: duplicate, duplicated: true };
            let conversation = await tx.attentionConversation.findFirst({
                where: { contactPhone },
                orderBy: { lastMessageAt: "desc" },
            });
            if (!conversation) conversation = await tx.attentionConversation.create({ data: {
                tenantId, channel: "WHATSAPP", provider: "META", contactPhone, contactName, status: "PENDING",
            } });
            const message = await tx.attentionMessage.create({ data: {
                tenantId, conversationId: conversation.id, direction: "INBOUND", type, body,
                providerMessageId, deliveryStatus: "RECEIVED", metadata: { provider: "META" },
            } });
            await tx.attentionConversation.update({ where: { id: conversation.id }, data: {
                provider: "META",
                contactName: conversation.contactName || contactName,
                status: conversation.status === "RESOLVED" ? "REOPENED" : conversation.status,
                resolvedAt: null,
                unreadCount: { increment: 1 },
                lastMessageAt: message.sentAt,
            } });
            return { message, duplicated: false };
        });
    }

    async updateProviderStatus(providerMessageIdValue: unknown, statusValue: unknown,
        errorCodeValue?: unknown, errorMessageValue?: unknown) {
        const providerMessageId = text(providerMessageIdValue, "Identificador del proveedor", 1, 180);
        const deliveryStatus = text(statusValue, "Estado del proveedor", 1, 30).toUpperCase();
        const errorCode = String(errorCodeValue ?? "").trim().slice(0, 80);
        const errorMessage = String(errorMessageValue ?? "").trim().slice(0, 500);
        const message = await tenantPrisma.attentionMessage.findFirst({
            where: { providerMessageId }, select: { conversationId: true },
        });
        if (!message) return { count: 0, conversationId: null };
        const result = await tenantPrisma.attentionMessage.updateMany({
            where: { providerMessageId }, data: {
                deliveryStatus,
                ...(errorCode || errorMessage ? { metadata: { provider: "META", errorCode, errorMessage } } : {}),
            },
        });
        return { count: result.count, conversationId: message.conversationId };
    }

    async metrics() {
        const conversations = await tenantPrisma.attentionConversation.findMany({
            select: {
                status: true, unreadCount: true, assignedUserId: true, resolvedAt: true,
                messages: { select: { direction: true, sentAt: true }, orderBy: { sentAt: "asc" } },
            },
            take: 1000,
        });
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const responseMinutes: number[] = [];
        for (const conversation of conversations) {
            const firstInbound = conversation.messages.find((message) => message.direction === "INBOUND");
            const firstOutbound = firstInbound
                ? conversation.messages.find((message) => message.direction === "OUTBOUND" && message.sentAt >= firstInbound.sentAt)
                : undefined;
            if (firstInbound && firstOutbound) responseMinutes.push((firstOutbound.sentAt.getTime() - firstInbound.sentAt.getTime()) / 60_000);
        }
        return {
            total: conversations.length,
            active: conversations.filter((row) => row.status !== "RESOLVED").length,
            unread: conversations.reduce((sum, row) => sum + row.unreadCount, 0),
            unassigned: conversations.filter((row) => row.status !== "RESOLVED" && !row.assignedUserId).length,
            resolvedToday: conversations.filter((row) => row.resolvedAt && row.resolvedAt >= today).length,
            averageFirstResponseMinutes: responseMinutes.length
                ? Math.round(responseMinutes.reduce((sum, value) => sum + value, 0) / responseMinutes.length)
                : null,
        };
    }

    async listTemplates(includeInactive = false) {
        return tenantPrisma.attentionTemplate.findMany({
            where: includeInactive ? {} : { isActive: true },
            orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
        });
    }

    async createTemplate(input: Record<string, unknown>, actorUserId: number) {
        const tenantId = TenantDataContext.requireTenantId();
        return tenantPrisma.attentionTemplate.create({ data: {
            tenantId,
            title: text(input.title, "Nombre de plantilla", 2, 120),
            body: text(input.body, "Contenido de plantilla"),
            displayOrder: Math.max(0, Number(input.displayOrder) || 0),
            createdByUserId: actorUserId,
        } });
    }

    async updateTemplate(id: string, input: Record<string, unknown>) {
        const existing = await tenantPrisma.attentionTemplate.findFirst({ where: { id } });
        if (!existing) throw CustomError.notFound("La plantilla no existe");
        return tenantPrisma.attentionTemplate.update({ where: { id }, data: {
            ...(input.title !== undefined ? { title: text(input.title, "Nombre de plantilla", 2, 120) } : {}),
            ...(input.body !== undefined ? { body: text(input.body, "Contenido de plantilla") } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive === true } : {}),
            ...(input.displayOrder !== undefined ? { displayOrder: Math.max(0, Number(input.displayOrder) || 0) } : {}),
        } });
    }

    async update(id: string, input: Record<string, unknown>) {
        const statusValue = input.status === undefined ? undefined : String(input.status).trim().toUpperCase();
        if (statusValue && !STATUSES.has(statusValue)) throw CustomError.badRequest("Estado de atención inválido");
        const assignedUserId = optionalId(input.assignedUserId, "Responsable");
        const customerId = optionalId(input.customerId, "Cliente");
        const orderId = optionalId(input.orderId, "Pedido");
        const existing = await tenantPrisma.attentionConversation.findFirst({ where: { id } });
        if (!existing) throw CustomError.notFound("La conversación no existe");
        if (assignedUserId) {
            const tenantId = TenantDataContext.requireTenantId();
            const membership = await tenantPrisma.tenantMembership.findFirst({
                where: { tenantId, userId: assignedUserId, status: "ACTIVE" },
                select: { id: true },
            });
            if (!membership) throw CustomError.badRequest("El responsable no pertenece a esta empresa");
        }
        if (orderId && !await tenantPrisma.order.findFirst({ where: { id: orderId }, select: { id: true } })) {
            throw CustomError.notFound("Pedido no encontrado");
        }
        const updated = await tenantPrisma.attentionConversation.update({ where: { id }, data: {
            ...(statusValue ? { status: statusValue, resolvedAt: statusValue === "RESOLVED" ? new Date() : null } : {}),
            ...(assignedUserId !== undefined ? { assignedUserId } : {}),
            ...(customerId !== undefined ? { customerId } : {}),
            ...(orderId !== undefined ? { orderId } : {}),
            ...(input.markRead === true ? { unreadCount: 0 } : {}),
        }, include: conversationInclude });
        if (orderId) await this.linkOrder(id, orderId);
        return updated;
    }

    async linkOrder(conversationId: string, orderIdValue: unknown) {
        const tenantId = TenantDataContext.requireTenantId();
        const orderId = optionalId(orderIdValue, "Pedido");
        if (!orderId) throw CustomError.badRequest("Pedido obligatorio");
        const [conversation, order] = await Promise.all([
            tenantPrisma.attentionConversation.findFirst({ where: { id: conversationId }, select: { id: true } }),
            tenantPrisma.order.findFirst({ where: { id: orderId }, select: { id: true } }),
        ]);
        if (!conversation || !order) throw CustomError.notFound("Conversación o pedido no encontrado");
        return tenantPrisma.attentionOrderCase.upsert({
            where: { tenantId_conversationId_orderId: { tenantId, conversationId, orderId } },
            create: { tenantId, conversationId, orderId }, update: {},
            include: { order: { select: { id: true, code: true, status: true } }, followUps: true },
        });
    }

    async updateCaseSummary(caseId: string, summaryValue: unknown) {
        const summary = String(summaryValue ?? "").trim();
        if (summary.length > 2000) throw CustomError.badRequest("Resumen demasiado largo");
        const orderCase = await tenantPrisma.attentionOrderCase.findFirst({ where: { id: caseId } });
        if (!orderCase) throw CustomError.notFound("Seguimiento de pedido no encontrado");
        return tenantPrisma.attentionOrderCase.update({ where: { id: caseId }, data: { summary: summary || null } });
    }

    async createFollowUp(caseId: string, bodyValue: unknown, actorUserId: number) {
        const body = text(bodyValue, "Nota", 1, 2000);
        const orderCase = await tenantPrisma.attentionOrderCase.findFirst({ where: { id: caseId } });
        if (!orderCase) throw CustomError.notFound("Seguimiento de pedido no encontrado");
        return tenantPrisma.attentionFollowUp.create({ data: {
            tenantId: TenantDataContext.requireTenantId(), caseId, body, createdByUserId: actorUserId,
        } });
    }

    async updateFollowUp(id: string, statusValue: unknown, actorUserId: number) {
        const status = String(statusValue ?? "").trim().toUpperCase();
        if (!["PENDING", "IN_PROGRESS", "COMPLETED"].includes(status)) throw CustomError.badRequest("Estado de nota inválido");
        const current = await tenantPrisma.attentionFollowUp.findFirst({ where: { id } });
        if (!current) throw CustomError.notFound("Nota no encontrada");
        return tenantPrisma.attentionFollowUp.update({ where: { id }, data: {
            status,
            completedAt: status === "COMPLETED" ? new Date() : null,
            completedByUserId: status === "COMPLETED" ? actorUserId : null,
        } });
    }

    async listOrderCases(orderIdValue: unknown) {
        const orderId = optionalId(orderIdValue, "Pedido");
        if (!orderId) throw CustomError.badRequest("Pedido obligatorio");
        return tenantPrisma.attentionOrderCase.findMany({
            where: { orderId }, include: {
                conversation: { select: { id: true, contactName: true, contactPhone: true } },
                followUps: { orderBy: { createdAt: "asc" } },
            }, orderBy: { updatedAt: "desc" },
        });
    }
}
