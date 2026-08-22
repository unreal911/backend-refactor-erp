import { createHash } from "node:crypto";
import {
    Prisma,
    TenantMigrationStatus,
} from "@prisma/client";
import { prisma } from "../../data/prisma";
import { LEGACY_TENANT_ID } from "./tenant-data-context";

const LEGACY_CATALOG_BASELINE = {
    categories: 4,
    colors: 3,
    sizes: 4,
    products: 2,
    images: 8,
    variants: 13,
    structuredMediaReferences: 20,
} as const;

type SealedCatalogIds = {
    categoryIds: number[];
    colorIds: number[];
    sizeIds: number[];
    productIds: number[];
    imageIds: number[];
    variantIds: number[];
};

export type CatalogReconciliationSummary = SealedCatalogIds & {
    categoryCount: number;
    colorCount: number;
    sizeCount: number;
    productCount: number;
    imageCount: number;
    variantCount: number;
    simpleProducts: number;
    sizeOnlyProducts: number;
    matrixProducts: number;
    mediaReferences: number;
    reachableMedia: number | null;
    fingerprints: {
        categories: string;
        colors: string;
        sizes: string;
        products: string;
        images: string;
        variants: string;
        logicalCatalog: string;
    };
};

function digest(value: unknown): string {
    return createHash("sha256")
        .update(JSON.stringify(value))
        .digest("hex");
}

function sealedIds(details: Prisma.JsonValue | null): SealedCatalogIds | null {
    if (!details || typeof details !== "object" || Array.isArray(details)) {
        return null;
    }
    const record = details as Record<string, unknown>;
    const keys = [
        "categoryIds",
        "colorIds",
        "sizeIds",
        "productIds",
        "imageIds",
        "variantIds",
    ] as const;
    const parsed = Object.fromEntries(keys.map((key) => [
        key,
        Array.isArray(record[key])
            ? record[key].filter(
                (value): value is number => Number.isInteger(value) && Number(value) > 0,
            )
            : [],
    ])) as SealedCatalogIds;
    return keys.every((key) => parsed[key].length > 0) ? parsed : null;
}

function productMode(product: {
    variants: Array<{ colorId: number | null; sizeId: number | null }>;
}): "SIMPLE" | "SIZE_ONLY" | "MATRIX" {
    const hasColor = product.variants.some((variant) => variant.colorId !== null);
    const hasSize = product.variants.some((variant) => variant.sizeId !== null);
    if (hasColor && hasSize) return "MATRIX";
    if (!hasColor && hasSize) return "SIZE_ONLY";
    return "SIMPLE";
}

function isCloudinaryUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:"
            && parsed.hostname === "res.cloudinary.com"
            && parsed.pathname.includes("/image/upload/");
    } catch {
        return false;
    }
}

async function checkMedia(urls: string[]): Promise<number> {
    const results: boolean[] = [];
    for (let index = 0; index < urls.length; index += 5) {
        const group = urls.slice(index, index + 5);
        results.push(...await Promise.all(group.map(async (url) => {
            try {
                const response = await fetch(url, {
                    method: "HEAD",
                    redirect: "follow",
                    signal: AbortSignal.timeout(10_000),
                });
                return response.ok;
            } catch {
                return false;
            }
        })));
    }
    return results.filter(Boolean).length;
}

export async function inspectCatalogMigration(
    options: { checkMedia?: boolean } = {},
): Promise<CatalogReconciliationSummary> {
    const checkpoint = await prisma.tenantMigrationCheckpoint.findUnique({
        where: {
            tenantId_storyId: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-004",
            },
        },
        select: { details: true },
    });
    const sealed = sealedIds(checkpoint?.details ?? null);

    const [categories, colors, sizes, products] = await Promise.all([
        prisma.category.findMany({
            where: {
                tenantId: LEGACY_TENANT_ID,
                ...(sealed ? { id: { in: sealed.categoryIds } } : {}),
            },
            orderBy: { id: "asc" },
        }),
        prisma.color.findMany({
            where: {
                tenantId: LEGACY_TENANT_ID,
                ...(sealed ? { id: { in: sealed.colorIds } } : {}),
            },
            orderBy: { id: "asc" },
        }),
        prisma.size.findMany({
            where: {
                tenantId: LEGACY_TENANT_ID,
                ...(sealed ? { id: { in: sealed.sizeIds } } : {}),
            },
            orderBy: { id: "asc" },
        }),
        prisma.product.findMany({
            where: {
                tenantId: LEGACY_TENANT_ID,
                ...(sealed ? { id: { in: sealed.productIds } } : {}),
            },
            orderBy: { id: "asc" },
            include: {
                category: true,
                images: {
                    where: sealed ? { id: { in: sealed.imageIds } } : {},
                    orderBy: { id: "asc" },
                },
                variants: {
                    where: sealed ? { id: { in: sealed.variantIds } } : {},
                    orderBy: { id: "asc" },
                    include: {
                        color: true,
                        size: true,
                    },
                },
            },
        }),
    ]);
    const images = products.flatMap((product) => product.images);
    const variants = products.flatMap((product) => product.variants);

    const counts = {
        categories: categories.length,
        colors: colors.length,
        sizes: sizes.length,
        products: products.length,
        images: images.length,
        variants: variants.length,
    };
    for (const [key, expected] of Object.entries(LEGACY_CATALOG_BASELINE)) {
        if (key === "structuredMediaReferences") continue;
        const actual = counts[key as keyof typeof counts];
        if (actual !== expected) {
            throw new Error(
                `Conteo ${key} no coincide con la línea base: ${actual}/${expected}`,
            );
        }
    }

    for (const product of products) {
        if (product.category.tenantId !== product.tenantId) {
            throw new Error(`Producto ${product.id} enlaza una categoría de otro tenant`);
        }
        if (product.variants.length === 0) {
            throw new Error(`Producto ${product.id} no conserva variantes`);
        }
        const mode = productMode(product);
        const expectedHasColor = mode === "MATRIX";
        const expectedHasSize = mode !== "SIMPLE";
        if (
            product.hasColor !== expectedHasColor
            || product.hasSize !== expectedHasSize
        ) {
            throw new Error(`Ejes de variación inconsistentes en producto ${product.id}`);
        }
        for (const image of product.images) {
            if (image.tenantId !== product.tenantId) {
                throw new Error(`Imagen ${image.id} pertenece a otro tenant`);
            }
        }
        for (const variant of product.variants) {
            const expectedVariantKey = `${variant.colorId ?? 0}-${variant.sizeId ?? 0}`;
            if (variant.variantKey !== expectedVariantKey) {
                throw new Error(`variantKey inválida en variante ${variant.id}`);
            }
            if (
                variant.tenantId !== product.tenantId
                || (variant.color && variant.color.tenantId !== product.tenantId)
                || (variant.size && variant.size.tenantId !== product.tenantId)
            ) {
                throw new Error(`Variante ${variant.id} contiene una relación cruzada`);
            }
        }
    }

    const mediaUrls = [
        ...images.map((image) => image.url),
        ...variants.flatMap((variant) => variant.imageUrl ? [variant.imageUrl] : []),
    ];
    if (mediaUrls.length !== LEGACY_CATALOG_BASELINE.structuredMediaReferences) {
        throw new Error(
            `Referencias de imagen inesperadas: ${mediaUrls.length}/`
            + LEGACY_CATALOG_BASELINE.structuredMediaReferences,
        );
    }
    const invalidMedia = mediaUrls.filter((url) => !isCloudinaryUrl(url));
    if (invalidMedia.length > 0) {
        throw new Error(`Existen ${invalidMedia.length} URLs Cloudinary inválidas`);
    }
    const reachableMedia = options.checkMedia
        ? await checkMedia(mediaUrls)
        : null;
    if (reachableMedia !== null && reachableMedia !== mediaUrls.length) {
        throw new Error(
            `Cloudinary no respondió para todas las imágenes: ${reachableMedia}/${mediaUrls.length}`,
        );
    }

    const categoryRows = categories.map((category) => ({
        id: category.id,
        tenantId: category.tenantId,
        name: category.name,
        isActive: category.isActive,
        createdAt: category.createdAt.toISOString(),
    }));
    const colorRows = colors.map((color) => ({
        id: color.id,
        tenantId: color.tenantId,
        name: color.name,
        hex: color.hex,
        isActive: color.isActive,
        createdAt: color.createdAt.toISOString(),
    }));
    const sizeRows = sizes.map((size) => ({
        id: size.id,
        tenantId: size.tenantId,
        name: size.name,
        isActive: size.isActive,
        createdAt: size.createdAt.toISOString(),
    }));
    const productRows = products.map((product) => ({
        id: product.id,
        tenantId: product.tenantId,
        name: product.name,
        description: product.description,
        afectacionIgv: product.afectacionIgv,
        hasColor: product.hasColor,
        hasSize: product.hasSize,
        isActive: product.isActive,
        categoryId: product.categoryId,
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
    }));
    const imageRows = images.map((image) => ({
        id: image.id,
        tenantId: image.tenantId,
        productId: image.productId,
        urlDigest: digest(image.url),
        createdAt: image.createdAt.toISOString(),
    }));
    const variantRows = variants.map((variant) => ({
        id: variant.id,
        tenantId: variant.tenantId,
        productId: variant.productId,
        colorId: variant.colorId,
        sizeId: variant.sizeId,
        variantKey: variant.variantKey,
        sku: variant.sku,
        barcode: variant.barcode,
        price: variant.price.toFixed(2),
        imageUrlDigest: variant.imageUrl ? digest(variant.imageUrl) : null,
        isActive: variant.isActive,
        createdAt: variant.createdAt.toISOString(),
        updatedAt: variant.updatedAt.toISOString(),
    }));
    const modes = products.map(productMode);

    return {
        categoryIds: categories.map((category) => category.id),
        colorIds: colors.map((color) => color.id),
        sizeIds: sizes.map((size) => size.id),
        productIds: products.map((product) => product.id),
        imageIds: images.map((image) => image.id),
        variantIds: variants.map((variant) => variant.id),
        categoryCount: categories.length,
        colorCount: colors.length,
        sizeCount: sizes.length,
        productCount: products.length,
        imageCount: images.length,
        variantCount: variants.length,
        simpleProducts: modes.filter((mode) => mode === "SIMPLE").length,
        sizeOnlyProducts: modes.filter((mode) => mode === "SIZE_ONLY").length,
        matrixProducts: modes.filter((mode) => mode === "MATRIX").length,
        mediaReferences: mediaUrls.length,
        reachableMedia,
        fingerprints: {
            categories: digest(categoryRows),
            colors: digest(colorRows),
            sizes: digest(sizeRows),
            products: digest(productRows),
            images: digest(imageRows),
            variants: digest(variantRows),
            logicalCatalog: digest({
                categoryRows,
                colorRows,
                sizeRows,
                productRows,
                imageRows,
                variantRows,
            }),
        },
    };
}

export async function reconcileCatalogMigration(
    options: { checkMedia?: boolean } = {},
): Promise<CatalogReconciliationSummary> {
    const checkpoint = await prisma.tenantMigrationCheckpoint.findUnique({
        where: {
            tenantId_storyId: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-004",
            },
        },
    });
    if (!checkpoint) throw new Error("No existe el checkpoint MIG-004");

    await prisma.tenantMigrationCheckpoint.update({
        where: { id: checkpoint.id },
        data: {
            status: TenantMigrationStatus.RUNNING,
            startedAt: checkpoint.startedAt ?? new Date(),
            completedAt: null,
        },
    });
    try {
        const summary = await inspectCatalogMigration(options);
        await prisma.tenantMigrationCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
                status: TenantMigrationStatus.COMPLETED,
                completedAt: new Date(),
                details: {
                    version: 1,
                    transformation: "IN_PLACE",
                    tenantId: LEGACY_TENANT_ID,
                    policy: "docs/migration/catalog-reconciliation-policy.md",
                    baselineReport:
                        "legacy-baseline-2026-07-29T16-27-05-069Z.json",
                    ...summary,
                } as Prisma.InputJsonObject,
            },
        });
        return summary;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.tenantMigrationCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
                status: TenantMigrationStatus.FAILED,
                completedAt: null,
                details: {
                    version: 1,
                    policy: "docs/migration/catalog-reconciliation-policy.md",
                    failure: message.slice(0, 500),
                },
            },
        }).catch(() => undefined);
        throw error;
    }
}
