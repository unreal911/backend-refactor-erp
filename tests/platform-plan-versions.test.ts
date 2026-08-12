import { afterAll, describe, expect, it } from "vitest";
import { platformPrisma } from "../src/data/platform-prisma";
import { PlanVersionService } from "../src/modules/platform-admin/plan-version.service";

const createdIds: string[] = [];
const actor = {
    platformAdminId: "00000000-0000-4000-8000-000000000999",
    correlationId: "test-platform-plans",
};

afterAll(async () => {
    if (createdIds.length > 0) {
        await platformPrisma.platformAuditEvent.deleteMany({
            where: { entityId: { in: createdIds } },
        });
        await platformPrisma.planVersion.deleteMany({
            where: { id: { in: createdIds } },
        });
    }
});

describe("planes versionados de plataforma", () => {
    it("expone exactamente los cuatro planes vigentes y mantiene Trial sin SUNAT", async () => {
        const plans = await PlanVersionService.listPublic(new Date());
        expect(plans.map((plan) => plan.code).sort()).toEqual([
            "GROWTH",
            "PREMIUM",
            "STARTER",
            "TRIAL",
        ]);
        const trial = plans.find((plan) => plan.code === "TRIAL");
        expect(trial?.monthlyPrice).toBeNull();
        expect(trial?.features).not.toContain("sunat");
        expect(trial?.limits.maxProducts).toBe(10);
        expect(plans.find((plan) => plan.code === "STARTER")?.monthlyPrice).toBe("30.00");
    });

    it("crea, edita, valida, programa y cancela un borrador sin alterar la versión pública", async () => {
        const beforePublic = await PlanVersionService.listPublic(new Date());
        const beforeStarter = beforePublic.find((plan) => plan.code === "STARTER");

        const draft = await PlanVersionService.createDraft("STARTER", {
            monthlyPrice: "35.00",
            maxProducts: 30,
        }, actor);
        createdIds.push(draft.id);
        expect(draft.status).toBe("DRAFT");

        const updated = await PlanVersionService.updateDraft(draft.id, {
            maxProducts: 32,
            expectedUpdatedAt: draft.updatedAt.toISOString(),
        }, actor);
        expect(updated.maxProducts).toBe(32);

        const validation = await PlanVersionService.validateVersion(draft.id);
        expect(validation.valid).toBe(true);
        expect(validation.current?.id).toBe(beforeStarter?.planVersionId);

        const scheduled = await PlanVersionService.schedule(draft.id, {
            effectiveFrom: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            applicationPolicy: "NEW_CUSTOMERS",
            reason: "Prueba de programación futura",
        }, actor);
        expect(scheduled.status).toBe("SCHEDULED");

        const cancelled = await PlanVersionService.cancelSchedule(
            draft.id,
            "Cancelar programación de prueba",
            actor,
        );
        expect(cancelled.status).toBe("CANCELLED");

        const afterPublic = await PlanVersionService.listPublic(new Date());
        expect(afterPublic.find((plan) => plan.code === "STARTER")?.planVersionId)
            .toBe(beforeStarter?.planVersionId);
    });

    it("rechaza SUNAT en cualquier borrador Trial", async () => {
        await expect(PlanVersionService.createDraft("TRIAL", {
            featureCodes: ["picking.basic", "sunat"],
        }, actor)).rejects.toMatchObject({ statusCode: 403 });
    });
});
