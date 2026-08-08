import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from "vitest";
import { prisma, runTenantDatabaseTransaction } from "../src/data/prisma";
import {
    seedDefaultPaymentMethodsForTenant,
} from "../src/data/payment-method-bootstrap";
import {
    seedDefaultSystemSettingsForTenant,
} from "../src/data/system-config-bootstrap";
import { CreateMarketplaceOrderDto } from "../src/domain/dtos/create-marketplace-order.dto";
import { PublicListProductDto } from "../src/domain/dtos/public-list-product.dto";
import {
    inspectMarketplaceConfigMigration,
    reconcileMarketplaceConfigMigration,
} from "../src/modules/tenant/marketplace-config-reconciliation";
import { LEGACY_TENANT_ID } from "../src/modules/tenant/tenant-data-context";
import { MarketplaceAuthService } from "../src/presentation/services/marketplace-auth.service";
import { OrderService } from "../src/presentation/services/order.service";
import { PaymentMethodService } from "../src/presentation/services/payment-method.service";
import { ProductService } from "../src/presentation/services/product.service";
import { SystemConfigService } from "../src/presentation/services/system-config.service";

const tag = Date.now().toString(36);
let dbReady = false;
let reconciled = false;
const tenantIds: string[] = [];
const categoryIds: number[] = [];
const productIds: number[] = [];
const variantIds: number[] = [];
const storeIds: number[] = [];
const inventoryIds: number[] = [];
const orderIds: number[] = [];

type TenantFixture = {
    tenantId: string;
    categoryId: number;
    productId: number;
    variantId: number;
    storeId: number;
    inventoryId: number;
    paymentMethodId: number;
    companyName: string;
};

let companyA: TenantFixture | null = null;
let companyB: TenantFixture | null = null;

async function inTenant<T>(
    tenantId: string,
    callback: () => Promise<T>,
): Promise<T> {
    return runTenantDatabaseTransaction(tenantId, () => callback());
}

async function createTenantFixture(
    label: "A" | "B",
    autoReserveStock: boolean,
    includeIgv: boolean,
): Promise<TenantFixture> {
    const tenant = await prisma.tenant.create({
        data: {
            slug: `mig009-${label.toLowerCase()}-${tag}`,
            name: `MIG009 ${label} ${tag}`,
            status: "ACTIVE",
        },
    });
    tenantIds.push(tenant.id);
    await seedDefaultPaymentMethodsForTenant(tenant.id);
    await seedDefaultSystemSettingsForTenant(tenant.id);

    const fixture = await inTenant(tenant.id, async () => {
        const category = await prisma.category.create({
            data: { name: `MIG009 Shared Category ${tag}` },
        });
        const product = await prisma.product.create({
            data: {
                name: `MIG009 Product ${label} ${tag}`,
                categoryId: category.id,
                variants: {
                    create: {
                        sku: `MIG009-SHARED-SKU-${tag}`,
                        variantKey: "0-0",
                        price: label === "A" ? 20 : 30,
                    },
                },
            },
            include: { variants: true },
        });
        const store = await prisma.store.create({
            data: {
                name: `MIG009 Store ${label} ${tag}`,
                code: `MIG009-SHARED-${tag}`,
            },
        });
        const inventory = await prisma.inventory.create({
            data: {
                storeId: store.id,
                variantId: product.variants[0]!.id,
                stock: 10,
                reservedStock: 0,
            },
        });
        const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({
            where: { code: "EFECTIVO" },
        });
        const companyName = `Comercio ${label} ${tag}`;
        await new SystemConfigService().updateOrderWorkflowSettings({
            marketplacePaymentMethodsEnabled: true,
            marketplacePaymentMethodIds: [paymentMethod.id],
            marketplaceAutoReserveStock: autoReserveStock,
            marketplaceIncludeIgv: includeIgv,
            companyName,
            companyLegalName: `Razón ${label} ${tag}`,
            companyAddress: `Dirección ${label} ${tag}`,
            companyPhone: label === "A" ? "900000001" : "900000002",
            companyEmail: `empresa-${label.toLowerCase()}-${tag}@example.test`,
            companyLogoUrl:
                `https://assets.example.test/${label.toLowerCase()}.png`,
        } as never);
        return {
            tenantId: tenant.id,
            categoryId: category.id,
            productId: product.id,
            variantId: product.variants[0]!.id,
            storeId: store.id,
            inventoryId: inventory.id,
            paymentMethodId: paymentMethod.id,
            companyName,
        };
    });

    categoryIds.push(fixture.categoryId);
    productIds.push(fixture.productId);
    variantIds.push(fixture.variantId);
    storeIds.push(fixture.storeId);
    inventoryIds.push(fixture.inventoryId);
    return fixture;
}

function marketplaceOrderDto(
    fixture: TenantFixture,
    idempotencyKey: string,
): CreateMarketplaceOrderDto {
    const [error, dto] = CreateMarketplaceOrderDto.create({
        sourceStoreId: fixture.storeId,
        pickupStoreId: fixture.storeId,
        deliveryType: "PICKUP",
        clientName: "Cliente MIG009",
        clientPhone: "955000000",
        clientEmail: `checkout-${tag}@example.test`,
        paymentMethodId: fixture.paymentMethodId,
        idempotencyKey,
        items: [{
            variantId: fixture.variantId,
            quantity: 2,
        }],
    });
    if (error || !dto) throw new Error(error ?? "Checkout inválido");
    return dto;
}

beforeAll(async () => {
    const [migration, checkpoint] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
            `SELECT migration_name
             FROM "_prisma_migrations"
             WHERE migration_name='20260729200000_backfill_tenant_profile'
               AND finished_at IS NOT NULL`,
        ).catch(() => []),
        prisma.tenantMigrationCheckpoint.findFirst({
            where: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-009",
                status: "COMPLETED",
            },
        }).catch(() => null),
    ]);
    const details = checkpoint?.details as {
        version?: unknown;
        marketplaceCustomerIds?: unknown;
    } | null;
    reconciled = details?.version === 1
        && Array.isArray(details.marketplaceCustomerIds);
    dbReady = migration.length === 1;
    if (!dbReady) return;

    companyA = await createTenantFixture("A", true, false);
    companyB = await createTenantFixture("B", false, true);
});

afterAll(async () => {
    if (tenantIds.length > 0) {
        await prisma.$executeRawUnsafe(
            `DELETE FROM "AuditLog" WHERE "tenantId"=ANY($1::uuid[])`,
            tenantIds,
        ).catch(() => undefined);
        await prisma.$executeRawUnsafe(
            `DELETE FROM "UserActivityLog" WHERE "tenantId"=ANY($1::uuid[])`,
            tenantIds,
        ).catch(() => undefined);
        await prisma.$executeRawUnsafe(
            `DELETE FROM "MarketplaceCustomer"
             WHERE "tenantId"=ANY($1::uuid[])`,
            tenantIds,
        ).catch(() => undefined);
        await prisma.$executeRawUnsafe(
            `DELETE FROM "SystemSetting"
             WHERE "tenantId"=ANY($1::uuid[])`,
            tenantIds,
        ).catch(() => undefined);
        await prisma.inventoryMovement.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await prisma.reservation.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await prisma.orderReturnItem.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await prisma.orderReturn.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await prisma.orderItem.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await prisma.order.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await prisma.inventory.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await prisma.productVariant.deleteMany({
            where: { id: { in: variantIds } },
        }).catch(() => undefined);
        await prisma.product.deleteMany({
            where: { id: { in: productIds } },
        }).catch(() => undefined);
        await prisma.store.deleteMany({
            where: { id: { in: storeIds } },
        }).catch(() => undefined);
        await prisma.category.deleteMany({
            where: { id: { in: categoryIds } },
        }).catch(() => undefined);
        await prisma.paymentMethod.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await prisma.tenantMembership.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await prisma.tenant.deleteMany({
            where: { id: { in: tenantIds } },
        }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
});

describe("MIG-009: marketplace, métodos de pago y configuración", () => {
    it("sella clientes, hashes, métodos, claves y perfil empresarial", async (ctx) => {
        if (!dbReady || !reconciled) return ctx.skip();

        const summary = await inspectMarketplaceConfigMigration();
        expect(summary.counts).toEqual({
            marketplaceCustomers: 14,
            activeMarketplaceCustomers: 14,
            customersWithAddress: 0,
            paymentMethods: 6,
            activePaymentMethods: 6,
            systemSettings: 18,
        });
        expect(summary.passwordEvidence).toEqual({
            bcryptCompatible: 14,
            costGroups: [{ cost: 10, count: 14 }],
            duplicateEmails: 0,
        });
        expect(summary.paymentMethodClassification)
            .toBe("TENANT_CONFIGURATION_CATALOG");
        expect(summary.allowedPaymentMethodIds).toEqual([1, 2, 3, 4, 5, 6]);
        expect(summary.missingAllowedPaymentMethodIds).toEqual([]);
        expect(summary.unknownSettings).toEqual([{
            key: "marketplace_product_variants_1",
            decision: "MIGRATE_AS_TENANT_SETTING",
            jsonValid: true,
            referencedProductId: 1,
            colorCount: 3,
            sizeCount: 4,
            colorImageCount: 3,
            missingReferences: 0,
        }]);
        expect(Object.values(
            summary.tenantProfile.mirroredFromSettings,
        ).every(Boolean)).toBe(true);
        expect(summary.crossTenantReferences).toBe(0);
        expect(summary.tenantConstraintCount).toBe(3);
        expect(summary.tenantIndexCount).toBe(4);
    });

    it("mantiene el perfil en Tenant y en el espejo compatible", async (ctx) => {
        if (!dbReady || !companyA || !companyB) return ctx.skip();

        for (const fixture of [companyA, companyB]) {
            const [settings, tenant, rows] = await inTenant(
                fixture.tenantId,
                () => Promise.all([
                    new SystemConfigService().getOrderWorkflowSettings(),
                    prisma.tenant.findUniqueOrThrow({
                        where: { id: fixture.tenantId },
                    }),
                    prisma.$queryRawUnsafe<Array<{
                        key: string;
                        value: string;
                    }>>(
                        `SELECT key,value
                         FROM "SystemSetting"
                         WHERE "tenantId"=$1::uuid
                           AND key LIKE 'company_%'
                         ORDER BY key`,
                        fixture.tenantId,
                    ),
                ]),
            );
            const mirror = new Map(
                rows.map((row) => [row.key, row.value]),
            );
            expect(settings.companyName).toBe(fixture.companyName);
            expect(tenant.name).toBe(fixture.companyName);
            expect(tenant.address).toBe(settings.companyAddress);
            expect(tenant.contactPhone).toBe(settings.companyPhone);
            expect(tenant.contactEmail).toBe(settings.companyEmail);
            expect(tenant.logoUrl).toBe(settings.companyLogoUrl);
            expect(mirror.get("company_name")).toBe(tenant.name);
            expect(mirror.get("company_address")).toBe(tenant.address);
            expect(mirror.get("company_phone")).toBe(tenant.contactPhone);
            expect(mirror.get("company_email")).toBe(tenant.contactEmail);
            expect(mirror.get("company_logo_url")).toBe(tenant.logoUrl);
        }
    });

    it("permite el mismo correo, pero autentica dentro de cada tenant", async (ctx) => {
        if (!dbReady || !companyA || !companyB) return ctx.skip();

        const sharedEmail = `cliente-compartido-${tag}@example.test`;
        const auth = new MarketplaceAuthService();
        const registeredA = await inTenant(
            companyA.tenantId,
            () => auth.register({
                firstName: "Cliente",
                lastName: "A",
                email: sharedEmail,
                phone: "911000001",
                password: "TenantAPass1!",
            } as never),
        );
        const registeredB = await inTenant(
            companyB.tenantId,
            () => auth.register({
                firstName: "Cliente",
                lastName: "B",
                email: sharedEmail,
                phone: "911000002",
                password: "TenantBPass1!",
            } as never),
        );
        expect(registeredA.user.id).not.toBe(registeredB.user.id);
        expect(registeredA.token).toBeTruthy();
        expect(registeredB.token).toBeTruthy();

        const loginA = await inTenant(
            companyA.tenantId,
            () => auth.login({
                email: sharedEmail,
                password: "TenantAPass1!",
            } as never),
        );
        const loginB = await inTenant(
            companyB.tenantId,
            () => auth.login({
                email: sharedEmail,
                password: "TenantBPass1!",
            } as never),
        );
        expect(loginA.user.lastName).toBe("A");
        expect(loginB.user.lastName).toBe("B");
        await expect(inTenant(
            companyB.tenantId,
            () => auth.login({
                email: sharedEmail,
                password: "TenantAPass1!",
            } as never),
        )).rejects.toThrow(/credenciales/i);
    });

    it("aísla catálogo público y checkout, aplicando flags efectivos", async (ctx) => {
        if (!dbReady || !companyA || !companyB) return ctx.skip();

        const [, productDto] = PublicListProductDto.create({
            skip: 1,
            take: 20,
        });
        const catalogA = await inTenant(
            companyA.tenantId,
            () => new ProductService().listPublicProducts(productDto!),
        );
        const catalogB = await inTenant(
            companyB.tenantId,
            () => new ProductService().listPublicProducts(productDto!),
        );
        expect(catalogA.data.map((row: { id: number }) => row.id))
            .toEqual([companyA.productId]);
        expect(catalogB.data.map((row: { id: number }) => row.id))
            .toEqual([companyB.productId]);

        const orderA = await inTenant(
            companyA.tenantId,
            () => new OrderService().createMarketplaceOrder(
                marketplaceOrderDto(companyA!, `MIG009-SHARED-${tag}`),
            ),
        );
        const orderB = await inTenant(
            companyB.tenantId,
            () => new OrderService().createMarketplaceOrder(
                marketplaceOrderDto(companyB!, `MIG009-SHARED-${tag}`),
            ),
        );
        orderIds.push(orderA.id, orderB.id);

        const stateA = await inTenant(
            companyA.tenantId,
            () => Promise.all([
                prisma.inventory.findUniqueOrThrow({
                    where: { id: companyA!.inventoryId },
                }),
                prisma.reservation.findMany({
                    where: { orderId: orderA.id },
                }),
                prisma.order.findUniqueOrThrow({
                    where: { id: orderA.id },
                    include: { items: true },
                }),
            ]),
        );
        const stateB = await inTenant(
            companyB.tenantId,
            () => Promise.all([
                prisma.inventory.findUniqueOrThrow({
                    where: { id: companyB!.inventoryId },
                }),
                prisma.reservation.findMany({
                    where: { orderId: orderB.id },
                }),
                prisma.order.findUniqueOrThrow({
                    where: { id: orderB.id },
                    include: { items: true },
                }),
            ]),
        );
        expect(stateA[0].reservedStock).toBe(2);
        expect(stateA[1]).toHaveLength(1);
        expect(stateA[2].items[0]?.reserved).toBe(2);
        expect(Number(stateA[2].tax)).toBe(0);
        expect(stateB[0].reservedStock).toBe(0);
        expect(stateB[1]).toHaveLength(0);
        expect(stateB[2].items[0]?.reserved).toBe(0);
        expect(Number(stateB[2].tax)).toBeGreaterThan(0);

        const methodsA = await inTenant(
            companyA.tenantId,
            () => new OrderService()
                .getMarketplaceCheckoutPaymentMethods(),
        );
        const methodsB = await inTenant(
            companyB.tenantId,
            () => new OrderService()
                .getMarketplaceCheckoutPaymentMethods(),
        );
        expect(methodsA.methods.map((row) => row.id))
            .toEqual([companyA.paymentMethodId]);
        expect(methodsB.methods.map((row) => row.id))
            .toEqual([companyB.paymentMethodId]);
        await expect(inTenant(
            companyB.tenantId,
            () => new OrderService().createMarketplaceOrder(
                marketplaceOrderDto({
                    ...companyB!,
                    paymentMethodId: companyA!.paymentMethodId,
                }, `MIG009-CROSS-${tag}`),
            ),
        )).rejects.toThrow(/no esta disponible|no está disponible/i);
    });

    it("el bootstrap no reescribe métodos ya personalizados", async (ctx) => {
        if (!dbReady || !companyA) return ctx.skip();

        const customName = `Caja principal ${tag}`;
        await inTenant(
            companyA.tenantId,
            async () => {
                await new PaymentMethodService().update({
                    id: companyA!.paymentMethodId,
                    name: customName,
                    isActive: true,
                } as never);
                await prisma.paymentMethod.update({
                    where: { id: companyA!.paymentMethodId },
                    data: { displayOrder: 77 },
                });
            },
        );
        await seedDefaultPaymentMethodsForTenant(companyA.tenantId);
        const after = await inTenant(
            companyA.tenantId,
            () => prisma.paymentMethod.findUniqueOrThrow({
                where: { id: companyA!.paymentMethodId },
            }),
        );
        expect(after.name).toBe(customName);
        expect(after.displayOrder).toBe(77);
        expect(after.isActive).toBe(true);
    });

    it("la reejecución conserva huellas y no toca otras empresas", async (ctx) => {
        if (!dbReady || !reconciled || !companyA || !companyB) {
            return ctx.skip();
        }

        const before = await inspectMarketplaceConfigMigration();
        const tenantRowsBefore = await Promise.all(tenantIds.map(
            (tenantId) => inTenant(
                tenantId,
                () => Promise.all([
                    prisma.paymentMethod.count(),
                    prisma.$queryRawUnsafe<Array<{ count: number }>>(
                        `SELECT COUNT(*)::int AS count
                         FROM "MarketplaceCustomer"
                         WHERE "tenantId"=$1::uuid`,
                        tenantId,
                    ),
                    prisma.$queryRawUnsafe<Array<{ count: number }>>(
                        `SELECT COUNT(*)::int AS count
                         FROM "SystemSetting"
                         WHERE "tenantId"=$1::uuid`,
                        tenantId,
                    ),
                ]),
            ),
        ));
        await reconcileMarketplaceConfigMigration();
        await reconcileMarketplaceConfigMigration();
        const after = await inspectMarketplaceConfigMigration();
        const tenantRowsAfter = await Promise.all(tenantIds.map(
            (tenantId) => inTenant(
                tenantId,
                () => Promise.all([
                    prisma.paymentMethod.count(),
                    prisma.$queryRawUnsafe<Array<{ count: number }>>(
                        `SELECT COUNT(*)::int AS count
                         FROM "MarketplaceCustomer"
                         WHERE "tenantId"=$1::uuid`,
                        tenantId,
                    ),
                    prisma.$queryRawUnsafe<Array<{ count: number }>>(
                        `SELECT COUNT(*)::int AS count
                         FROM "SystemSetting"
                         WHERE "tenantId"=$1::uuid`,
                        tenantId,
                    ),
                ]),
            ),
        ));
        expect(after.fingerprints).toEqual(before.fingerprints);
        expect(tenantRowsAfter).toEqual(tenantRowsBefore);
    });
});
