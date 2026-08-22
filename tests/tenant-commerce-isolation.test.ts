import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, runTenantDatabaseTransaction } from "../src/data/prisma";
import { LEGACY_TENANT_ID } from "../src/modules/tenant/tenant-data-context";
import { MarketplaceAuthService } from "../src/presentation/services/marketplace-auth.service";
import { PaymentMethodService } from "../src/presentation/services/payment-method.service";
import { upsertSharedPickingResponsibility } from "../src/presentation/services/order-picking.queries";

const tag = Date.now().toString(36);
let dbReady = false;
let ownerUserId = 0;

const created = {
    tenantIds: [] as string[],
    membershipIds: [] as string[],
    categoryIds: [] as number[],
    storeIds: [] as number[],
    productIds: [] as number[],
    variantIds: [] as number[],
    inventoryIds: [] as number[],
    orderIds: [] as number[],
    paymentMethodIds: [] as number[],
    marketplaceCustomerIds: [] as number[],
};

async function inTenant<T>(tenantId: string, callback: () => Promise<T>): Promise<T> {
    return runTenantDatabaseTransaction(tenantId, () => callback());
}

beforeAll(async () => {
    try {
        const migration = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
            `SELECT migration_name
             FROM "_prisma_migrations"
             WHERE migration_name = '20260729150000_tenant_scope_commerce'
               AND finished_at IS NOT NULL`,
        );
        ownerUserId = Number((await prisma.tenantMembership.findFirst({
            where: {
                tenantId: LEGACY_TENANT_ID,
                status: "ACTIVE",
                user: { isActive: true },
            },
            orderBy: { userId: "asc" },
            select: { userId: true },
        }))?.userId || 0);
        dbReady = migration.length === 1 && ownerUserId > 0;
    } catch {
        dbReady = false;
    }
});

afterAll(async () => {
    if (dbReady) {
        try {
            if (created.tenantIds.length) {
                await prisma.$executeRawUnsafe(
                    `DELETE FROM "AuditLog" WHERE "tenantId" = ANY($1::uuid[])`,
                    created.tenantIds,
                );
                await prisma.$executeRawUnsafe(
                    `DELETE FROM "UserActivityLog" WHERE "tenantId" = ANY($1::uuid[])`,
                    created.tenantIds,
                );
                await prisma.$executeRawUnsafe(
                    `DELETE FROM "SystemSetting" WHERE "tenantId" = ANY($1::uuid[])`,
                    created.tenantIds,
                );
                await prisma.$executeRawUnsafe(
                    `DELETE FROM "MarketplaceCustomer" WHERE "tenantId" = ANY($1::uuid[])`,
                    created.tenantIds,
                );
            }
            if (created.marketplaceCustomerIds.length) {
                await prisma.$executeRawUnsafe(
                    `DELETE FROM "MarketplaceCustomer"
                     WHERE "id" = ANY($1::int[])`,
                    created.marketplaceCustomerIds,
                );
            }
        } catch { /* best effort */ }
        try {
            if (created.orderIds.length) {
                await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } });
            }
        } catch { /* best effort */ }
        try {
            if (created.inventoryIds.length) {
                await prisma.inventory.deleteMany({ where: { id: { in: created.inventoryIds } } });
            }
        } catch { /* best effort */ }
        try {
            if (created.variantIds.length) {
                await prisma.productVariant.deleteMany({ where: { id: { in: created.variantIds } } });
            }
        } catch { /* best effort */ }
        try {
            if (created.productIds.length) {
                await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
            }
        } catch { /* best effort */ }
        try {
            if (created.categoryIds.length) {
                await prisma.category.deleteMany({ where: { id: { in: created.categoryIds } } });
            }
        } catch { /* best effort */ }
        try {
            if (created.storeIds.length) {
                await prisma.store.deleteMany({ where: { id: { in: created.storeIds } } });
            }
        } catch { /* best effort */ }
        try {
            if (created.paymentMethodIds.length) {
                await prisma.paymentMethod.deleteMany({ where: { id: { in: created.paymentMethodIds } } });
            }
        } catch { /* best effort */ }
        try {
            if (created.membershipIds.length) {
                await prisma.tenantMembership.deleteMany({ where: { id: { in: created.membershipIds } } });
            }
        } catch { /* best effort */ }
        try {
            if (created.tenantIds.length) {
                await prisma.tenant.deleteMany({ where: { id: { in: created.tenantIds } } });
            }
        } catch { /* best effort */ }
    }
    await prisma.$disconnect().catch(() => undefined);
});

describe("TEN-005/TEN-006/TEN-012: aislamiento real con dos empresas", () => {
    it("permite referencias repetidas y bloquea lectura, mutacion y relaciones cruzadas", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const tenantB = await prisma.tenant.create({
            data: {
                slug: `isolation-b-${tag}`,
                name: `Isolation B ${tag}`,
                status: "SUSPENDED",
            },
        });
        created.tenantIds.push(tenantB.id);
        const membershipB = await prisma.tenantMembership.create({
            data: {
                tenantId: tenantB.id,
                userId: ownerUserId,
                role: "ADMIN",
                status: "ACTIVE",
                activatedAt: new Date(),
            },
        });
        created.membershipIds.push(membershipB.id);

        const sharedCategoryName = `ISO-CATEGORY-${tag}`;
        const sharedStoreCode = `ISO-STORE-${tag}`;
        const sharedSku = `ISO-SKU-${tag}`;
        const sharedPaymentCode = `ISO-PAY-${tag}`;
        const sharedEmail = `isolation-${tag}@example.test`;

        const companyA = await inTenant(LEGACY_TENANT_ID, async () => {
            const category = await prisma.category.create({ data: { name: sharedCategoryName } });
            const store = await prisma.store.create({
                data: { name: `Store A ${tag}`, code: sharedStoreCode },
            });
            const product = await prisma.product.create({
                data: {
                    name: `Product A ${tag}`,
                    categoryId: category.id,
                    variants: {
                        create: {
                            sku: sharedSku,
                            price: 10,
                        },
                    },
                },
                include: { variants: true },
            });
            const variant = product.variants[0]!;
            const inventory = await prisma.inventory.create({
                data: {
                    storeId: store.id,
                    variantId: variant.id,
                    stock: 5,
                },
            });
            const order = await prisma.order.create({
                data: {
                    code: `ISO-ORDER-${tag}`,
                    sourceStoreId: store.id,
                    sellerUserId: ownerUserId,
                    items: {
                        create: {
                            variantId: variant.id,
                            quantity: 1,
                            unitPrice: 10,
                            subtotal: 10,
                        },
                    },
                },
            });
            const payment = await new PaymentMethodService().create({
                name: `Isolation pay ${tag}`,
                code: sharedPaymentCode,
                isActive: true,
            } as never);
            const customer = await new MarketplaceAuthService().register({
                firstName: "Customer",
                lastName: "A",
                email: sharedEmail,
                phone: "999111111",
                password: "Password123!",
            } as never);

            return { category, store, product, variant, inventory, order, payment, customer };
        });

        const companyB = await inTenant(tenantB.id, async () => {
            const category = await prisma.category.create({ data: { name: sharedCategoryName } });
            const store = await prisma.store.create({
                data: { name: `Store B ${tag}`, code: sharedStoreCode },
            });
            const product = await prisma.product.create({
                data: {
                    name: `Product B ${tag}`,
                    categoryId: category.id,
                    variants: {
                        create: {
                            sku: sharedSku,
                            price: 20,
                        },
                    },
                },
                include: { variants: true },
            });
            const variant = product.variants[0]!;
            const inventory = await prisma.inventory.create({
                data: {
                    storeId: store.id,
                    variantId: variant.id,
                    stock: 9,
                },
            });
            const order = await prisma.order.create({
                data: {
                    code: `ISO-ORDER-${tag}`,
                    sourceStoreId: store.id,
                    sellerUserId: ownerUserId,
                    items: {
                        create: {
                            variantId: variant.id,
                            quantity: 1,
                            unitPrice: 20,
                            subtotal: 20,
                        },
                    },
                },
            });
            await upsertSharedPickingResponsibility(
                order.id,
                ownerUserId,
                ownerUserId,
                "DELEGATION",
            );
            const payment = await new PaymentMethodService().create({
                name: `Isolation pay ${tag}`,
                code: sharedPaymentCode,
                isActive: true,
            } as never);
            const customer = await new MarketplaceAuthService().register({
                firstName: "Customer",
                lastName: "B",
                email: sharedEmail,
                phone: "999222222",
                password: "Password123!",
            } as never);

            return { category, store, product, variant, inventory, order, payment, customer };
        });

        created.categoryIds.push(companyA.category.id, companyB.category.id);
        created.storeIds.push(companyA.store.id, companyB.store.id);
        created.productIds.push(companyA.product.id, companyB.product.id);
        created.variantIds.push(companyA.variant.id, companyB.variant.id);
        created.inventoryIds.push(companyA.inventory.id, companyB.inventory.id);
        created.orderIds.push(companyA.order.id, companyB.order.id);
        created.paymentMethodIds.push(companyA.payment.id, companyB.payment.id);
        created.marketplaceCustomerIds.push(companyA.customer.user.id, companyB.customer.user.id);

        expect(companyA.variant.tenantId).toBe(LEGACY_TENANT_ID);
        expect(companyB.variant.tenantId).toBe(tenantB.id);
        expect(companyA.variant.sku).toBe(companyB.variant.sku);
        expect(companyA.store.code).toBe(companyB.store.code);

        await inTenant(LEGACY_TENANT_ID, async () => {
            expect(await prisma.product.findUnique({ where: { id: companyB.product.id } })).toBeNull();
            expect(await prisma.inventory.updateMany({
                where: { id: companyB.inventory.id },
                data: { stock: 999 },
            })).toEqual({ count: 0 });
            expect(await prisma.order.findUnique({ where: { id: companyB.order.id } })).toBeNull();

            await expect(
                prisma.inventory.create({
                    data: {
                        storeId: companyB.store.id,
                        variantId: companyB.variant.id,
                        stock: 1,
                    },
                }),
            ).rejects.toThrow(/Relacion cruzada de tenant|constraint/i);
        });

        await inTenant(tenantB.id, async () => {
            expect((await prisma.inventory.findUnique({
                where: { id: companyB.inventory.id },
            }))?.stock).toBe(9);
            expect(await prisma.product.count({ where: { name: `Product A ${tag}` } })).toBe(0);
            expect(await prisma.product.count({ where: { name: `Product B ${tag}` } })).toBe(1);
        });
    }, 60_000);
});
