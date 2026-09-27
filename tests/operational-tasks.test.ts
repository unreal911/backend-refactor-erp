import { TenantPlanCode } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformPrisma } from "../src/data/platform-prisma";
import { runTenantDatabaseTransaction } from "../src/data/prisma";
import { planLimitsAsTenantFields } from "../src/modules/plans/plan-catalog";
import {
    OperationalTaskService,
    StoreAssignmentRequiredError,
    StoreAssignmentService,
} from "../src/modules/tasks/operational-task.service";

const tag = `${Date.now().toString(36)}-${process.pid}`;
let tenantId = "";
let managerId = 0;
let pickerId = 0;
let originStoreId = 0;
let destinationStoreId = 0;

beforeAll(async () => {
    const [managerRole, pickerRole] = await Promise.all([
        platformPrisma.role.findUniqueOrThrow({ where: { name: "MANAGER" } }),
        platformPrisma.role.findUniqueOrThrow({ where: { name: "PICKER" } }),
    ]);
    const tenant = await platformPrisma.tenant.create({
        data: {
            slug: `tasks-${tag}`,
            name: `Tasks ${tag}`,
            status: "ACTIVE",
            planCode: TenantPlanCode.GROWTH,
            planFeatures: ["tasks.operational", "fulfillment.remote", "picking.basic", "picking.collaborative", "transfers"],
            ...planLimitsAsTenantFields(TenantPlanCode.GROWTH),
        },
    });
    tenantId = tenant.id;
    const [manager, picker] = await Promise.all([
        platformPrisma.user.create({ data: { firstName: "Marta", lastName: "Supervisora", email: `manager-${tag}@test.local`, password: "test", roleId: managerRole.id } }),
        platformPrisma.user.create({ data: { firstName: "Pedro", lastName: "Picker", email: `picker-${tag}@test.local`, password: "test", roleId: pickerRole.id } }),
    ]);
    managerId = manager.id;
    pickerId = picker.id;
    await platformPrisma.tenantMembership.createMany({ data: [
        { tenantId, userId: managerId, role: "MANAGER", status: "ACTIVE" },
        { tenantId, userId: pickerId, role: "PICKER", status: "ACTIVE" },
    ] });
    const [origin, destination] = await Promise.all([
        platformPrisma.store.create({ data: { tenantId, name: "Tienda origen", code: `OR-${tag}` } }),
        platformPrisma.store.create({ data: { tenantId, name: "Almacén destino", code: `DE-${tag}`, type: "WAREHOUSE" } }),
    ]);
    originStoreId = origin.id;
    destinationStoreId = destination.id;
    await runTenantDatabaseTransaction(tenantId, async () => {
        await StoreAssignmentService.create(managerId, { storeId: originStoreId, assignmentType: "PRIMARY" }, managerId);
        await StoreAssignmentService.create(pickerId, { storeId: destinationStoreId, assignmentType: "PRIMARY" }, managerId);
    });
});

afterAll(async () => {
    if (!tenantId) return;
    await platformPrisma.operationalTaskEvent.deleteMany({ where: { tenantId } });
    await platformPrisma.operationalTask.deleteMany({ where: { tenantId } });
    await platformPrisma.userStoreAssignment.deleteMany({ where: { tenantId } });
    await platformPrisma.stockTransfer.deleteMany({ where: { tenantId } });
    await platformPrisma.order.deleteMany({ where: { tenantId } });
    await platformPrisma.tenantMembership.deleteMany({ where: { tenantId } });
    await platformPrisma.store.deleteMany({ where: { tenantId } });
    await platformPrisma.user.deleteMany({ where: { id: { in: [managerId, pickerId] } } });
    await platformPrisma.tenant.delete({ where: { id: tenantId } });
    await platformPrisma.$disconnect();
});

describe("tareas operativas y pertenencia por sede", () => {
    it("crea las tareas de despacho y recepción de una transferencia", async () => {
        const transfer = await platformPrisma.stockTransfer.create({
            data: {
                tenantId,
                code: `TR-${tag}`,
                fromStoreId: originStoreId,
                toStoreId: destinationStoreId,
                createdById: managerId,
            },
        });
        const tasks = await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.createForTransfer({
            transferId: transfer.id,
            transferCode: transfer.code,
            fromStoreId: originStoreId,
            toStoreId: destinationStoreId,
            actorUserId: managerId,
        }));
        expect(tasks.map((task) => task.type).sort()).toEqual(["TRANSFER_DISPATCH", "TRANSFER_RECEIVE"]);
        expect(await platformPrisma.operationalTaskEvent.count({ where: { tenantId } })).toBe(2);
    });

    it("avisa fuera de sede, registra la excepción y conserva todo el historial", async () => {
        const task = await platformPrisma.operationalTask.create({
            data: { tenantId, code: `TAR-${tag}`, type: "REMOTE_PICKING", title: "Separar pedido remoto", storeId: originStoreId },
        });
        const manager = {
            userId: managerId,
            permissions: ["tasks.assign", "tasks.reassign", "tasks.override_store", "tasks.view.all"],
        };
        await expect(runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.assign(task.id, {
            assignedUserId: pickerId,
        }, manager))).rejects.toBeInstanceOf(StoreAssignmentRequiredError);

        const assigned = await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.assign(task.id, {
            assignedUserId: pickerId,
            force: true,
            reason: "Apoyo temporal por alta demanda",
        }, manager));
        expect(assigned.isCrossStoreAssignment).toBe(true);
        expect(assigned.overrideAuthorizedByUserId).toBe(managerId);

        const started = await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.transition(
            task.id,
            "start",
            { expectedVersion: assigned.version },
            { userId: pickerId, permissions: ["tasks.view.own"] },
        ));
        expect(started.status).toBe("IN_PROGRESS");
        expect(started.acceptedAt).toBeInstanceOf(Date);

        const completed = await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.transition(
            task.id,
            "complete",
            { expectedVersion: started.version },
            { userId: pickerId, permissions: ["tasks.view.own"] },
        ));
        expect(completed.status).toBe("COMPLETED");
        const events = await platformPrisma.operationalTaskEvent.findMany({ where: { tenantId, taskId: task.id }, orderBy: { createdAt: "asc" } });
        expect(events.map((event) => event.eventType)).toEqual(["ASSIGNED", "START", "COMPLETE"]);
    });

    it("crea un picking por sede y solo autoasigna al responsable elegible", async () => {
        const order = await platformPrisma.order.create({
            data: { tenantId, code: `ORD-${tag}`, sourceStoreId: originStoreId, status: "CONFIRMED", salesChannel: "INTERNAL" },
        });
        const tasks = await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.createPickingTasksForOrder({
            orderId: order.id,
            orderCode: order.code,
            sourceStoreId: originStoreId,
            items: [{ fulfillmentStoreId: originStoreId }, { fulfillmentStoreId: destinationStoreId }],
            primaryPickerUserId: managerId,
            actorUserId: managerId,
        }));
        expect(tasks).toHaveLength(2);
        expect(tasks.find((task) => task.type === "LOCAL_PICKING")?.assignedUserId).toBe(managerId);
        expect(tasks.find((task) => task.type === "REMOTE_PICKING")?.assignedUserId).toBeNull();
    });

    it("crea una sola tarea de despacho y la cierra al entregar el pedido", async () => {
        const order = await platformPrisma.order.create({
            data: { tenantId, code: `DEL-${tag}`, sourceStoreId: originStoreId, status: "READY", salesChannel: "INTERNAL" },
        });
        const packing = await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.createPackingTaskForOrder({
            orderId: order.id,
            orderCode: order.code,
            storeId: originStoreId,
            assignedUserId: managerId,
            actorUserId: managerId,
        }));
        expect(packing.type).toBe("PACKING");
        const first = await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.createDeliveryTaskForOrder({
            orderId: order.id,
            orderCode: order.code,
            storeId: originStoreId,
            assignedUserId: managerId,
            actorUserId: managerId,
        }));
        const replay = await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.createDeliveryTaskForOrder({
            orderId: order.id,
            orderCode: order.code,
            storeId: originStoreId,
            actorUserId: managerId,
        }));
        expect(replay.id).toBe(first.id);

        await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.closeDeliveryTasksForOrder(
            order.id,
            "DELIVERED",
            managerId,
        ));
        expect((await platformPrisma.operationalTask.findUniqueOrThrow({ where: { id: first.id } })).status)
            .toBe("COMPLETED");
        expect((await platformPrisma.operationalTask.findUniqueOrThrow({ where: { id: packing.id } })).status)
            .toBe("COMPLETED");
    });

    it("completa empaque y crea el despacho dentro de una sola operación", async () => {
        const order = await platformPrisma.order.create({
            data: { tenantId, code: `CHAIN-${tag}`, sourceStoreId: originStoreId, status: "READY", salesChannel: "INTERNAL" },
        });
        const packing = await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.createPackingTaskForOrder({
            orderId: order.id,
            orderCode: order.code,
            storeId: originStoreId,
            assignedUserId: managerId,
            actorUserId: managerId,
        }));
        const actor = { userId: managerId, permissions: ["tasks.view.own"] };
        const started = await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.transition(
            packing.id,
            "start",
            { expectedVersion: packing.version },
            actor,
        ));
        const completed = await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.completePackingAndCreateDelivery(
            packing.id,
            { expectedVersion: started.version },
            actor,
        ));
        expect(completed.status).toBe("COMPLETED");
        const deliveries = await platformPrisma.operationalTask.findMany({
            where: { tenantId, orderId: order.id, type: "DELIVERY_DISPATCH" },
        });
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0].assignedUserId).toBe(managerId);
    });

    it("registra una entrega fallida con motivo y reprogramación auditables", async () => {
        const order = await platformPrisma.order.create({
            data: { tenantId, code: `FAIL-${tag}`, sourceStoreId: originStoreId, status: "READY", salesChannel: "INTERNAL" },
        });
        const delivery = await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.createDeliveryTaskForOrder({
            orderId: order.id,
            orderCode: order.code,
            storeId: originStoreId,
            assignedUserId: managerId,
            actorUserId: managerId,
        }));
        const actor = { userId: managerId, permissions: ["tasks.view.own"] };
        const started = await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.transition(
            delivery.id,
            "start",
            { expectedVersion: delivery.version },
            actor,
        ));
        const rescheduledAt = new Date(Date.now() + 86_400_000).toISOString();
        const failed = await runTenantDatabaseTransaction(tenantId, () => OperationalTaskService.reportDeliveryFailure(
            delivery.id,
            { reason: "Cliente ausente", rescheduledAt, expectedVersion: started.version },
            actor,
        ));
        expect(failed.status).toBe("WAITING_CONFIRMATION");
        expect(failed.dueAt?.toISOString()).toBe(rescheduledAt);
        const event = await platformPrisma.operationalTaskEvent.findFirstOrThrow({
            where: { tenantId, taskId: delivery.id, eventType: "DELIVERY_FAILED" },
        });
        expect(event.note).toBe("Cliente ausente");
        expect(event.metadata).toMatchObject({ failureReason: "Cliente ausente", rescheduledAt });
    });
});
