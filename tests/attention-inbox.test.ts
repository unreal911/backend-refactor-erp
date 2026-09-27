import { TenantPlanCode } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { platformPrisma } from "../src/data/platform-prisma";
import { runTenantDatabaseTransaction } from "../src/data/prisma";
import { AttentionService } from "../src/modules/attention/attention.service";
import { getPlanDefinition, planLimitsAsTenantFields } from "../src/modules/plans/plan-catalog";
import { ROLE_PERMISSION_MATRIX } from "../src/presentation/auth/permission-catalog";

const tag = `${Date.now().toString(36)}-${process.pid}`;
let tenantId = "";
let userId = 0;
let customerId = 0;
let storeId = 0;

beforeAll(async () => {
    const role = await platformPrisma.role.findUniqueOrThrow({ where: { name: "SELLER" } });
    const tenant = await platformPrisma.tenant.create({ data: {
        slug: `attention-${tag}`,
        name: `Attention ${tag}`,
        status: "ACTIVE",
        planCode: TenantPlanCode.GROWTH,
        ...planLimitsAsTenantFields(TenantPlanCode.GROWTH),
    } });
    tenantId = tenant.id;
    const user = await platformPrisma.user.create({ data: {
        firstName: "Ana", lastName: "Asesora", email: `attention-${tag}@test.local`, password: "test", roleId: role.id,
    } });
    userId = user.id;
    await platformPrisma.tenantMembership.create({ data: { tenantId, userId, role: "SELLER", status: "ACTIVE" } });
    const customer = await platformPrisma.customer.create({ data: {
        tenantId, name: "Cliente WhatsApp", phone: "999888777",
    } });
    customerId = customer.id;
    const store = await platformPrisma.store.create({ data: { tenantId, name: "Tienda atención", code: `AT-${tag}` } });
    storeId = store.id;
});

afterAll(async () => {
    if (!tenantId) return;
    await platformPrisma.attentionFollowUp.deleteMany({ where: { tenantId } });
    await platformPrisma.attentionOrderCase.deleteMany({ where: { tenantId } });
    await platformPrisma.attentionMessage.deleteMany({ where: { tenantId } });
    await platformPrisma.attentionConversation.deleteMany({ where: { tenantId } });
    await platformPrisma.attentionTemplate.deleteMany({ where: { tenantId } });
    await platformPrisma.order.deleteMany({ where: { tenantId } });
    await platformPrisma.store.deleteMany({ where: { id: storeId } });
    await platformPrisma.customer.deleteMany({ where: { tenantId } });
    await platformPrisma.tenantMembership.deleteMany({ where: { tenantId } });
    await platformPrisma.user.deleteMany({ where: { id: userId } });
    await platformPrisma.tenant.deleteMany({ where: { id: tenantId } });
    await platformPrisma.$disconnect();
});

describe("bandeja local de atención", () => {
    it("crea, responde y conserva el historial sin depender de Meta", async () => {
        const service = new AttentionService();
        const conversation = await runTenantDatabaseTransaction(tenantId, () => service.create({
            contactPhone: "999 888 777",
            contactName: "Cliente WhatsApp",
            customerId,
            initialMessage: "¿Tienen stock?",
        }, userId));
        expect(conversation.contactPhone).toBe("51999888777");
        expect(conversation.provider).toBe("LOCAL");
        expect(conversation.unreadCount).toBe(1);

        const outgoing = await runTenantDatabaseTransaction(tenantId, () => service.send(
            conversation.id,
            "Sí, podemos ayudarte.",
            userId,
        ));
        expect(outgoing.deliveryStatus).toBe("SIMULATED");
        expect(outgoing.providerMessageId).toMatch(/^local-/);

        const detail = await runTenantDatabaseTransaction(tenantId, () => service.get(conversation.id));
        expect(detail.messages.map((message) => message.direction)).toEqual(["INBOUND", "OUTBOUND"]);
        expect(detail.customer?.id).toBe(customerId);
        expect(detail.assignedUser?.id).toBe(userId);
    });

    it("reabre una conversación resuelta cuando llega un mensaje local", async () => {
        const service = new AttentionService();
        const conversation = await runTenantDatabaseTransaction(tenantId, () => service.create({
            contactPhone: "988777666", contactName: "Reapertura",
        }, userId));
        await runTenantDatabaseTransaction(tenantId, () => service.update(conversation.id, { status: "RESOLVED" }));
        await runTenantDatabaseTransaction(tenantId, () => service.receiveLocal(conversation.id, "Tengo otra consulta"));
        const detail = await runTenantDatabaseTransaction(tenantId, () => service.get(conversation.id));
        expect(detail.status).toBe("REOPENED");
        expect(detail.unreadCount).toBe(1);
        expect(detail.resolvedAt).toBeNull();
    });

    it("ingiere eventos Meta de forma idempotente y actualiza sus estados", async () => {
        const service = new AttentionService();
        const input = {
            phone: "977666555", name: "Cliente externo", body: "Mensaje desde Meta",
            providerMessageId: `wamid-${tag}`, type: "TEXT",
        };
        const first = await runTenantDatabaseTransaction(tenantId, () => service.receiveExternal(input));
        const replay = await runTenantDatabaseTransaction(tenantId, () => service.receiveExternal(input));
        expect(first.duplicated).toBe(false);
        expect(replay.duplicated).toBe(true);
        expect(await platformPrisma.attentionMessage.count({ where: { tenantId, providerMessageId: input.providerMessageId } })).toBe(1);
        await runTenantDatabaseTransaction(tenantId, () => service.updateProviderStatus(input.providerMessageId, "read"));
        expect((await platformPrisma.attentionMessage.findFirstOrThrow({ where: { tenantId, providerMessageId: input.providerMessageId } })).deliveryStatus).toBe("READ");
    });

    it("administra respuestas rápidas y calcula métricas operativas", async () => {
        const service = new AttentionService();
        const template = await runTenantDatabaseTransaction(tenantId, () => service.createTemplate({
            title: `Disponibilidad ${tag}`, body: "Estamos validando el stock.", displayOrder: 1,
        }, userId));
        expect((await runTenantDatabaseTransaction(tenantId, () => service.listTemplates())).map((row) => row.id)).toContain(template.id);
        await runTenantDatabaseTransaction(tenantId, () => service.updateTemplate(template.id, { isActive: false }));
        expect((await runTenantDatabaseTransaction(tenantId, () => service.listTemplates())).map((row) => row.id)).not.toContain(template.id);
        const metrics = await runTenantDatabaseTransaction(tenantId, () => service.metrics());
        expect(metrics.total).toBeGreaterThan(0);
        expect(metrics.unread).toBeGreaterThanOrEqual(1);
    });

    it("conserva acuerdos y varias notas por cada pedido de una conversación", async () => {
        const service = new AttentionService();
        const [firstOrder, secondOrder] = await Promise.all([
            platformPrisma.order.create({ data: { tenantId, code: `AT-1-${tag}`, sourceStoreId: storeId } }),
            platformPrisma.order.create({ data: { tenantId, code: `AT-2-${tag}`, sourceStoreId: storeId } }),
        ]);
        const conversation = await runTenantDatabaseTransaction(tenantId, () => service.create({ contactPhone: "988 111 222" }, userId));
        const firstCase = await runTenantDatabaseTransaction(tenantId, () => service.linkOrder(conversation.id, firstOrder.id));
        await runTenantDatabaseTransaction(tenantId, () => service.linkOrder(conversation.id, secondOrder.id));
        await runTenantDatabaseTransaction(tenantId, () => service.updateCaseSummary(firstCase.id, "Confirmar colores y modelos"));
        const colorNote = await runTenantDatabaseTransaction(tenantId, () => service.createFollowUp(firstCase.id, "Conseguir colores", userId));
        await runTenantDatabaseTransaction(tenantId, () => service.updateFollowUp(colorNote.id, "COMPLETED", userId));
        await runTenantDatabaseTransaction(tenantId, () => service.createFollowUp(firstCase.id, "Confirmar modelos", userId));
        const detail = await runTenantDatabaseTransaction(tenantId, () => service.get(conversation.id));
        expect(detail.orderCases).toHaveLength(2);
        const linked = detail.orderCases.find((item) => item.id === firstCase.id);
        expect(linked?.summary).toBe("Confirmar colores y modelos");
        expect(linked?.followUps.map((note) => note.status)).toEqual(["COMPLETED", "PENDING"]);
    });

    it("no envía texto libre por Meta fuera de la ventana de 24 horas", async () => {
        const sendText = vi.fn();
        const service = new AttentionService({ code: "META", simulated: false, sendText });
        const conversation = await runTenantDatabaseTransaction(tenantId, () => service.create({
            contactPhone: "966555444", contactName: "Sin mensaje entrante",
        }, userId));
        await expect(runTenantDatabaseTransaction(tenantId, () => service.send(conversation.id, "Mensaje proactivo", userId)))
            .rejects.toThrow(/24 horas/i);
        expect(sendText).not.toHaveBeenCalled();
    });

    it("aplica capacidad por plan y permisos separados para consultar y gestionar", () => {
        expect(getPlanDefinition(TenantPlanCode.TRIAL).features.has("attention.inbox")).toBe(true);
        expect(getPlanDefinition(TenantPlanCode.STARTER).features.has("attention.inbox")).toBe(false);
        expect(getPlanDefinition(TenantPlanCode.GROWTH).features.has("attention.inbox")).toBe(true);
        expect(getPlanDefinition(TenantPlanCode.PREMIUM).features.has("attention.inbox")).toBe(true);
        expect(ROLE_PERMISSION_MATRIX.SELLER).toEqual(expect.arrayContaining(["attention.view", "attention.manage"]));
        expect(ROLE_PERMISSION_MATRIX.PICKER).not.toContain("attention.view");
    });
});
