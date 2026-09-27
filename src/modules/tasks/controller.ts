import { OperationalTaskStatus, OperationalTaskType, Prisma } from "@prisma/client";
import { Response } from "express";
import { CustomError } from "../../domain/errors/custom.error";
import { AuthRequest } from "../../presentation/auth/middleware";
import { AdminEventBus } from "../../presentation/admin-events/admin-event-bus";
import { InventoryService } from "../inventory/services/inventory.service";
import { OrderService } from "../../presentation/services/order.service";
import { UpdateOrderStatusDto } from "../../domain/dtos/update-order-status.dto";
import {
    OperationalTaskService,
    StoreAssignmentRequiredError,
    StoreAssignmentService,
    TaskActor,
} from "./operational-task.service";

function actorFrom(req: AuthRequest): TaskActor {
    if (!req.user) throw CustomError.unauthorized("Usuario no autenticado");
    return { userId: req.user.id, permissions: req.user.permissions ?? [] };
}

function optionalEnum<T extends Record<string, string>>(values: T, value: unknown, field: string): T[keyof T] | undefined {
    if (value == null || value === "") return undefined;
    const normalized = String(value).toUpperCase();
    if (!Object.values(values).includes(normalized)) throw CustomError.badRequest(`${field} inválido`);
    return normalized as T[keyof T];
}

function deliveryMetadata(body: Record<string, unknown>): Prisma.InputJsonObject {
    const raw = body.delivery;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw CustomError.badRequest("Registra los datos de entrega antes de completar el despacho");
    }
    const delivery = raw as Record<string, unknown>;
    const mode = String(delivery.mode || "").trim().toUpperCase();
    const recipientName = String(delivery.recipientName || "").trim();
    const carrierName = String(delivery.carrierName || "").trim();
    const trackingCode = String(delivery.trackingCode || "").trim();
    const evidenceUrl = String(delivery.evidenceUrl || "").trim();
    if (!["PICKUP", "OWN_DELIVERY", "COURIER"].includes(mode)) {
        throw CustomError.badRequest("Selecciona una modalidad de entrega válida");
    }
    if (recipientName.length < 2) throw CustomError.badRequest("Indica quién recibe el pedido");
    if (mode === "COURIER" && (!carrierName || !trackingCode)) {
        throw CustomError.badRequest("Para courier se requieren transportista y código de seguimiento");
    }
    if (evidenceUrl && !/^https?:\/\//i.test(evidenceUrl)) {
        throw CustomError.badRequest("La evidencia debe ser una URL válida");
    }
    return {
        mode,
        recipientName: recipientName.slice(0, 160),
        ...(carrierName ? { carrierName: carrierName.slice(0, 160) } : {}),
        ...(trackingCode ? { trackingCode: trackingCode.slice(0, 120) } : {}),
        ...(evidenceUrl ? { evidenceUrl: evidenceUrl.slice(0, 1000) } : {}),
        confirmedAt: new Date().toISOString(),
    };
}

export class OperationalTaskController {
    constructor(
        private readonly inventoryService = new InventoryService(),
        private readonly orderService = new OrderService(),
    ) {}

    private handle(error: unknown, res: Response) {
        if (error instanceof StoreAssignmentRequiredError) {
            return res.status(error.statusCode).json({
                code: error.code,
                message: error.message,
                details: error.details,
                requiresConfirmation: true,
            });
        }
        if (error instanceof CustomError) return res.status(error.statusCode).json({ message: error.message });
        console.error("[operational-tasks]", error);
        return res.status(500).json({ message: "Error interno del servidor" });
    }

    list = async (req: AuthRequest, res: Response) => {
        try {
            const assignedUserId = req.query.assignedUserId ? Number(req.query.assignedUserId) : undefined;
            const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
            const status = optionalEnum(OperationalTaskStatus, req.query.status, "status");
            const type = optionalEnum(OperationalTaskType, req.query.type, "type");
            const result = await OperationalTaskService.list(actorFrom(req), {
                ...(assignedUserId ? { assignedUserId } : {}),
                ...(storeId ? { storeId } : {}),
                ...(status ? { status } : {}),
                ...(type ? { type } : {}),
                page: Number(req.query.page) || 1,
                pageSize: Number(req.query.pageSize) || 25,
            });
            return res.json(result);
        } catch (error) { return this.handle(error, res); }
    };

    get = async (req: AuthRequest, res: Response) => {
        try { return res.json(await OperationalTaskService.getById(String(req.params.id), actorFrom(req))); }
        catch (error) { return this.handle(error, res); }
    };

    assign = async (req: AuthRequest, res: Response) => {
        try {
            const task = await OperationalTaskService.assign(String(req.params.id), req.body ?? {}, actorFrom(req));
            await AdminEventBus.publish({
                type: "TASK_UPDATED", entity: "TASK", entityId: task.id,
                status: task.status, actorUserId: req.user?.id ?? null, targetUserId: task.assignedUserId,
            });
            return res.json(task);
        } catch (error) { return this.handle(error, res); }
    };

    transition = (action: "accept" | "reject" | "start" | "complete") => async (req: AuthRequest, res: Response) => {
        try {
            const actor = actorFrom(req);
            const current = await OperationalTaskService.getById(String(req.params.id), actor);
            if (action === "complete" && current.type === "ORDER_REVIEW" && current.order) {
                if (current.assignedUserId !== actor.userId) {
                    throw CustomError.forbidden("Solo el usuario asignado puede confirmar la revisión");
                }
                const [dtoError, dto] = UpdateOrderStatusDto.create({ status: "CONFIRMED", note: "Confirmado desde Mis tareas" });
                if (dtoError || !dto) throw CustomError.internal("No se pudo preparar la confirmación del pedido");
                await this.orderService.updateOrderStatus(current.order.id, dto, actor.userId);
                const confirmedTask = await OperationalTaskService.getById(current.id, actor);
                await AdminEventBus.publish({
                    type: "TASK_UPDATED", entity: "TASK", entityId: confirmedTask.id,
                    status: confirmedTask.status, actorUserId: actor.userId, targetUserId: confirmedTask.assignedUserId,
                });
                return res.json(confirmedTask);
            }
            const isPickingTask = current.type === "LOCAL_PICKING" || current.type === "REMOTE_PICKING";
            if (action === "start" && isPickingTask && current.order) {
                const picking = await this.orderService.startOrderPicking(current.order.id, actor.userId);
                if (picking?.pickingSession?.id) {
                    await OperationalTaskService.linkPickingSession(current.order.id, Number(picking.pickingSession.id));
                }
            }
            if (action === "complete" && isPickingTask && current.order) {
                const pending = current.order.items.filter((item) => {
                    const lineStoreId = item.fulfillmentStoreId ?? current.order!.sourceStoreId;
                    const required = Math.max(0, item.quantity - item.shortageQuantity);
                    return lineStoreId === current.store.id && item.picked < required;
                });
                if (pending.length > 0) {
                    throw CustomError.conflict("Aún existen productos pendientes de separar en esta sede");
                }
            }
            if (action === "complete" && current.type === "PACKING" && current.order) {
                const packedTask = await OperationalTaskService.completePackingAndCreateDelivery(
                    String(req.params.id),
                    req.body ?? {},
                    actor,
                );
                await AdminEventBus.publish({
                    type: "TASK_UPDATED", entity: "TASK", entityId: packedTask.id,
                    status: packedTask.status, actorUserId: actor.userId, targetUserId: packedTask.assignedUserId,
                });
                return res.json(packedTask);
            }
            if (action === "complete" && current.type === "DELIVERY_DISPATCH" && current.order) {
                if (current.assignedUserId !== actor.userId) {
                    throw CustomError.forbidden("Solo el usuario asignado puede confirmar la entrega");
                }
                const [dtoError, dto] = UpdateOrderStatusDto.create({
                    status: "DELIVERED",
                    note: "Entrega confirmada desde Mis tareas",
                });
                if (dtoError || !dto) throw CustomError.internal("No se pudo preparar la entrega del pedido");
                await this.orderService.updateOrderStatus(
                    current.order.id,
                    dto,
                    actor.userId,
                    deliveryMetadata((req.body ?? {}) as Record<string, unknown>),
                );
                const deliveredTask = await OperationalTaskService.getById(current.id, actor);
                await AdminEventBus.publish({
                    type: "TASK_UPDATED", entity: "TASK", entityId: deliveredTask.id,
                    status: deliveredTask.status, actorUserId: actor.userId, targetUserId: deliveredTask.assignedUserId,
                });
                return res.json(deliveredTask);
            }
            if (action === "complete" && current.transfer) {
                if (current.type === "TRANSFER_DISPATCH" && current.transfer.status === "PENDING") {
                    await this.inventoryService.dispatchStockTransfer(current.transfer.id, actor.userId);
                }
                if (current.type === "TRANSFER_RECEIVE" && current.transfer.status === "IN_TRANSIT") {
                    await this.inventoryService.receiveStockTransfer(current.transfer.id, actor.userId);
                }
            }
            const task = await OperationalTaskService.transition(String(req.params.id), action, req.body ?? {}, actor);
            if (action === "complete" && isPickingTask && current.order) {
                const remaining = await OperationalTaskService.countOpenPickingTasks(current.order.id);
                if (remaining === 0) {
                    await this.orderService.completeOrderPicking(current.order.id, actor.userId);
                }
            }
            await AdminEventBus.publish({
                type: "TASK_UPDATED", entity: "TASK", entityId: task.id,
                status: task.status, actorUserId: req.user?.id ?? null, targetUserId: task.assignedUserId,
            });
            if (current.transfer && action === "complete") {
                await AdminEventBus.publish({
                    type: "TRANSFER_UPDATED", entity: "TRANSFER", entityId: current.transfer.id,
                    status: current.type === "TRANSFER_RECEIVE" ? "RECEIVED" : "IN_TRANSIT",
                    actorUserId: req.user?.id ?? null,
                });
            }
            return res.json(task);
        } catch (error) { return this.handle(error, res); }
    };

    reportDeliveryFailure = async (req: AuthRequest, res: Response) => {
        try {
            const task = await OperationalTaskService.reportDeliveryFailure(
                String(req.params.id),
                req.body ?? {},
                actorFrom(req),
            );
            await AdminEventBus.publish({
                type: "TASK_UPDATED", entity: "TASK", entityId: task.id,
                status: task.status, actorUserId: req.user?.id ?? null, targetUserId: task.assignedUserId,
            });
            return res.json(task);
        } catch (error) { return this.handle(error, res); }
    };

    pickItem = async (req: AuthRequest, res: Response) => {
        try {
            const actor = actorFrom(req);
            const task = await OperationalTaskService.getById(String(req.params.id), actor);
            if (!task.order || (task.type !== "LOCAL_PICKING" && task.type !== "REMOTE_PICKING")) {
                throw CustomError.badRequest("Esta tarea no corresponde a un picking");
            }
            if (task.status !== "IN_PROGRESS") {
                throw CustomError.conflict("Inicia la tarea antes de registrar cantidades");
            }
            const orderItemId = Number(req.params.orderItemId);
            const pickedQuantity = Number(req.body?.pickedQuantity);
            if (!Number.isInteger(orderItemId) || orderItemId < 1 || !Number.isInteger(pickedQuantity) || pickedQuantity < 0) {
                throw CustomError.badRequest("Cantidad o línea inválida");
            }
            const line = task.order.items.find((item) => item.id === orderItemId);
            const lineStoreId = line?.fulfillmentStoreId ?? task.order.sourceStoreId;
            if (!line || lineStoreId !== task.store.id) {
                throw CustomError.forbidden("La línea no pertenece a la sede de esta tarea");
            }
            await this.orderService.updatePickingOrderItem(task.order.id, orderItemId, pickedQuantity, actor.userId);
            const updated = await OperationalTaskService.getById(task.id, actor);
            await AdminEventBus.publish({
                type: "TASK_UPDATED", entity: "TASK", entityId: task.id,
                status: updated.status, actorUserId: actor.userId, targetUserId: task.assignedUserId,
            });
            return res.json(updated);
        } catch (error) { return this.handle(error, res); }
    };
}

export class StoreAssignmentController {
    private handle(error: unknown, res: Response) {
        if (error instanceof CustomError) return res.status(error.statusCode).json({ message: error.message });
        console.error("[store-assignments]", error);
        return res.status(500).json({ message: "Error interno del servidor" });
    }

    list = async (req: AuthRequest, res: Response) => {
        try { return res.json(await StoreAssignmentService.list(Number(req.params.userId))); }
        catch (error) { return this.handle(error, res); }
    };

    create = async (req: AuthRequest, res: Response) => {
        try {
            const result = await StoreAssignmentService.create(Number(req.params.userId), req.body ?? {}, actorFrom(req).userId);
            return res.status(201).json(result);
        } catch (error) { return this.handle(error, res); }
    };

    finish = async (req: AuthRequest, res: Response) => {
        try {
            return res.json(await StoreAssignmentService.finish(
                Number(req.params.userId), String(req.params.assignmentId), req.body?.reason, actorFrom(req).userId,
            ));
        } catch (error) { return this.handle(error, res); }
    };
}
