import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { cloudinary } from "../src/config/cloudinary";
import { prisma, runTenantDatabaseTransaction } from "../src/data/prisma";
import { inspectCatalogMigration } from "../src/modules/tenant/catalog-reconciliation";
import { LEGACY_TENANT_ID } from "../src/modules/tenant/tenant-data-context";
import { ProductService } from "../src/presentation/services/product.service";

const tag = Date.now().toString(36);
let dbReady = false;
let reconciled = false;
let tenantBId = "";
let categoryBId = 0;
let colorBId = 0;
let sizeBId = 0;
let legacyTemporaryProductId = 0;
const productBIds: number[] = [];
const variantBIds: number[] = [];

const exclusiveUrl =
    `https://res.cloudinary.com/demo/image/upload/product_images/mig004-exclusive-${tag}.jpg`;
const sharedUrl =
    `https://res.cloudinary.com/demo/image/upload/product_images/mig004-shared-${tag}.jpg`;

async function inTenant<T>(tenantId: string, callback: () => Promise<T>): Promise<T> {
    return runTenantDatabaseTransaction(tenantId, () => callback());
}

beforeAll(async () => {
    const [migration, checkpoint] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
            `SELECT migration_name
             FROM "_prisma_migrations"
             WHERE migration_name = '20260729150000_tenant_scope_commerce'
               AND finished_at IS NOT NULL`,
        ).catch(() => []),
        prisma.tenantMigrationCheckpoint.findFirst({
            where: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-004",
                status: "COMPLETED",
            },
        }).catch(() => null),
    ]);
    dbReady = migration.length === 1;
    const details = checkpoint?.details as {
        version?: unknown;
        productIds?: unknown;
    } | null;
    reconciled = details?.version === 1 && Array.isArray(details.productIds);
    if (!dbReady) return;

    const [legacyCategory, legacyVariant] = await Promise.all([
        prisma.category.findFirst({
            where: { tenantId: LEGACY_TENANT_ID },
            orderBy: { id: "asc" },
        }),
        prisma.productVariant.findFirst({
            where: { tenantId: LEGACY_TENANT_ID },
            orderBy: { id: "asc" },
        }),
    ]);
    if (!legacyCategory || !legacyVariant) {
        dbReady = false;
        return;
    }

    const tenantB = await prisma.tenant.create({
        data: {
            slug: `mig004-${tag}`,
            name: `MIG004 ${tag}`,
            status: "SUSPENDED",
        },
    });
    tenantBId = tenantB.id;

    await inTenant(tenantBId, async () => {
        const category = await prisma.category.create({
            data: { name: legacyCategory.name },
        });
        const color = await prisma.color.create({
            data: { name: `MIG004 Color ${tag}`, hex: "#123456" },
        });
        const size = await prisma.size.create({
            data: { name: `MIG004 Size ${tag}` },
        });
        categoryBId = category.id;
        colorBId = color.id;
        sizeBId = size.id;

        const simple = await prisma.product.create({
            data: {
                name: `MIG004 Simple ${tag}`,
                categoryId: category.id,
                hasColor: false,
                hasSize: false,
                variants: {
                    create: {
                        sku: legacyVariant.sku,
                        price: 10,
                        variantKey: "0-0",
                    },
                },
            },
            include: { variants: true },
        });
        const sizeOnly = await prisma.product.create({
            data: {
                name: `MIG004 SizeOnly ${tag}`,
                categoryId: category.id,
                hasColor: false,
                hasSize: true,
                variants: {
                    create: {
                        sku: `MIG004-SIZE-${tag}`,
                        price: 20,
                        sizeId: size.id,
                        variantKey: `0-${size.id}`,
                    },
                },
            },
            include: { variants: true },
        });
        const matrix = await prisma.product.create({
            data: {
                name: `MIG004 Matrix ${tag}`,
                categoryId: category.id,
                hasColor: true,
                hasSize: true,
                variants: {
                    create: {
                        sku: `MIG004-MATRIX-${tag}`,
                        price: 30,
                        colorId: color.id,
                        sizeId: size.id,
                        variantKey: `${color.id}-${size.id}`,
                    },
                },
                images: {
                    create: [
                        { url: exclusiveUrl },
                        { url: sharedUrl },
                    ],
                },
            },
            include: { variants: true },
        });
        productBIds.push(simple.id, sizeOnly.id, matrix.id);
        variantBIds.push(
            simple.variants[0]!.id,
            sizeOnly.variants[0]!.id,
            matrix.variants[0]!.id,
        );
    });

    await inTenant(LEGACY_TENANT_ID, async () => {
        const product = await prisma.product.create({
            data: {
                name: `MIG004 Shared owner ${tag}`,
                categoryId: legacyCategory.id,
                hasColor: false,
                hasSize: false,
                images: {
                    create: { url: sharedUrl },
                },
            },
        });
        legacyTemporaryProductId = product.id;
    });
});

afterAll(async () => {
    vi.restoreAllMocks();
    if (legacyTemporaryProductId) {
        await prisma.product.deleteMany({
            where: { id: legacyTemporaryProductId },
        }).catch(() => undefined);
    }
    if (tenantBId) {
        await prisma.productImage.deleteMany({
            where: { tenantId: tenantBId },
        }).catch(() => undefined);
        await prisma.productVariant.deleteMany({
            where: { id: { in: variantBIds } },
        }).catch(() => undefined);
        await prisma.product.deleteMany({
            where: { id: { in: productBIds } },
        }).catch(() => undefined);
        await prisma.color.deleteMany({
            where: { id: colorBId },
        }).catch(() => undefined);
        await prisma.size.deleteMany({
            where: { id: sizeBId },
        }).catch(() => undefined);
        await prisma.category.deleteMany({
            where: { id: categoryBId },
        }).catch(() => undefined);
        await prisma.tenant.deleteMany({
            where: { id: tenantBId },
        }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
});

describe("MIG-004: conciliación de catálogo", () => {
    it("conserva conteos, relaciones, dimensiones y huellas del catálogo", async (ctx) => {
        if (!dbReady || !reconciled) return ctx.skip();

        const summary = await inspectCatalogMigration();
        expect(summary.categoryCount).toBe(4);
        expect(summary.colorCount).toBe(3);
        expect(summary.sizeCount).toBe(4);
        expect(summary.productCount).toBe(2);
        expect(summary.variantCount).toBe(13);
        expect(summary.imageCount).toBe(8);
        expect(summary.mediaReferences).toBe(20);
        expect(summary.simpleProducts).toBe(1);
        expect(summary.matrixProducts).toBe(1);
    });

    it("permite reutilizar nombre y SKU entre tenants", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const [legacyCategory, legacyVariant, tenantCategory, tenantVariant] =
            await Promise.all([
                prisma.category.findFirst({
                    where: { tenantId: LEGACY_TENANT_ID },
                    orderBy: { id: "asc" },
                }),
                prisma.productVariant.findFirst({
                    where: { tenantId: LEGACY_TENANT_ID },
                    orderBy: { id: "asc" },
                }),
                inTenant(tenantBId, () => prisma.category.findUnique({
                    where: { id: categoryBId },
                })),
                inTenant(tenantBId, () => prisma.productVariant.findUnique({
                    where: { id: variantBIds[0]! },
                })),
            ]);
        expect(tenantCategory?.name).toBe(legacyCategory?.name);
        expect(tenantVariant?.sku).toBe(legacyVariant?.sku);
    });

    it("expone SIMPLE, SIZE_ONLY y MATRIX en catálogo administrativo y público", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const service = new ProductService();
        const [admin, publicCatalog] = await inTenant(tenantBId, async () =>
            await Promise.all([
                service.listProducts({
                    skip: 1,
                    take: 10,
                    search: `MIG004`,
                    isActive: true,
                } as never),
                service.listPublicProducts({
                    skip: 1,
                    take: 10,
                    search: `MIG004`,
                    allowBackorder: true,
                } as never),
            ]),
        );
        const adminModes = new Set(
            admin.data.map((product: { variantMode: string }) => product.variantMode),
        );
        expect(adminModes).toEqual(new Set(["SIMPLE", "SIZE_ONLY", "MATRIX"]));
        expect(publicCatalog.data).toHaveLength(3);
    });

    it("rechaza borrar el public ID exclusivo de otra empresa", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const destroy = vi.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({
            result: "ok",
        } as never);
        await expect(inTenant(
            LEGACY_TENANT_ID,
            () => new ProductService().deleteImageFromCloudinary(
                `mig004-exclusive-${tag}`,
            ),
        )).rejects.toThrow("no pertenece al tenant activo");
        expect(destroy).not.toHaveBeenCalled();
        destroy.mockRestore();
    });

    it("al reemplazar una imagen compartida conserva el objeto usado por B", async (ctx) => {
        if (!dbReady) return ctx.skip();

        const destroy = vi.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({
            result: "ok",
        } as never);
        const service = new ProductService() as unknown as {
            replaceProductImages(
                productId: number,
                imageUrls: string[],
                imageFiles: unknown[],
            ): Promise<void>;
        };
        await inTenant(
            LEGACY_TENANT_ID,
            () => service.replaceProductImages(legacyTemporaryProductId, [], []),
        );

        expect(destroy).not.toHaveBeenCalled();
        expect(await inTenant(tenantBId, () => prisma.productImage.count({
            where: { url: sharedUrl },
        }))).toBe(1);
        const legacyReferences = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*)::bigint AS count
             FROM "ProductImage"
             WHERE "tenantId" = $1::uuid
               AND "url" = $2`,
            LEGACY_TENANT_ID,
            sharedUrl,
        );
        expect(Number(legacyReferences[0]?.count ?? 0n)).toBe(0);
    });
});
