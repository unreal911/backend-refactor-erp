import {
    OperationalTaskPriority,
    OperationalTaskStatus,
    OperationalTaskType,
    Prisma,
    StoreAssignmentType,
    TenantMembershipStatus,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { CustomError } from "../../domain/errors/custom.error";
import { tenantPrisma } from "../../data/tenant-prisma";
import { TenantDataContext } from "../tenant/tenant-data-context";
import { upsertSharedPickingResponsibility } from "../../presentation/services/order-picking.queries";

export class StoreAssignmentRequiredError extends CustomError {
    readonly code = "USER_OUTSIDE_STORE";

    constructor(public readonly details: {
        userId: number;
        storeId: number;
        storeName: string;
    }) {
        super(
            `El usuario no pertenece actualmente a ${details.storeName}. ¿Deseas continuar de forma excepcional?`,
            409,
        );
    }
}

export type TaskActor = {
    userId: number;
    permissions: string[];
};

export type TaskListFilters = {
    assignedUserId?: number;
    storeId?: number;
    status?: OperationalTaskStatus;
    type?: OperationalTaskType;
    page?: number;
    pageSize?: number;
};

const taskInclude = {
    store: { select: { id: true, name: true, code: true, type: true } },
    assignedUser: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
    assignedByUser: { select: { id: true, firstName: true, lastName: true } },
    order: {
        select: {
            id: true,
            code: true,
            status: true,
            salesChannel: true,
            clientName: true,
            sourceStoreId: true,
            dispenserUserId: true,
            items: {
                where: { removedAt: null },
                select: {
                    id: true,
                    quantity: true,
                    reserved: true,
                    picked: true,
                    shortageQuantity: true,
                    status: true,
                    fulfillmentStoreId: true,
                    variant: {
                        select: {
                            id: true,
                            sku: true,
                            variantKey: true,
                            product: { select: { id: true, name: true } },
                            color: { select: { name: true } },
                            size: { select: { name: true } },
                        },
                    },
                },
            },
        },
    },
    transfer: {
        select: {
            id: true,
            code: true,
            status: true,
            note: true,
            fromStore: { select: { id: true, name: true, code: true } },
            toStore: { select: { id: true, name: true, code: true } },
            items: {
                select: {
                    id: true,
                    quantity: true,
                    variant: {
                        select: {
                            id: true,
                            sku: true,
                            variantKey: true,
                            product: { select: { id: true, name: true } },
                            color: { select: { name: true } },
                            size: { select: { name: true } },
                        },
                    },
                },
            },
        },
    },
    pickingSession: {
        select: { id: true, status: true, orderId: true, assignedUserId: true },
    },
} satisfies Prisma.OperationalTaskInclude;

function hasPermission(actor: TaskActor, permission: string): boolean {
    return actor.permissions.includes("*") || actor.permissions.includes(permission);
}

function positiveInteger(value: unknown, field: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw CustomError.badRequest(`${field} inválido`);
    }
    return parsed;
}

function normalizedReason(value: unknown, required = false): string | null {
    const reason = String(value ?? "").trim();
    if (required && reason.length < 5) {
        throw CustomError.badRequest("Indica una razón de al menos 5 caracteres");
    }
    return reason || null;
}

export class OperationalTaskService {
    static readonly activeStatuses: OperationalTaskStatus[] = [
        OperationalTaskStatus.PENDING_ACCEPTANCE,
        OperationalTaskStatus.ACCEPTED,
        OperationalTaskStatus.IN_PROGRESS,
        OperationalTaskStatus.WAITING_CONFIRMATION,
        OperationalTaskStatus.OVERDUE,
    ];

    static createCode(): string {
        return `TAR-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    }

    static async list(actor: TaskActor, filters: TaskListFilters = {}) {
        const page = Math.max(1, Number(filters.page) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 25));
        const canViewAll = hasPermission(actor, "tasks.view.all");
        const assignedUserId = canViewAll
            ? filters.assignedUserId
            : actor.userId;
        const where: Prisma.OperationalTaskWhereInput = {
            ...(assignedUserId ? { assignedUserId } : {}),
            ...(filters.storeId ? { storeId: filters.storeId } : {}),
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.type ? { type: filters.type } : {}),
        };
        const [items, total] = await Promise.all([
            tenantPrisma.operationalTask.findMany({
                where,
                include: taskInclude,
                orderBy: [
                    { priority: "desc" },
                    { dueAt: { sort: "asc", nulls: "last" } },
                    { createdAt: "asc" },
                ],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            tenantPrisma.operationalTask.count({ where }),
        ]);
        return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
    }

    static async getById(id: string, actor: TaskActor) {
        const task = await tenantPrisma.operationalTask.findFirst({
            where: { id },
            include: {
                ...taskInclude,
                events: {
                    include: { actorUser: { select: { id: true, firstName: true, lastName: true } } },
                    orderBy: { createdAt: "asc" },
                },
            },
        });
        if (!task) throw CustomError.notFound("Tarea no encontrada");
        if (task.assignedUserId !== actor.userId && !hasPermission(actor, "tasks.view.all")) {
            throw CustomError.forbidden("No puedes consultar una tarea asignada a otro usuario");
        }
        return task;
    }

    static async assign(id: string, input: {
        assignedUserId: unknown;
        force?: boolean;
        reason?: unknown;
        expectedVersion?: unknown;
    }, actor: TaskActor) {
        const tenantId = TenantDataContext.requireTenantId();
        const assignedUserId = positiveInteger(input.assignedUserId, "assignedUserId");
        const task = await tenantPrisma.operationalTask.findFirst({ where: { id }, include: { store: true } });
        if (!task) throw CustomError.notFound("Tarea no encontrada");
        if (task.assignedUserId && task.assignedUserId !== assignedUserId && !hasPermission(actor, "tasks.reassign")) {
            throw CustomError.forbidden("No tienes permiso para reasignar esta tarea");
        }
        const membership = await tenantPrisma.tenantMembership.findFirst({
            where: {
                userId: assignedUserId,
                status: TenantMembershipStatus.ACTIVE,
                user: { isActive: true },
            },
            select: { id: true },
        });
        if (!membership) throw CustomError.badRequest("El usuario no tiene una membresía activa en esta empresa");

        const now = new Date();
        const eligible = await tenantPrisma.userStoreAssignment.findFirst({
            where: {
                userId: assignedUserId,
                storeId: task.storeId,
                isActive: true,
                AND: [
                    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
                ],
            },
            select: { id: true },
        });
        const isCrossStore = !eligible;
        if (isCrossStore && !input.force) {
            throw new StoreAssignmentRequiredError({
                userId: assignedUserId,
                storeId: task.storeId,
                storeName: task.store.name,
            });
        }
        if (isCrossStore && !hasPermission(actor, "tasks.override_store")) {
            throw CustomError.forbidden("No tienes permiso para confirmar asignaciones fuera de sede");
        }
        const reason = normalizedReason(input.reason, isCrossStore);
        const expectedVersion = input.expectedVersion == null
            ? task.version
            : positiveInteger(input.expectedVersion, "expectedVersion");
        const changedAssignee = task.assignedUserId !== assignedUserId;

        const updated = await tenantPrisma.$transaction(async (tx) => {
            const result = await tx.operationalTask.updateMany({
                where: { id, version: expectedVersion },
                data: {
                    assignedUserId,
                    assignedByUserId: actor.userId,
                    isCrossStoreAssignment: isCrossStore,
                    assignmentOverrideReason: isCrossStore ? reason : null,
                    overrideAuthorizedByUserId: isCrossStore ? actor.userId : null,
                    ...(changedAssignee ? {
                        status: OperationalTaskStatus.PENDING_ACCEPTANCE,
                        acceptedAt: null,
                        startedAt: null,
                        completedAt: null,
                        rejectedAt: null,
                        rejectionReason: null,
                    } : {}),
                    version: { increment: 1 },
                },
            });
            if (result.count !== 1) throw CustomError.conflict("La tarea cambió; actualiza la pantalla e intenta nuevamente");
            await tx.operationalTaskEvent.create({
                data: {
                    tenantId,
                    taskId: id,
                    eventType: changedAssignee ? "ASSIGNED" : "ASSIGNMENT_CONFIRMED",
                    fromStatus: task.status,
                    toStatus: changedAssignee ? OperationalTaskStatus.PENDING_ACCEPTANCE : task.status,
                    actorUserId: actor.userId,
                    note: reason,
                    metadata: { assignedUserId, isCrossStore } satisfies Prisma.InputJsonObject,
                },
            });
            const isPickingTask = task.type === OperationalTaskType.LOCAL_PICKING
                || task.type === OperationalTaskType.REMOTE_PICKING;
            if (isPickingTask && task.orderId) {
                await upsertSharedPickingResponsibility(
                    task.orderId,
                    assignedUserId,
                    actor.userId,
                    "DELEGATION",
                    reason ?? "Asignación desde Mis tareas",
                    tx,
                );
                if (changedAssignee && task.assignedUserId && task.assignedUserId !== assignedUserId) {
                    const otherAssignments = await tx.operationalTask.count({
                        where: {
                            id: { not: task.id },
                            orderId: task.orderId,
                            assignedUserId: task.assignedUserId,
                            type: { in: [OperationalTaskType.LOCAL_PICKING, OperationalTaskType.REMOTE_PICKING] },
                            status: { in: this.activeStatuses },
                        },
                    });
                    if (otherAssignments === 0) {
                        await tx.$executeRaw(
                            Prisma.sql`
                                UPDATE "PickingSharedResponsibility"
                                SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
                                WHERE "tenantId" = ${tenantId}::uuid
                                  AND "orderId" = ${task.orderId}
                                  AND "userId" = ${task.assignedUserId}
                            `,
                        );
                    }
                }
            }
            return tx.operationalTask.findFirstOrThrow({ where: { id }, include: taskInclude });
        });
        return updated;
    }

    static async transitionWithClient(
        db: Prisma.TransactionClient,
        id: string,
        action: "accept" | "reject" | "start" | "complete",
        input: {
        reason?: unknown;
        expectedVersion?: unknown;
        },
        actor: TaskActor,
    ) {
        const tenantId = TenantDataContext.requireTenantId();
        const task = await db.operationalTask.findFirst({ where: { id } });
        if (!task) throw CustomError.notFound("Tarea no encontrada");
        if (task.assignedUserId !== actor.userId) {
            throw CustomError.forbidden("Solo el usuario asignado puede ejecutar esta tarea");
        }
        const transitions: Record<typeof action, { from: OperationalTaskStatus[]; to: OperationalTaskStatus }> = {
            accept: { from: [OperationalTaskStatus.PENDING_ACCEPTANCE], to: OperationalTaskStatus.ACCEPTED },
            reject: { from: [OperationalTaskStatus.PENDING_ACCEPTANCE, OperationalTaskStatus.ACCEPTED], to: OperationalTaskStatus.REJECTED },
            start: { from: [OperationalTaskStatus.PENDING_ACCEPTANCE, OperationalTaskStatus.ACCEPTED], to: OperationalTaskStatus.IN_PROGRESS },
            complete: { from: [OperationalTaskStatus.ACCEPTED, OperationalTaskStatus.IN_PROGRESS, OperationalTaskStatus.WAITING_CONFIRMATION], to: OperationalTaskStatus.COMPLETED },
        };
        const transition = transitions[action];
        if (!transition.from.includes(task.status)) {
            throw CustomError.conflict(`No se puede ${action} una tarea en estado ${task.status}`);
        }
        const reason = normalizedReason(input.reason, action === "reject");
        const now = new Date();
        const expectedVersion = input.expectedVersion == null
            ? task.version
            : positiveInteger(input.expectedVersion, "expectedVersion");
        const result = await db.operationalTask.updateMany({
                where: { id, version: expectedVersion },
                data: {
                    status: transition.to,
                    ...(action === "accept" ? { acceptedAt: now } : {}),
                    ...(action === "start" ? { acceptedAt: task.acceptedAt ?? now, startedAt: now } : {}),
                    ...(action === "complete" ? { completedAt: now } : {}),
                    ...(action === "reject" ? { rejectedAt: now, rejectionReason: reason } : {}),
                    version: { increment: 1 },
                },
        });
        if (result.count !== 1) throw CustomError.conflict("La tarea cambió; actualiza la pantalla e intenta nuevamente");
        await db.operationalTaskEvent.create({
                data: {
                    tenantId,
                    taskId: id,
                    eventType: action.toUpperCase(),
                    fromStatus: task.status,
                    toStatus: transition.to,
                    actorUserId: actor.userId,
                    note: reason,
                },
        });
        return db.operationalTask.findFirstOrThrow({ where: { id }, include: taskInclude });
    }

    static async transition(id: string, action: "accept" | "reject" | "start" | "complete", input: {
        reason?: unknown;
        expectedVersion?: unknown;
    }, actor: TaskActor) {
        return tenantPrisma.$transaction((tx) => (
            this.transitionWithClient(tx, id, action, input, actor)
        ));
    }

    static async completePackingAndCreateDelivery(id: string, input: {
        reason?: unknown;
        expectedVersion?: unknown;
    }, actor: TaskActor) {
        return tenantPrisma.$transaction(async (tx) => {
            const current = await tx.operationalTask.findFirst({
                where: { id },
                include: { order: { select: { id: true, code: true, sourceStoreId: true, dispenserUserId: true } } },
            });
            if (!current?.order || current.type !== OperationalTaskType.PACKING) {
                throw CustomError.badRequest("La tarea no corresponde al empaque de un pedido");
            }
            const packed = await this.transitionWithClient(tx, id, "complete", input, actor);
            await this.createDeliveryTaskForOrder({
                orderId: current.order.id,
                orderCode: current.order.code,
                storeId: current.order.sourceStoreId,
                assignedUserId: current.order.dispenserUserId ?? current.assignedUserId,
                actorUserId: actor.userId,
            }, tx);
            return packed;
        });
    }

    static async createForTransfer(input: {
        transferId: number;
        transferCode: string;
        fromStoreId: number;
        toStoreId: number;
        actorUserId?: number | null;
    }, db?: Prisma.TransactionClient) {
        const tenantId = TenantDataContext.requireTenantId();
        const client = db ?? tenantPrisma;
        const existing = await client.operationalTask.findMany({
            where: { transferId: input.transferId, type: { in: [OperationalTaskType.TRANSFER_DISPATCH, OperationalTaskType.TRANSFER_RECEIVE] } },
        });
        if (existing.length > 0) return existing;
        const create = async (tx: Prisma.TransactionClient) => {
            const rows = await Promise.all([
                tx.operationalTask.create({ data: {
                    tenantId,
                    code: this.createCode(),
                    type: OperationalTaskType.TRANSFER_DISPATCH,
                    title: `Preparar transferencia ${input.transferCode}`,
                    description: "Separar y despachar los productos desde la sede de origen.",
                    storeId: input.fromStoreId,
                    transferId: input.transferId,
                    assignedByUserId: input.actorUserId ?? null,
                } }),
                tx.operationalTask.create({ data: {
                    tenantId,
                    code: this.createCode(),
                    type: OperationalTaskType.TRANSFER_RECEIVE,
                    title: `Recibir transferencia ${input.transferCode}`,
                    description: "Validar y confirmar la recepción en la sede de destino.",
                    storeId: input.toStoreId,
                    transferId: input.transferId,
                    assignedByUserId: input.actorUserId ?? null,
                } }),
            ]);
            await tx.operationalTaskEvent.createMany({
                data: rows.map((task) => ({
                    tenantId,
                    taskId: task.id,
                    eventType: "CREATED",
                    toStatus: OperationalTaskStatus.PENDING_ACCEPTANCE,
                    actorUserId: input.actorUserId ?? null,
                })),
            });
            return rows;
        };
        return db ? create(db) : tenantPrisma.$transaction(create);
    }

    static async createOrderReview(input: {
        orderId: number;
        orderCode: string;
        storeId: number;
        actorUserId?: number | null;
        salesChannel?: string | null;
    }) {
        const tenantId = TenantDataContext.requireTenantId();
        const existing = await tenantPrisma.operationalTask.findFirst({
            where: { orderId: input.orderId, type: OperationalTaskType.ORDER_REVIEW },
        });
        if (existing) return existing;
        const task = await tenantPrisma.operationalTask.create({
            data: {
                tenantId,
                code: this.createCode(),
                type: OperationalTaskType.ORDER_REVIEW,
                priority: OperationalTaskPriority.NORMAL,
                title: `Revisar pedido ${input.orderCode}`,
                description: input.salesChannel === "ECOMMERCE"
                    ? "Pedido recibido desde la tienda virtual. Validar stock, pago y preparación."
                    : "Validar el pedido antes de iniciar su preparación.",
                storeId: input.storeId,
                orderId: input.orderId,
                assignedByUserId: input.actorUserId ?? null,
            },
        });
        await tenantPrisma.operationalTaskEvent.create({
            data: {
                tenantId,
                taskId: task.id,
                eventType: "CREATED",
                toStatus: OperationalTaskStatus.PENDING_ACCEPTANCE,
                actorUserId: input.actorUserId ?? null,
            },
        });
        return task;
    }

    static async createPickingTasksForOrder(input: {
        orderId: number;
        orderCode: string;
        sourceStoreId: number;
        items: Array<{ fulfillmentStoreId?: number | null }>;
        primaryPickerUserId?: number | null;
        actorUserId?: number | null;
    }, db: Prisma.TransactionClient | typeof tenantPrisma = tenantPrisma) {
        const tenantId = TenantDataContext.requireTenantId();
        const storeIds = Array.from(new Set(input.items.map((item) => item.fulfillmentStoreId ?? input.sourceStoreId)));
        const created = [];
        for (const storeId of storeIds) {
            const type = storeId === input.sourceStoreId
                ? OperationalTaskType.LOCAL_PICKING
                : OperationalTaskType.REMOTE_PICKING;
            const existing = await db.operationalTask.findFirst({ where: { orderId: input.orderId, storeId, type } });
            if (existing) continue;
            let assignedUserId: number | null = null;
            if (input.primaryPickerUserId && storeId === input.sourceStoreId) {
                const now = new Date();
                const eligible = await db.userStoreAssignment.findFirst({
                    where: {
                        userId: input.primaryPickerUserId,
                        storeId,
                        isActive: true,
                        AND: [
                            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                            { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
                        ],
                    },
                    select: { id: true },
                });
                assignedUserId = eligible ? input.primaryPickerUserId : null;
            }
            const task = await db.operationalTask.create({
                data: {
                    tenantId,
                    code: this.createCode(),
                    type,
                    title: type === OperationalTaskType.LOCAL_PICKING
                        ? `Separar pedido ${input.orderCode}`
                        : `Separación remota ${input.orderCode}`,
                    description: type === OperationalTaskType.LOCAL_PICKING
                        ? "Separar los productos disponibles en esta sede."
                        : "Separar los productos solicitados por otra sede y dejarlos listos para traslado.",
                    storeId,
                    orderId: input.orderId,
                    assignedUserId,
                    assignedByUserId: input.actorUserId ?? null,
                },
            });
            await db.operationalTaskEvent.create({
                data: {
                    tenantId,
                    taskId: task.id,
                    eventType: assignedUserId ? "CREATED_AND_ASSIGNED" : "CREATED",
                    toStatus: OperationalTaskStatus.PENDING_ACCEPTANCE,
                    actorUserId: input.actorUserId ?? null,
                    metadata: { storeId, assignedUserId } satisfies Prisma.InputJsonObject,
                },
            });
            created.push(task);
        }
        const reviews = await db.operationalTask.findMany({
            where: { orderId: input.orderId, type: OperationalTaskType.ORDER_REVIEW, status: { in: this.activeStatuses } },
            select: { id: true, status: true },
        });
        for (const review of reviews) {
            await db.operationalTask.update({ where: { id: review.id }, data: { status: OperationalTaskStatus.COMPLETED, completedAt: new Date(), version: { increment: 1 } } });
            await db.operationalTaskEvent.create({ data: {
                tenantId, taskId: review.id, eventType: "ORDER_CONFIRMED", fromStatus: review.status,
                toStatus: OperationalTaskStatus.COMPLETED, actorUserId: input.actorUserId ?? null,
            } });
        }
        return created;
    }

    static async linkPickingSession(orderId: number, pickingSessionId: number) {
        await tenantPrisma.operationalTask.updateMany({
            where: { orderId, type: { in: [OperationalTaskType.LOCAL_PICKING, OperationalTaskType.REMOTE_PICKING] } },
            data: { pickingSessionId },
        });
    }

    static async countOpenPickingTasks(orderId: number) {
        return tenantPrisma.operationalTask.count({
            where: {
                orderId,
                type: { in: [OperationalTaskType.LOCAL_PICKING, OperationalTaskType.REMOTE_PICKING] },
                status: { in: this.activeStatuses },
            },
        });
    }

    static async completePickingTasksForOrder(
        orderId: number,
        actorUserId?: number | null,
        db: Prisma.TransactionClient | typeof tenantPrisma = tenantPrisma,
    ) {
        const tenantId = TenantDataContext.requireTenantId();
        const tasks = await db.operationalTask.findMany({
            where: { orderId, type: { in: [OperationalTaskType.LOCAL_PICKING, OperationalTaskType.REMOTE_PICKING] }, status: { in: this.activeStatuses } },
            select: { id: true, status: true },
        });
        for (const task of tasks) {
            await db.operationalTask.update({ where: { id: task.id }, data: { status: OperationalTaskStatus.COMPLETED, completedAt: new Date(), version: { increment: 1 } } });
            await db.operationalTaskEvent.create({ data: {
                tenantId, taskId: task.id, eventType: "PICKING_COMPLETED", fromStatus: task.status,
                toStatus: OperationalTaskStatus.COMPLETED, actorUserId: actorUserId ?? null,
            } });
        }
        return tasks.map((task) => task.id);
    }

    static async createDeliveryTaskForOrder(input: {
        orderId: number;
        orderCode: string;
        storeId: number;
        assignedUserId?: number | null;
        actorUserId?: number | null;
    }, db: Prisma.TransactionClient | typeof tenantPrisma = tenantPrisma) {
        const tenantId = TenantDataContext.requireTenantId();
        const existing = await db.operationalTask.findFirst({
            where: {
                orderId: input.orderId,
                type: { in: [OperationalTaskType.DELIVERY_DISPATCH, OperationalTaskType.CUSTOMER_HANDOFF] },
            },
        });
        if (existing) return existing;
        const task = await db.operationalTask.create({
            data: {
                tenantId,
                code: this.createCode(),
                type: OperationalTaskType.DELIVERY_DISPATCH,
                title: `Despachar pedido ${input.orderCode}`,
                description: "Validar el pedido preparado y confirmar su entrega al cliente.",
                storeId: input.storeId,
                orderId: input.orderId,
                assignedUserId: input.assignedUserId ?? null,
                assignedByUserId: input.actorUserId ?? null,
            },
        });
        await db.operationalTaskEvent.create({
            data: {
                tenantId,
                taskId: task.id,
                eventType: input.assignedUserId ? "CREATED_AND_ASSIGNED" : "CREATED",
                toStatus: OperationalTaskStatus.PENDING_ACCEPTANCE,
                actorUserId: input.actorUserId ?? null,
            },
        });
        return task;
    }

    static async createPackingTaskForOrder(input: {
        orderId: number;
        orderCode: string;
        storeId: number;
        assignedUserId?: number | null;
        actorUserId?: number | null;
    }, db: Prisma.TransactionClient | typeof tenantPrisma = tenantPrisma) {
        const tenantId = TenantDataContext.requireTenantId();
        const existing = await db.operationalTask.findFirst({
            where: { orderId: input.orderId, type: OperationalTaskType.PACKING },
        });
        if (existing) return existing;
        const task = await db.operationalTask.create({
            data: {
                tenantId,
                code: this.createCode(),
                type: OperationalTaskType.PACKING,
                title: `Empacar pedido ${input.orderCode}`,
                description: "Verificar las cantidades separadas y acondicionar el pedido para su entrega.",
                storeId: input.storeId,
                orderId: input.orderId,
                assignedUserId: input.assignedUserId ?? null,
                assignedByUserId: input.actorUserId ?? null,
            },
        });
        await db.operationalTaskEvent.create({
            data: {
                tenantId,
                taskId: task.id,
                eventType: input.assignedUserId ? "CREATED_AND_ASSIGNED" : "CREATED",
                toStatus: OperationalTaskStatus.PENDING_ACCEPTANCE,
                actorUserId: input.actorUserId ?? null,
            },
        });
        return task;
    }

    static async closeDeliveryTasksForOrder(
        orderId: number,
        outcome: "DELIVERED" | "CANCELLED",
        actorUserId?: number | null,
        metadata?: Prisma.InputJsonObject,
        db: Prisma.TransactionClient | typeof tenantPrisma = tenantPrisma,
    ) {
        const tenantId = TenantDataContext.requireTenantId();
        const targetStatus = outcome === "DELIVERED"
            ? OperationalTaskStatus.COMPLETED
            : OperationalTaskStatus.CANCELLED;
        const tasks = await db.operationalTask.findMany({
            where: {
                orderId,
                type: { in: [OperationalTaskType.PACKING, OperationalTaskType.DELIVERY_DISPATCH, OperationalTaskType.CUSTOMER_HANDOFF] },
                status: { in: this.activeStatuses },
            },
            select: { id: true, status: true },
        });
        for (const task of tasks) {
            await db.operationalTask.update({
                where: { id: task.id },
                data: {
                    status: targetStatus,
                    ...(targetStatus === OperationalTaskStatus.COMPLETED ? { completedAt: new Date() } : {}),
                    version: { increment: 1 },
                },
            });
            await db.operationalTaskEvent.create({
                data: {
                    tenantId,
                    taskId: task.id,
                    eventType: outcome === "DELIVERED" ? "ORDER_DELIVERED" : "ORDER_CANCELLED",
                    fromStatus: task.status,
                    toStatus: targetStatus,
                    actorUserId: actorUserId ?? null,
                    ...(metadata ? { metadata } : {}),
                },
            });
        }
        return tasks.map((task) => task.id);
    }

    static async reportDeliveryFailure(id: string, input: {
        reason?: unknown;
        rescheduledAt?: unknown;
        expectedVersion?: unknown;
    }, actor: TaskActor) {
        const tenantId = TenantDataContext.requireTenantId();
        const reason = normalizedReason(input.reason, true)!;
        const parsedDate = input.rescheduledAt ? new Date(String(input.rescheduledAt)) : null;
        if (parsedDate && (Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() <= Date.now())) {
            throw CustomError.badRequest("La reprogramación debe tener una fecha futura válida");
        }
        return tenantPrisma.$transaction(async (tx) => {
            const task = await tx.operationalTask.findFirst({ where: { id } });
            const deliveryTypes = new Set<OperationalTaskType>([
                OperationalTaskType.DELIVERY_DISPATCH,
                OperationalTaskType.CUSTOMER_HANDOFF,
            ]);
            if (!task || !deliveryTypes.has(task.type)) {
                throw CustomError.badRequest("La tarea no corresponde a un despacho");
            }
            if (task.assignedUserId !== actor.userId) {
                throw CustomError.forbidden("Solo el responsable puede reportar una entrega fallida");
            }
            const reportableStatuses = new Set<OperationalTaskStatus>([
                OperationalTaskStatus.ACCEPTED,
                OperationalTaskStatus.IN_PROGRESS,
                OperationalTaskStatus.WAITING_CONFIRMATION,
            ]);
            if (!reportableStatuses.has(task.status)) {
                throw CustomError.conflict(`No se puede reportar una entrega fallida en estado ${task.status}`);
            }
            const expectedVersion = input.expectedVersion == null
                ? task.version
                : positiveInteger(input.expectedVersion, "expectedVersion");
            const changed = await tx.operationalTask.updateMany({
                where: { id, version: expectedVersion },
                data: {
                    status: OperationalTaskStatus.WAITING_CONFIRMATION,
                    dueAt: parsedDate,
                    version: { increment: 1 },
                },
            });
            if (changed.count !== 1) throw CustomError.conflict("La tarea cambió; actualiza la pantalla e intenta nuevamente");
            await tx.operationalTaskEvent.create({
                data: {
                    tenantId,
                    taskId: id,
                    eventType: "DELIVERY_FAILED",
                    fromStatus: task.status,
                    toStatus: OperationalTaskStatus.WAITING_CONFIRMATION,
                    actorUserId: actor.userId,
                    note: reason,
                    metadata: {
                        failureReason: reason,
                        ...(parsedDate ? { rescheduledAt: parsedDate.toISOString() } : {}),
                    },
                },
            });
            return tx.operationalTask.findFirstOrThrow({ where: { id }, include: taskInclude });
        });
    }

    static async syncTransferStatus(
        transferId: number,
        transferStatus: "IN_TRANSIT" | "RECEIVED" | "CANCELLED",
        actorUserId?: number | null,
        db?: Prisma.TransactionClient,
    ) {
        const tenantId = TenantDataContext.requireTenantId();
        const targetStatus = transferStatus === "CANCELLED"
            ? OperationalTaskStatus.CANCELLED
            : OperationalTaskStatus.COMPLETED;
        const types = transferStatus === "IN_TRANSIT"
            ? [OperationalTaskType.TRANSFER_DISPATCH]
            : [OperationalTaskType.TRANSFER_DISPATCH, OperationalTaskType.TRANSFER_RECEIVE];
        const client = db ?? tenantPrisma;
        const tasks = await client.operationalTask.findMany({
            where: {
                transferId,
                type: { in: types },
                status: { in: this.activeStatuses },
            },
            select: { id: true, status: true },
        });
        if (tasks.length === 0) return [];
        const update = async (tx: Prisma.TransactionClient) => {
            for (const task of tasks) {
                await tx.operationalTask.update({
                    where: { id: task.id },
                    data: {
                        status: targetStatus,
                        ...(targetStatus === OperationalTaskStatus.COMPLETED ? { completedAt: new Date() } : {}),
                        version: { increment: 1 },
                    },
                });
                await tx.operationalTaskEvent.create({
                    data: {
                        tenantId,
                        taskId: task.id,
                        eventType: transferStatus === "CANCELLED" ? "CANCELLED_BY_TRANSFER" : "COMPLETED_BY_TRANSFER",
                        fromStatus: task.status,
                        toStatus: targetStatus,
                        actorUserId: actorUserId ?? null,
                        metadata: { transferStatus } satisfies Prisma.InputJsonObject,
                    },
                });
            }
        };
        if (db) await update(db);
        else await tenantPrisma.$transaction(update);
        return tasks.map((task) => task.id);
    }
}

export class StoreAssignmentService {
    static async list(userId: number) {
        return tenantPrisma.userStoreAssignment.findMany({
            where: { userId },
            include: {
                store: { select: { id: true, name: true, code: true, type: true, isActive: true } },
                grantedByUser: { select: { id: true, firstName: true, lastName: true } },
            },
            orderBy: [{ isActive: "desc" }, { assignmentType: "asc" }, { createdAt: "desc" }],
        });
    }

    static async create(userId: number, input: {
        storeId: unknown;
        assignmentType?: unknown;
        startsAt?: unknown;
        endsAt?: unknown;
        reason?: unknown;
    }, actorUserId: number) {
        const tenantId = TenantDataContext.requireTenantId();
        const storeId = positiveInteger(input.storeId, "storeId");
        const assignmentType = String(input.assignmentType || StoreAssignmentType.REGULAR).toUpperCase() as StoreAssignmentType;
        if (!Object.values(StoreAssignmentType).includes(assignmentType)) {
            throw CustomError.badRequest("assignmentType inválido");
        }
        const startsAt = input.startsAt ? new Date(String(input.startsAt)) : null;
        const endsAt = input.endsAt ? new Date(String(input.endsAt)) : null;
        if (startsAt && Number.isNaN(startsAt.getTime())) throw CustomError.badRequest("startsAt inválido");
        if (endsAt && Number.isNaN(endsAt.getTime())) throw CustomError.badRequest("endsAt inválido");
        if (startsAt && endsAt && endsAt <= startsAt) throw CustomError.badRequest("endsAt debe ser posterior a startsAt");
        if (assignmentType === StoreAssignmentType.TEMPORARY && (!startsAt || !endsAt)) {
            throw CustomError.badRequest("Una asignación temporal requiere fecha de inicio y finalización");
        }
        const [membership, store] = await Promise.all([
            tenantPrisma.tenantMembership.findFirst({ where: { userId, status: TenantMembershipStatus.ACTIVE, user: { isActive: true } } }),
            tenantPrisma.store.findFirst({ where: { id: storeId, isActive: true } }),
        ]);
        if (!membership) throw CustomError.badRequest("El usuario no pertenece activamente a esta empresa");
        if (!store) throw CustomError.badRequest("La sede no existe o está inactiva");

        return tenantPrisma.$transaction(async (tx) => {
            if (assignmentType === StoreAssignmentType.PRIMARY) {
                await tx.userStoreAssignment.updateMany({
                    where: { userId, assignmentType: StoreAssignmentType.PRIMARY, isActive: true },
                    data: { isActive: false, endsAt: new Date() },
                });
            }
            const existing = await tx.userStoreAssignment.findFirst({
                where: { userId, storeId, assignmentType },
            });
            const data = {
                startsAt,
                endsAt,
                isActive: true,
                reason: normalizedReason(input.reason),
                grantedByUserId: actorUserId,
            };
            return existing
                ? tx.userStoreAssignment.update({ where: { id: existing.id }, data })
                : tx.userStoreAssignment.create({ data: { tenantId, userId, storeId, assignmentType, ...data } });
        });
    }

    static async finish(userId: number, assignmentId: string, reason: unknown, actorUserId: number) {
        const assignment = await tenantPrisma.userStoreAssignment.findFirst({ where: { id: assignmentId, userId } });
        if (!assignment) throw CustomError.notFound("Asignación de sede no encontrada");
        return tenantPrisma.userStoreAssignment.update({
            where: { id: assignmentId },
            data: {
                isActive: false,
                endsAt: new Date(),
                reason: normalizedReason(reason) ?? assignment.reason,
                grantedByUserId: actorUserId,
            },
        });
    }
}
