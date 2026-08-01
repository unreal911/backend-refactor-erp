import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    runTenantDatabaseTransaction,
} from "../src/data/prisma";
import { platformPrisma } from "../src/data/platform-prisma";
import { tenantPrisma } from "../src/data/tenant-prisma";

const tag = Date.now().toString(36);
const tenantIds: string[] = [];
let userId = 0;
let dbReady = false;

type CompanyFixture = {
    tenantId: string;
    membershipId: string;
    categoryId: number;
    storeId: number;
    productId: number;
    variantId: number;
    inventoryId: number;
    orderId: number;
    paymentMethodId: number;
    serieId: number;
};

async function inTenant<T>(
    tenantId: string,
    callback: () => Promise<T>,
): Promise<T> {
    return runTenantDatabaseTransaction(tenantId, () => callback());
}

async function createCompany(label: "A" | "B"): Promise<CompanyFixture> {
    const tenant = await platformPrisma.tenant.create({
        data: {
            slug: `ten010-${label.toLowerCase()}-${tag}`,
            name: `TEN010 Empresa ${label} ${tag}`,
            status: "ACTIVE",
        },
    });
    tenantIds.push(tenant.id);
    const membership = await platformPrisma.tenantMembership.create({
        data: {
            tenantId: tenant.id,
            userId,
            role: "OWNER",
            status: "ACTIVE",
            activatedAt: new Date(),
        },
    });

    return inTenant(tenant.id, async () => {
        const category = await tenantPrisma.category.create({
            data: { name: `TEN010 Catalogo ${tag}` },
        });
        const disposableCategory = await tenantPrisma.category.create({
            data: { name: `TEN010 Borrable ${tag}` },
        });
        await tenantPrisma.category.delete({
            where: { id: disposableCategory.id },
        });

        const store = await tenantPrisma.store.create({
            data: {
                code: `TEN010-${tag}`,
                name: `TEN010 Tienda ${label}`,
            },
        });
        const product = await tenantPrisma.product.create({
            data: {
                name: `TEN010 Producto ${label}`,
                categoryId: category.id,
                hasColor: false,
                hasSize: false,
                variants: {
                    create: {
                        sku: `TEN010-SKU-${tag}`,
                        price: label === "A" ? 10 : 20,
                    },
                },
            },
            include: { variants: true },
        });
        const variant = product.variants[0]!;
        const inventory = await tenantPrisma.inventory.create({
            data: {
                storeId: store.id,
                variantId: variant.id,
                stock: label === "A" ? 5 : 9,
            },
        });
        const order = await tenantPrisma.order.create({
            data: {
                code: `TEN010-ORDER-${tag}`,
                sourceStoreId: store.id,
                sellerUserId: userId,
                total: label === "A" ? 10 : 20,
                items: {
                    create: {
                        variantId: variant.id,
                        quantity: 1,
                        unitPrice: label === "A" ? 10 : 20,
                        subtotal: label === "A" ? 10 : 20,
                    },
                },
            },
        });
        const payment = await tenantPrisma.paymentMethod.create({
            data: {
                name: `TEN010 Pago ${tag}`,
                code: `TEN010-PAY-${tag}`,
            },
        });
        const serie = await tenantPrisma.comprobanteSerie.create({
            data: {
                tipo: "FACTURA",
                serie: `F${tag.slice(-3).toUpperCase().padStart(3, "0")}`,
                storeId: store.id,
            },
        });

        await tenantPrisma.$executeRaw`
            INSERT INTO "SystemSetting" ("tenantId", "key", "value")
            VALUES (${tenant.id}::uuid, ${`ten010_setting_${tag}`}, ${label})
        `;
        await tenantPrisma.$executeRaw`
            INSERT INTO "MarketplaceCustomer" (
                "tenantId", "firstName", "lastName", "email", "phone", "password"
            )
            VALUES (
                ${tenant.id}::uuid,
                'Cliente',
                ${label},
                ${`ten010-${tag}@example.test`},
                ${label === "A" ? "999000001" : "999000002"},
                'test-only'
            )
        `;
        await tenantPrisma.$executeRaw`
            INSERT INTO "AuditLog" (
                "tenantId", "dataScope", "actorUserId", "method", "path",
                "statusCode", "durationMs"
            )
            VALUES (
                ${tenant.id}::uuid,
                'TENANT',
                ${userId},
                'GET',
                ${`/ten010/${label.toLowerCase()}/${tag}`},
                200,
                1
            )
        `;
        await tenantPrisma.$executeRaw`
            INSERT INTO "UserActivityLog" (
                "tenantId", "userId", "module", "actionType", "actionLabel",
                "entityType", "entityId"
            )
            VALUES (
                ${tenant.id}::uuid,
                ${userId},
                'TEN010',
                'CREATE',
                ${`Empresa ${label}`},
                'Order',
                ${order.id}
            )
        `;

        return {
            tenantId: tenant.id,
            membershipId: membership.id,
            categoryId: category.id,
            storeId: store.id,
            productId: product.id,
            variantId: variant.id,
            inventoryId: inventory.id,
            orderId: order.id,
            paymentMethodId: payment.id,
            serieId: serie.id,
        };
    });
}

async function auxiliaryCount(
    table: "SystemSetting" | "MarketplaceCustomer" | "AuditLog" | "UserActivityLog",
): Promise<number> {
    const rows = await tenantPrisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
    );
    return Number(rows[0]?.count ?? 0n);
}

beforeAll(async () => {
    const migration = await platformPrisma.$queryRawUnsafe<Array<{
        migration_name: string;
    }>>(
        `SELECT migration_name
         FROM "_prisma_migrations"
         WHERE migration_name = '20260729241000_grant_tenant_runtime_identity'
           AND finished_at IS NOT NULL`,
    ).catch(() => []);
    userId = Number((await platformPrisma.user.findFirst({
        where: { isActive: true },
        orderBy: { id: "asc" },
        select: { id: true },
    }).catch(() => null))?.id ?? 0);
    dbReady = migration.length === 1 && userId > 0;
});

afterAll(async () => {
    if (tenantIds.length > 0) {
        for (const table of [
            "AuditLog",
            "UserActivityLog",
            "MarketplaceCustomer",
            "SystemSetting",
        ]) {
            await platformPrisma.$executeRawUnsafe(
                `DELETE FROM "${table}" WHERE "tenantId" = ANY($1::uuid[])`,
                tenantIds,
            ).catch(() => undefined);
        }
        await platformPrisma.comprobanteSerie.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await platformPrisma.orderItem.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await platformPrisma.order.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await platformPrisma.inventory.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await platformPrisma.productVariant.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await platformPrisma.product.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await platformPrisma.category.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await platformPrisma.store.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await platformPrisma.paymentMethod.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await platformPrisma.tenantMembership.deleteMany({
            where: { tenantId: { in: tenantIds } },
        }).catch(() => undefined);
        await platformPrisma.tenant.deleteMany({
            where: { id: { in: tenantIds } },
        }).catch(() => undefined);
    }
    await platformPrisma.$disconnect();
});

describe("TEN-010: matriz integral de aislamiento", () => {
    it("aísla A/B en catálogo, inventario, ventas, usuarios, marketplace, configuración, trazabilidad y SUNAT", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const companyA = await createCompany("A");
        const companyB = await createCompany("B");

        await inTenant(companyA.tenantId, async () => {
            expect(await tenantPrisma.category.findMany()).toHaveLength(1);
            expect(await tenantPrisma.product.findUnique({
                where: { id: companyB.productId },
            })).toBeNull();
            expect(await tenantPrisma.store.findUnique({
                where: { id: companyB.storeId },
            })).toBeNull();
            expect(await tenantPrisma.order.findUnique({
                where: { id: companyB.orderId },
            })).toBeNull();
            expect(await tenantPrisma.comprobanteSerie.findUnique({
                where: { id: companyB.serieId },
            })).toBeNull();
            expect(await tenantPrisma.tenantMembership.findFirst({
                where: { id: companyB.membershipId },
            })).toBeNull();

            expect(await tenantPrisma.inventory.updateMany({
                where: { id: companyB.inventoryId },
                data: { stock: 999 },
            })).toEqual({ count: 0 });
            expect(await tenantPrisma.paymentMethod.deleteMany({
                where: { id: companyB.paymentMethodId },
            })).toEqual({ count: 0 });
            expect(await auxiliaryCount("SystemSetting")).toBe(1);
            expect(await auxiliaryCount("MarketplaceCustomer")).toBe(1);
            expect(await auxiliaryCount("AuditLog")).toBe(1);
            expect(await auxiliaryCount("UserActivityLog")).toBe(1);

            await tenantPrisma.inventory.update({
                where: { id: companyA.inventoryId },
                data: { stock: 6 },
            });
        });

        await expect(inTenant(companyA.tenantId, () =>
            tenantPrisma.inventory.create({
                data: {
                    storeId: companyB.storeId,
                    variantId: companyB.variantId,
                    stock: 1,
                },
            }),
        )).rejects.toThrow(/tenant|constraint|foreign key/i);

        await inTenant(companyB.tenantId, async () => {
            expect((await tenantPrisma.inventory.findUnique({
                where: { id: companyB.inventoryId },
            }))?.stock).toBe(9);
            expect(await tenantPrisma.product.findUnique({
                where: { id: companyA.productId },
            })).toBeNull();
            expect(await tenantPrisma.category.count()).toBe(1);
            expect(await auxiliaryCount("SystemSetting")).toBe(1);
            expect(await auxiliaryCount("MarketplaceCustomer")).toBe(1);
            expect(await auxiliaryCount("AuditLog")).toBe(1);
            expect(await auxiliaryCount("UserActivityLog")).toBe(1);
        });
    }, 60_000);
});
