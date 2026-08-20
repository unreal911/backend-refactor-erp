import { TenantPlanCode } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformPrisma } from "../src/data/platform-prisma";
import { runTenantDatabaseTransaction } from "../src/data/prisma";
import {
    TenantLifecycleService,
    TenantQuotaService,
} from "../src/modules/lifecycle/tenant-lifecycle.service";
import { PlanAccessService } from "../src/modules/plans/plan-access.service";
import {
    getPlanDefinition,
    planLimitsAsTenantFields,
} from "../src/modules/plans/plan-catalog";

const tag = `${Date.now().toString(36)}-${process.pid}`;
const tenantIds: string[] = [];

async function createTenant(planCode: TenantPlanCode, suffix: string) {
    const tenant = await platformPrisma.tenant.create({
        data: {
            slug: `plan-${suffix}-${tag}`,
            name: `Plan ${suffix} ${tag}`,
            kind: planCode === TenantPlanCode.TRIAL ? "TRIAL" : "CUSTOMER",
            status: planCode === TenantPlanCode.TRIAL ? "TRIAL" : "ACTIVE",
            planCode,
            ...planLimitsAsTenantFields(planCode),
            trialStartedAt: planCode === TenantPlanCode.TRIAL
                ? new Date("2026-08-01T05:00:00.000Z")
                : null,
            trialEndsAt: planCode === TenantPlanCode.TRIAL
                ? new Date("2026-08-16T05:00:00.000Z")
                : null,
        },
    });
    tenantIds.push(tenant.id);
    await platformPrisma.tenantSubscription.create({
        data: {
            tenantId: tenant.id,
            provider: "test",
            planCode,
            status: planCode === TenantPlanCode.TRIAL ? "TRIALING" : "ACTIVE",
        },
    });
    return tenant;
}

beforeAll(async () => {
    await platformPrisma.$connect();
});

afterAll(async () => {
    await platformPrisma.order.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.inventory.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.store.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.productVariant.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.productImage.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.product.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.category.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.tenantLifecycleEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.tenantSubscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await platformPrisma.$disconnect();
});

describe("catálogo comercial vigente", () => {
    it("expone límites exactos y trial sin SUNAT", () => {
        expect(getPlanDefinition(TenantPlanCode.TRIAL).limits).toMatchObject({
            maxUsers: 2,
            maxProducts: 10,
            maxVariantsPerProduct: 20,
            maxStores: 5,
            maxPosSalesPerMonth: 70,
            maxMainImagesPerProduct: 3,
        });
        const trial = getPlanDefinition(TenantPlanCode.TRIAL);
        expect(trial.limits.maxProducts * trial.limits.maxMainImagesPerProduct).toBe(30);
        expect(trial.features.has("marketplace")).toBe(true);
        expect(getPlanDefinition(TenantPlanCode.STARTER).limits.maxProducts).toBe(25);
        expect(getPlanDefinition(TenantPlanCode.GROWTH).limits.maxProducts).toBe(50);
        expect(getPlanDefinition(TenantPlanCode.PREMIUM).limits.maxProducts).toBe(200);
        expect(getPlanDefinition(TenantPlanCode.TRIAL).features.has("sunat")).toBe(false);
        expect(getPlanDefinition(TenantPlanCode.TRIAL).features.has("picking.advanced")).toBe(true);
    });

    it("habilita transferencias Económico solo durante la promoción", () => {
        const now = new Date("2026-08-11T12:00:00.000Z");
        expect(PlanAccessService.effectiveFeatures({
            planCode: TenantPlanCode.STARTER,
            welcomeStorePromotionEndsAt: new Date("2026-08-12T12:00:00.000Z"),
        }, now).has("transfers")).toBe(true);
        expect(PlanAccessService.effectiveFeatures({
            planCode: TenantPlanCode.STARTER,
            welcomeStorePromotionEndsAt: new Date("2026-08-10T12:00:00.000Z"),
        }, now).has("transfers")).toBe(false);
    });

    it("rechaza SUNAT y permite funciones avanzadas dentro del trial", async () => {
        const tenant = await createTenant(TenantPlanCode.TRIAL, "feature-gates");
        await expect(runTenantDatabaseTransaction(tenant.id, () => (
            PlanAccessService.assert("sunat")
        ))).rejects.toMatchObject({ statusCode: 403 });
        await expect(runTenantDatabaseTransaction(tenant.id, () => (
            PlanAccessService.assert("picking.advanced")
        ))).resolves.toBeUndefined();
    });
});

describe("cuotas activas y gracia POS", () => {
    it("cuenta productos padre y no suma sus variantes a la cuota de 10", async () => {
        const tenant = await createTenant(TenantPlanCode.TRIAL, "products-with-variants");
        const category = await platformPrisma.category.create({
            data: { tenantId: tenant.id, name: `Variantes ${tag}` },
        });

        for (let productIndex = 1; productIndex <= 2; productIndex += 1) {
            await expect(runTenantDatabaseTransaction(tenant.id, () => (
                TenantQuotaService.assertAvailable("products")
            ))).resolves.toBeUndefined();
            await expect(runTenantDatabaseTransaction(tenant.id, () => (
                TenantQuotaService.assertVariantsAvailable(0, 20, true)
            ))).resolves.toBeUndefined();

            const product = await platformPrisma.product.create({
                data: {
                    tenantId: tenant.id,
                    categoryId: category.id,
                    name: `Producto ${productIndex} ${tag}`,
                },
            });
            await platformPrisma.productVariant.createMany({
                data: Array.from({ length: 20 }, (_, variantIndex) => ({
                    tenantId: tenant.id,
                    productId: product.id,
                    sku: `TRIAL-${productIndex}-${variantIndex}-${tag}`,
                    variantKey: `test-${variantIndex + 1}`,
                    price: 10,
                })),
            });
        }

        expect(await platformPrisma.product.count({
            where: { tenantId: tenant.id, isActive: true },
        })).toBe(2);
        expect(await platformPrisma.productVariant.count({
            where: { tenantId: tenant.id, isActive: true },
        })).toBe(40);
        await expect(runTenantDatabaseTransaction(tenant.id, () => (
            TenantQuotaService.assertAvailable("products")
        ))).resolves.toBeUndefined();
    });

    it("aplica el limite de imagenes a cada variante", async () => {
        const starter = await createTenant(TenantPlanCode.STARTER, "variant-images-starter");
        await expect(runTenantDatabaseTransaction(starter.id, () => (
            TenantQuotaService.assertVariantImagesAllowed(1)
        ))).rejects.toMatchObject({ statusCode: 403 });

        const premium = await createTenant(TenantPlanCode.PREMIUM, "variant-images-premium");
        await expect(runTenantDatabaseTransaction(premium.id, () => (
            TenantQuotaService.assertVariantImagesAllowed(1)
        ))).resolves.toBeUndefined();
    });

    it("cuenta productos activos y tiendas activas", async () => {
        const tenant = await createTenant(TenantPlanCode.STARTER, "active-resources");
        const category = await platformPrisma.category.create({
            data: { tenantId: tenant.id, name: `Categoría ${tag}` },
        });
        await platformPrisma.product.createMany({
            data: Array.from({ length: 26 }, (_, index) => ({
                tenantId: tenant.id,
                categoryId: category.id,
                name: `Producto ${index} ${tag}`,
                isActive: index < 25,
            })),
        });
        await platformPrisma.store.createMany({
            data: [
                { tenantId: tenant.id, name: "Principal", code: `P-${tag}`, isActive: true },
                { tenantId: tenant.id, name: "Archivada", code: `A-${tag}`, isActive: false },
            ],
        });
        await expect(runTenantDatabaseTransaction(tenant.id, () => (
            TenantQuotaService.assertAvailable("products")
        ))).rejects.toMatchObject({ statusCode: 409 });
        await expect(runTenantDatabaseTransaction(tenant.id, () => (
            TenantQuotaService.assertAvailable("stores")
        ))).rejects.toMatchObject({ statusCode: 409 });
        const oneActiveProduct = await platformPrisma.product.findFirstOrThrow({
            where: { tenantId: tenant.id, isActive: true },
        });
        await platformPrisma.product.update({
            where: { id: oneActiveProduct.id },
            data: { isActive: false },
        });
        await expect(runTenantDatabaseTransaction(tenant.id, () => (
            TenantQuotaService.assertAvailable("products")
        ))).resolves.toBeUndefined();
    });

    it("permite gracia el día del límite y bloquea al día siguiente", async () => {
        const tenant = await createTenant(TenantPlanCode.STARTER, "pos-grace");
        const store = await platformPrisma.store.create({
            data: { tenantId: tenant.id, name: "Caja", code: `C-${tag}` },
        });
        await platformPrisma.order.createMany({
            data: Array.from({ length: 70 }, (_, index) => ({
                tenantId: tenant.id,
                code: `POS-${tag}-${index}`,
                sourceStoreId: store.id,
                salesChannel: "POS",
                createdAt: new Date("2026-08-10T15:00:00.000Z"),
            })),
        });
        await expect(runTenantDatabaseTransaction(tenant.id, () => (
            TenantQuotaService.assertPosSaleAllowed(new Date("2026-08-11T15:00:00.000Z"))
        ))).rejects.toMatchObject({ statusCode: 409 });
        await platformPrisma.order.updateMany({
            where: { tenantId: tenant.id },
            data: { createdAt: new Date("2026-08-11T15:00:00.000Z") },
        });
        await expect(runTenantDatabaseTransaction(tenant.id, () => (
            TenantQuotaService.assertPosSaleAllowed(new Date("2026-08-11T20:00:00.000Z"))
        ))).resolves.toBeUndefined();
    });
});

describe("promoción de tiendas", () => {
    it("conserva la principal y desactiva excedentes de forma idempotente", async () => {
        const tenant = await createTenant(TenantPlanCode.STARTER, "promotion");
        const stores = await Promise.all([
            platformPrisma.store.create({
                data: { tenantId: tenant.id, name: "Primera", code: `PR1-${tag}` },
            }),
            platformPrisma.store.create({
                data: { tenantId: tenant.id, name: "Segunda", code: `PR2-${tag}` },
            }),
        ]);
        await platformPrisma.tenant.update({
            where: { id: tenant.id },
            data: {
                primaryStoreId: stores[1]!.id,
                welcomeStorePromotionStartedAt: new Date("2026-06-01T05:00:00.000Z"),
                welcomeStorePromotionEndsAt: new Date("2026-07-16T05:00:00.000Z"),
            },
        });
        const first = await TenantLifecycleService.expireWelcomeStorePromotions(
            new Date("2026-08-11T05:00:00.000Z"),
        );
        await TenantLifecycleService.expireWelcomeStorePromotions(
            new Date("2026-08-11T05:01:00.000Z"),
        );
        expect(first.deactivatedStores).toBeGreaterThanOrEqual(1);
        const current = await platformPrisma.store.findMany({
            where: { tenantId: tenant.id, isActive: true },
        });
        expect(current.map((store) => store.id)).toEqual([stores[1]!.id]);
        expect(await platformPrisma.tenantLifecycleEvent.count({
            where: { tenantId: tenant.id, type: "WELCOME_STORE_PROMOTION_ENDED" },
        })).toBe(1);
    });
});
