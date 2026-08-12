import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformPrisma, runTenantDatabaseTransaction } from "../src/data/prisma";
import { ManualPaymentService } from "../src/modules/platform-admin/manual-payment.service";
import { planLimitsAsTenantFields } from "../src/modules/plans/plan-catalog";

const suffix = Date.now().toString(36);
let tenantId = "";
let methodId = "";
let requestId = "";

const actor = {
    platformAdminId: "00000000-0000-4000-8000-000000000998",
    correlationId: "test-manual-payment",
};

beforeAll(async () => {
    const starter = await platformPrisma.planVersion.findFirstOrThrow({
        where: { status: "ACTIVE", plan: { code: "STARTER" } },
        orderBy: { version: "desc" },
    });
    const tenant = await platformPrisma.tenant.create({
        data: {
            slug: `pay-test-${suffix}`,
            marketplaceSlug: `pay-test-${suffix}`,
            name: `Pago manual ${suffix}`,
            status: "ACTIVE",
            kind: "CUSTOMER",
            planCode: "STARTER",
            activePlanVersionId: starter.id,
            ...planLimitsAsTenantFields("STARTER"),
        },
    });
    tenantId = tenant.id;
    const method = await ManualPaymentService.createMethod({
        type: "BANK_TRANSFER",
        name: "Cuenta de prueba",
        bankName: "Banco de prueba",
        accountHolder: "Empresa de prueba",
        accountNumber: "000-TEST-001",
        currency: "PEN",
    }, actor);
    methodId = method.id;
});

afterAll(async () => {
    if (tenantId) {
        await platformPrisma.manualPaymentRequest.deleteMany({ where: { tenantId } });
        await platformPrisma.tenantLifecycleEvent.deleteMany({ where: { tenantId } });
        await platformPrisma.tenantPlanAssignment.deleteMany({ where: { tenantId } });
        await platformPrisma.tenantSubscription.deleteMany({ where: { tenantId } });
        await platformPrisma.tenant.deleteMany({ where: { id: tenantId } });
    }
    if (methodId) await platformPrisma.manualPaymentMethod.deleteMany({ where: { id: methodId } });
    await platformPrisma.platformAuditEvent.deleteMany({
        where: { correlationId: actor.correlationId },
    });
});

describe("pagos manuales", () => {
    it("crea una solicitud idempotente sin activar el plan", async () => {
        const growth = await platformPrisma.planVersion.findFirstOrThrow({
            where: { status: "ACTIVE", plan: { code: "GROWTH" } },
            orderBy: { version: "desc" },
        });
        const input = {
            clientRequestId: `manual-${suffix}`,
            planVersionId: growth.id,
            paymentMethodId: methodId,
            billingCycle: "MONTHLY",
            amountReported: "70.00",
            operationReference: `OP-${suffix}`,
            paidAt: new Date().toISOString(),
        };
        const first = await runTenantDatabaseTransaction(tenantId, () => (
            ManualPaymentService.createRequest(input, null)
        ));
        const duplicate = await runTenantDatabaseTransaction(tenantId, () => (
            ManualPaymentService.createRequest(input, null)
        ));
        requestId = first.id;
        expect(first.id).toBe(duplicate.id);
        expect(first.status).toBe("PENDING_REVIEW");
        expect(first.offeredPrice).toBe("70.00");
        expect((await platformPrisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).planCode)
            .toBe("STARTER");
    });

    it("solo activa el plan cuando plataforma aprueba el importe exacto", async () => {
        const approved = await ManualPaymentService.approveRequest(requestId, {
            verifiedAmount: "70.00",
            operationReference: `OP-${suffix}`,
            internalNote: "Abono verificado manualmente",
        }, actor);
        expect(approved.status).toBe("APPROVED");
        expect(approved.assignmentId).toBeTruthy();

        const tenant = await platformPrisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
        expect(tenant.planCode).toBe("GROWTH");
        expect(tenant.maxProducts).toBe(50);
        expect(tenant.planFeatures).toContain("marketplace");

        const again = await ManualPaymentService.approveRequest(requestId, {
            verifiedAmount: "70.00",
            operationReference: `OP-${suffix}`,
        }, actor);
        expect(again.status).toBe("APPROVED");
        expect(await platformPrisma.tenantPlanAssignment.count({ where: { tenantId } })).toBe(1);
    });
});
