import { CreateProductDto } from "../../domain/dtos/create-product.dto";
import { UpdateProductDto } from "../../domain/dtos/update-product.dto";
import { ListProductDto } from "../../domain/dtos/list-product.dto";
import { PublicListProductDto } from "../../domain/dtos/public-list-product.dto";
import { GenerateVariantsDto } from "../../domain/dtos/generate-variants.dto";
import { prisma } from "../../data/prisma";
import { Prisma } from "@prisma/client";
import { CustomError } from "../../domain/errors/custom.error";
import { ProductEntity } from "../../domain/entities/product.entity";
import { ProductVariantEntity } from "../../domain/entities/product-variant.entity";
import { ProductImageEntity } from "../../domain/entities/product-image.entity";
import { cloudinary } from "../../config/cloudinary";

type MarketplaceSimpleVariantConfig = {
    colorIds: number[];
    sizeIds: number[];
    colorImages?: Array<{ colorId: number; imageUrl: string }>;
};

type MarketplaceColorImageInput = {
    colorId: number;
    imageUrl?: string;
    imageFile?: { filename: string; data: string };
};

export class ProductService {
    private readonly simpleColorName = '__SIN_COLOR__';
    private readonly simpleSizeName = '__SIN_TALLA__';
    private readonly simpleColorHex = '#9CA3AF';
    private readonly marketplaceVariantSettingKeyPrefix = 'marketplace_product_variants_';

    constructor() { }

    /**
     * Normalizar valores para SKU
     */
    private normalizeSkuComponent(value: string): string {
        return value
            .trim()
            .toUpperCase()
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .replace(/[^A-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    /**
     * Generar SKU único
     * Formato: PROD-{PRODUCTNAME}-{COLORNAME}-{SIZENAME}-{PRODUCTID}-{COLORID}-{SIZEID}
     */
    private generateSKU(productName: string, colorName: string, sizeName: string, productId: number, colorId: number, sizeId: number): string {
        const normalizedName = this.normalizeSkuComponent(productName);
        const normalizedColor = this.normalizeSkuComponent(colorName);
        const normalizedSize = this.normalizeSkuComponent(sizeName);

        return `PROD-${normalizedName}-${normalizedColor}-${normalizedSize}-${productId.toString().padStart(5, '0')}-${colorId.toString().padStart(3, '0')}-${sizeId.toString().padStart(3, '0')}`;
    }

    /**
     * Validar que una categoría existe
     */
    private async validateCategory(categoryId: number): Promise<void> {
        const category = await prisma.category.findUnique({
            where: { id: categoryId },
        });
        if (!category) {
            throw CustomError.badRequest(`La categoría con ID ${categoryId} no existe`);
        }
    }

    /**
     * Validar que los colores existan
     */
    private async validateColors(colorIds: number[]): Promise<void> {
        const colors = await prisma.color.findMany({
            where: { id: { in: colorIds }, isActive: true },
        });
        if (colors.length !== colorIds.length) {
            throw CustomError.badRequest('Uno o más colores seleccionados no existen o están inactivos');
        }
    }

    /**
     * Validar que las tallas existan
     */
    private async validateSizes(sizeIds: number[]): Promise<void> {
        const sizes = await prisma.size.findMany({
            where: { id: { in: sizeIds }, isActive: true },
        });
        if (sizes.length !== sizeIds.length) {
            throw CustomError.badRequest('Una o más tallas seleccionadas no existen o están inactivas');
        }
    }

    private async ensureSimpleColor(): Promise<{ id: number; name: string }> {
        const color = await prisma.color.upsert({
            where: { name: this.simpleColorName },
            update: { isActive: false, hex: this.simpleColorHex },
            create: { name: this.simpleColorName, hex: this.simpleColorHex, isActive: false },
        });

        return {
            id: color.id,
            name: color.name,
        };
    }

    private async ensureSimpleSize(): Promise<{ id: number; name: string }> {
        const size = await prisma.size.upsert({
            where: { name: this.simpleSizeName },
            update: { isActive: false },
            create: { name: this.simpleSizeName, isActive: false },
        });

        return {
            id: size.id,
            name: size.name,
        };
    }

    private async ensureSimpleVariantDimensions(): Promise<{ colorId: number; sizeId: number; colorName: string; sizeName: string }> {
        const [color, size] = await Promise.all([
            this.ensureSimpleColor(),
            this.ensureSimpleSize(),
        ]);

        return {
            colorId: color.id,
            sizeId: size.id,
            colorName: color.name,
            sizeName: size.name,
        };
    }

    private isSimpleVariantByNames(colorName?: string | null, sizeName?: string | null): boolean {
        return colorName === this.simpleColorName && sizeName === this.simpleSizeName;
    }

    private isSizeOnlyVariantByNames(colorName?: string | null, sizeName?: string | null): boolean {
        return colorName === this.simpleColorName && sizeName !== this.simpleSizeName;
    }

    private buildMarketplaceVariantSettingKey(productId: number): string {
        return `${this.marketplaceVariantSettingKeyPrefix}${productId}`;
    }

    private parseMarketplaceSimpleVariantConfig(raw: string | null | undefined): MarketplaceSimpleVariantConfig | null {
        if (!raw) return null;

        try {
            const parsed = JSON.parse(raw) as { colorIds?: unknown; sizeIds?: unknown; colorImages?: unknown };
            const colorIds = Array.isArray(parsed?.colorIds)
                ? parsed.colorIds
                    .map((id) => Number(id))
                    .filter((id) => Number.isInteger(id) && id > 0)
                : [];
            const sizeIds = Array.isArray(parsed?.sizeIds)
                ? parsed.sizeIds
                    .map((id) => Number(id))
                    .filter((id) => Number.isInteger(id) && id > 0)
                : [];
            const colorImages = Array.isArray(parsed?.colorImages)
                ? parsed.colorImages
                    .map((item: any) => ({
                        colorId: Number(item?.colorId || 0),
                        imageUrl: String(item?.imageUrl || '').trim(),
                    }))
                    .filter((item) => Number.isInteger(item.colorId) && item.colorId > 0 && item.imageUrl)
                : [];

            if (!colorIds.length || !sizeIds.length) {
                return null;
            }

            return {
                colorIds: Array.from(new Set(colorIds)),
                sizeIds: Array.from(new Set(sizeIds)),
                colorImages: colorImages.length ? colorImages : [],
            };
        } catch {
            return null;
        }
    }

    private async getMarketplaceSimpleVariantConfig(productId: number): Promise<MarketplaceSimpleVariantConfig | null> {
        const key = this.buildMarketplaceVariantSettingKey(productId);
        const rows = await prisma.$queryRaw<Array<{ value: string }>>(
            Prisma.sql`SELECT "value" FROM "SystemSetting" WHERE "key" = ${key} LIMIT 1`,
        );
        return this.parseMarketplaceSimpleVariantConfig(rows[0]?.value);
    }

    private async getMarketplaceSimpleVariantConfigs(productIds: number[]): Promise<Map<number, MarketplaceSimpleVariantConfig>> {
        const uniqueProductIds = Array.from(new Set(productIds.filter((id) => Number.isInteger(id) && id > 0)));
        const result = new Map<number, MarketplaceSimpleVariantConfig>();
        if (!uniqueProductIds.length) {
            return result;
        }

        const keys = uniqueProductIds.map((productId) => this.buildMarketplaceVariantSettingKey(productId));
        const rows = await prisma.$queryRaw<Array<{ key: string; value: string }>>(
            Prisma.sql`
                SELECT "key", "value"
                FROM "SystemSetting"
                WHERE "key" IN (${Prisma.join(keys)})
            `,
        );

        for (const row of rows) {
            const key = String(row?.key || '');
            if (!key.startsWith(this.marketplaceVariantSettingKeyPrefix)) continue;
            const rawProductId = Number(key.slice(this.marketplaceVariantSettingKeyPrefix.length));
            if (!Number.isInteger(rawProductId) || rawProductId < 1) continue;

            const parsed = this.parseMarketplaceSimpleVariantConfig(row?.value);
            if (parsed) {
                result.set(rawProductId, parsed);
            }
        }

        return result;
    }

    private async upsertMarketplaceSimpleVariantConfig(productId: number, config: MarketplaceSimpleVariantConfig | null): Promise<void> {
        const key = this.buildMarketplaceVariantSettingKey(productId);
        if (!config || !config.colorIds.length || !config.sizeIds.length) {
            await prisma.$executeRaw(
                Prisma.sql`DELETE FROM "SystemSetting" WHERE "key" = ${key}`,
            );
            return;
        }

        const payload = JSON.stringify({
            colorIds: Array.from(new Set(config.colorIds)),
            sizeIds: Array.from(new Set(config.sizeIds)),
            colorImages: (config.colorImages || [])
                .filter((item) => config.colorIds.includes(Number(item.colorId)) && String(item.imageUrl || '').trim())
                .map((item) => ({
                    colorId: Number(item.colorId),
                    imageUrl: String(item.imageUrl).trim(),
                })),
        });

        await prisma.$executeRaw(
            Prisma.sql`
                INSERT INTO "SystemSetting" ("key", "value")
                VALUES (${key}, ${payload})
                ON CONFLICT ("key") DO UPDATE
                SET "value" = EXCLUDED."value",
                    "updatedAt" = CURRENT_TIMESTAMP
            `,
        );
    }

    private mapVariantForResponse(variant: any) {
        const colorName = variant?.color?.name ?? null;
        const sizeName = variant?.size?.name ?? null;
        const isSimpleVariant = this.isSimpleVariantByNames(colorName, sizeName);

        return {
            ...ProductVariantEntity.fromObject(variant),
            color: (isSimpleVariant || this.isSizeOnlyVariantByNames(colorName, sizeName)) ? null : variant.color,
            size: isSimpleVariant ? null : variant.size,
            isSimpleVariant,
            isSizeOnlyVariant: this.isSizeOnlyVariantByNames(colorName, sizeName),
        };
    }

    private resolveProductVariantMode(variants: any[]): 'MATRIX' | 'SIMPLE' | 'SIZE_ONLY' {
        if (!Array.isArray(variants) || variants.length === 0) {
            return 'MATRIX';
        }

        const allSimple = variants.every((variant: any) => this.isSimpleVariantByNames(variant?.color?.name, variant?.size?.name));
        if (allSimple) {
            return 'SIMPLE';
        }

        const allSizeOnly = variants.every((variant: any) => this.isSizeOnlyVariantByNames(variant?.color?.name, variant?.size?.name));
        return allSizeOnly ? 'SIZE_ONLY' : 'MATRIX';
    }

    private buildSyntheticMarketplaceVariantId(baseVariantId: number, colorId: number, sizeId: number): number {
        return (Number(baseVariantId) * 1_000_000) + (Number(colorId) * 1_000) + Number(sizeId);
    }

    private buildPublicVariantsForSimpleMode(
        baseVariant: any,
        availableStock: number,
        reservedStock: number,
        colors: Array<{ id: number; name: string; hex?: string | null }>,
        sizes: Array<{ id: number; name: string }>,
        colorImages: Array<{ colorId: number; imageUrl: string }> = [],
    ) {
        const imageByColorId = new Map(
            colorImages
                .filter((item) => Number.isInteger(Number(item.colorId)) && String(item.imageUrl || '').trim())
                .map((item) => [Number(item.colorId), String(item.imageUrl).trim()]),
        );
        const result: Array<{
            id: number;
            sourceVariantId: number;
            sku: string;
            barcode?: string | null;
            price: number;
            imageUrl?: string | null;
            color: { id: number; name: string; hex?: string | null } | null;
            size: { id: number; name: string } | null;
            availableStock: number;
            reservedStock: number;
            isSimpleVariant?: boolean;
            isSizeOnlyVariant?: boolean;
            isVirtualMarketplaceVariant?: boolean;
        }> = [];

        for (const color of colors) {
            for (const size of sizes) {
                result.push({
                    id: this.buildSyntheticMarketplaceVariantId(baseVariant.id, color.id, size.id),
                    sourceVariantId: Number(baseVariant.id),
                    sku: `${baseVariant.sku || `VAR-${baseVariant.id}`}-MK-${color.id}-${size.id}`,
                    barcode: baseVariant.barcode ?? null,
                    price: Number(baseVariant.price || 0),
                    imageUrl: imageByColorId.get(Number(color.id)) || baseVariant.imageUrl || null,
                    color: { id: color.id, name: color.name, hex: color.hex ?? null },
                    size: { id: size.id, name: size.name },
                    availableStock: Number(availableStock || 0),
                    reservedStock: Number(reservedStock || 0),
                    isSimpleVariant: false,
                    isSizeOnlyVariant: false,
                    isVirtualMarketplaceVariant: true,
                });
            }
        }

        return result;
    }

    /**
     * Generar todas las combinaciones posibles de variantes (producto cartesiano)
     */
    private generateVariantCombinations(
        colorIds: number[],
        sizeIds: number[],
    ): Array<{ colorId: number; sizeId: number }> {
        const combinations: Array<{ colorId: number; sizeId: number }> = [];
        for (const colorId of colorIds) {
            for (const sizeId of sizeIds) {
                combinations.push({ colorId, sizeId });
            }
        }
        return combinations;
    }

    private async resolveSimpleMarketplaceConfig(
        variantMode: 'MATRIX' | 'SIMPLE' | 'SIZE_ONLY',
        colorIds: number[],
        sizeIds: number[],
    ): Promise<MarketplaceSimpleVariantConfig | null> {
        if (variantMode !== 'SIMPLE') {
            return null;
        }

        const uniqueColorIds = Array.from(new Set((colorIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));
        const uniqueSizeIds = Array.from(new Set((sizeIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));

        if (uniqueColorIds.length === 0 && uniqueSizeIds.length === 0) {
            return null;
        }

        if (uniqueColorIds.length === 0 || uniqueSizeIds.length === 0) {
            throw CustomError.badRequest('Para variantes marketplace en producto unico debes seleccionar color y talla');
        }

        await this.validateColors(uniqueColorIds);
        await this.validateSizes(uniqueSizeIds);

        return {
            colorIds: uniqueColorIds,
            sizeIds: uniqueSizeIds,
        };
    }

    private async uploadBase64Image(data: string, publicId: string): Promise<string> {
        const payload = data.startsWith('data:') ? data : `data:image/jpeg;base64,${data}`;

        try {
            const uploadResult = await cloudinary.uploader.upload(payload, {
                folder: 'product_images',
                public_id: publicId,
                overwrite: true,
                resource_type: 'image',
            });

            return uploadResult.secure_url;
        } catch (error) {
            console.error('Error subiendo imagen a Cloudinary:', error);
            throw CustomError.internal('Error al subir la imagen');
        }
    }

    private extractPublicIdFromUrl(url: string): string | null {
        try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            const filenameWithExt = pathParts[pathParts.length - 1];
        if (!filenameWithExt) {
            return null;
        }

            const filename = filenameWithExt ? (filenameWithExt.split('?')[0] ?? '') : '';
            const publicId = filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) : filename;
            const folder = pathParts[pathParts.length - 2];

            if (!folder || !publicId) {
                return null;
            }

            return `${folder}/${publicId}`;
        } catch {
            return null;
        }
    }

    private async deleteCloudinaryUrl(url: string): Promise<void> {
        const publicId = this.extractPublicIdFromUrl(url);
        if (!publicId) {
            return;
        }

        try {
            await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
            console.log(`Imagen ${publicId} eliminada de Cloudinary`);
        } catch (error) {
            console.error(`Error eliminando imagen de Cloudinary ${publicId}:`, error);
        }
    }

    async deleteImageFromCloudinary(publicId: string): Promise<void> {
        try {
            await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
            await prisma.productImage.deleteMany({ where: { url: { contains: publicId } } });
            console.log(`Imagen ${publicId} eliminada de Cloudinary y de la base de datos`);
        } catch (error) {
            console.error('Error eliminando imagen de Cloudinary:', error);
            throw CustomError.internal('Error al eliminar la imagen');
        }
    }

    private async uploadProductFiles(productId: number, imageFiles: Array<{ filename: string; data: string }> = []): Promise<string[]> {
        if (!imageFiles || imageFiles.length === 0) {
            return [];
        }

        const urls: string[] = [];
        for (const file of imageFiles) {
            const publicId = `product_${productId}_${file.filename.replace(/\.[^/.]+$/, '')}`;
            const uploadedUrl = await this.uploadBase64Image(file.data, publicId);
            urls.push(uploadedUrl);
        }

        return urls;
    }

    private async uploadVariantImage(productId: number, variant: { colorId: number; sizeId: number; imageUrl?: string; imageFile?: { filename: string; data: string } }): Promise<string | null> {
        if (variant.imageFile) {
            const publicId = `product_${productId}_variant_${variant.colorId}_${variant.sizeId}_${variant.imageFile.filename.replace(/\.[^/.]+$/, '')}`;
            return await this.uploadBase64Image(variant.imageFile.data, publicId);
        }

        return variant.imageUrl ? variant.imageUrl : null;
    }

    private async resolveMarketplaceColorImages(
        productId: number,
        colorIds: number[],
        images: MarketplaceColorImageInput[] = [],
    ): Promise<Array<{ colorId: number; imageUrl: string }>> {
        const allowedColorIds = new Set(
            (colorIds || [])
                .map((id) => Number(id))
                .filter((id) => Number.isInteger(id) && id > 0),
        );
        const byColor = new Map<number, string>();

        for (const image of images || []) {
            const colorId = Number(image?.colorId || 0);
            if (!allowedColorIds.has(colorId)) {
                continue;
            }

            let imageUrl = String(image.imageUrl || '').trim();
            if (image.imageFile) {
                const filename = image.imageFile.filename.replace(/\.[^/.]+$/, '');
                imageUrl = await this.uploadBase64Image(
                    image.imageFile.data,
                    `product_${productId}_marketplace_color_${colorId}_${filename}`,
                );
            }

            if (imageUrl) {
                byColor.set(colorId, imageUrl);
            }
        }

        return Array.from(byColor.entries()).map(([colorId, imageUrl]) => ({ colorId, imageUrl }));
    }

    /**
     * Crear un nuevo producto con variantes e imágenes
     */
    async createProduct(createProductDto: CreateProductDto): Promise<any> {
        const {
            name,
            categoryId,
            description,
            variantMode,
            colorIds = [],
            sizeIds = [],
            imageUrls = [],
            imageFiles = [],
            variants = [],
            marketplaceColorImages = [],
        } = createProductDto;

        console.log('Creando producto con datos:', {
            name,
            categoryId,
            description,
            variantMode,
            colorIds,
            sizeIds,
            imageUrls,
            imageFilesCount: imageFiles.length,
            variantsCount: variants.length
        });

        try {
            // Validar que la categoría existe
            await this.validateCategory(categoryId);

            // Validar que hay variantes
            if (variants.length === 0) {
                throw CustomError.badRequest('Debe haber al menos una variante para crear el producto');
            }

            const isSimpleMode = variantMode === 'SIMPLE';
            const isSizeOnlyMode = variantMode === 'SIZE_ONLY';
            const simpleMarketplaceConfig = await this.resolveSimpleMarketplaceConfig(variantMode, colorIds, sizeIds);
            let variantsToCreate: Array<{
                colorId: number;
                sizeId: number;
                price: number;
                isActive?: boolean;
                imageUrl?: string;
                imageFile?: { filename: string; data: string };
            }> = [];

            let colorById = new Map<number, string>();
            let sizeById = new Map<number, string>();

            if (isSimpleMode) {
                const simpleDimensions = await this.ensureSimpleVariantDimensions();
                const baseVariant = variants[0];

                if (!baseVariant) {
                    throw CustomError.badRequest('Debe enviar una variante base para el modo SIMPLE');
                }

                const simpleVariant: {
                    colorId: number;
                    sizeId: number;
                    price: number;
                    isActive?: boolean;
                    imageUrl?: string;
                    imageFile?: { filename: string; data: string };
                } = {
                    colorId: simpleDimensions.colorId,
                    sizeId: simpleDimensions.sizeId,
                    price: Number(baseVariant.price),
                    isActive: baseVariant.isActive !== false,
                };

                if (baseVariant.imageUrl) {
                    simpleVariant.imageUrl = baseVariant.imageUrl;
                }

                if (baseVariant.imageFile) {
                    simpleVariant.imageFile = baseVariant.imageFile;
                }

                variantsToCreate = [simpleVariant];
                colorById.set(simpleDimensions.colorId, simpleDimensions.colorName);
                sizeById.set(simpleDimensions.sizeId, simpleDimensions.sizeName);
            } else if (isSizeOnlyMode) {
                await this.validateSizes(sizeIds);

                const simpleColor = await this.ensureSimpleColor();
                const uniqueSizeIds = [...new Set(variants.map((variant) => Number(variant.sizeId || 0)).filter((id) => id > 0))];
                await this.validateSizes(uniqueSizeIds);

                variantsToCreate = variants.map((variant) => {
                    const sizeOnlyVariant: {
                        colorId: number;
                        sizeId: number;
                        price: number;
                        isActive?: boolean;
                        imageUrl?: string;
                        imageFile?: { filename: string; data: string };
                    } = {
                        colorId: simpleColor.id,
                        sizeId: Number(variant.sizeId),
                        price: Number(variant.price),
                        isActive: variant.isActive !== false,
                    };

                    if (variant.imageUrl) {
                        sizeOnlyVariant.imageUrl = variant.imageUrl;
                    }

                    if (variant.imageFile) {
                        sizeOnlyVariant.imageFile = variant.imageFile;
                    }

                    return sizeOnlyVariant;
                });

                const sizeRecords = await prisma.size.findMany({ where: { id: { in: uniqueSizeIds } } });
                colorById.set(simpleColor.id, simpleColor.name);
                sizeById = new Map(sizeRecords.map((size) => [size.id, size.name]));
            } else {
                // Validar que los colores existen
                await this.validateColors(colorIds);

                // Validar que las tallas existen
                await this.validateSizes(sizeIds);

                variantsToCreate = variants.map((variant) => {
                    const matrixVariant: {
                        colorId: number;
                        sizeId: number;
                        price: number;
                        isActive?: boolean;
                        imageUrl?: string;
                        imageFile?: { filename: string; data: string };
                    } = {
                        colorId: Number(variant.colorId),
                        sizeId: Number(variant.sizeId),
                        price: Number(variant.price),
                        isActive: variant.isActive !== false,
                    };

                    if (variant.imageUrl) {
                        matrixVariant.imageUrl = variant.imageUrl;
                    }

                    if (variant.imageFile) {
                        matrixVariant.imageFile = variant.imageFile;
                    }

                    return matrixVariant;
                });

                const uniqueColorIds = [...new Set(variantsToCreate.map((variant) => variant.colorId))];
                const uniqueSizeIds = [...new Set(variantsToCreate.map((variant) => variant.sizeId))];
                const colorRecords = await prisma.color.findMany({ where: { id: { in: uniqueColorIds } } });
                const sizeRecords = await prisma.size.findMany({ where: { id: { in: uniqueSizeIds } } });
                colorById = new Map(colorRecords.map((color) => [color.id, color.name]));
                sizeById = new Map(sizeRecords.map((size) => [size.id, size.name]));
            }

            const now = new Date();

            // Crear el producto
            const product = await prisma.product.create({
                data: {
                    name,
                    description: description || null,
                    categoryId,
                    isActive: true,
                    updatedAt: now,
                },
            });

            const marketplaceColorImageConfig = simpleMarketplaceConfig
                ? await this.resolveMarketplaceColorImages(product.id, simpleMarketplaceConfig.colorIds, marketplaceColorImages)
                : [];
            await this.upsertMarketplaceSimpleVariantConfig(product.id, simpleMarketplaceConfig
                ? { ...simpleMarketplaceConfig, colorImages: marketplaceColorImageConfig }
                : null);

            // Subir imágenes de producto a Cloudinary si se recibieron archivos
            const uploadedProductImageUrls = await this.uploadProductFiles(product.id, imageFiles);
            const allImageUrls = [...new Set([...(imageUrls || []), ...uploadedProductImageUrls])];

            // Crear las imágenes del producto
            if (allImageUrls.length > 0) {
                await prisma.productImage.createMany({
                    data: allImageUrls.map((url: string) => ({
                        url,
                        productId: product.id,
                    })),
                });
            }

            const createdVariants = await Promise.all(
                variantsToCreate.map(async (variant) => {
                    const imageUrl = await this.uploadVariantImage(product.id, variant);
                    const colorName = colorById.get(variant.colorId) ?? '';
                    const sizeName = sizeById.get(variant.sizeId) ?? '';
                    return prisma.productVariant.create({
                        data: {
                            sku: this.generateSKU(product.name, colorName, sizeName, product.id, variant.colorId, variant.sizeId),
                            price: new Prisma.Decimal(String(variant.price)),
                            colorId: variant.colorId,
                            sizeId: variant.sizeId,
                            imageUrl: imageUrl || null,
                            productId: product.id,
                            isActive: variant.isActive !== false,
                            updatedAt: now,
                        },
                    });
                }),
            );

            return {
                product: {
                    ...ProductEntity.fromObject(product),
                    variantCount: createdVariants.length,
                    imageCount: allImageUrls.length,
                    variantMode,
                    marketplaceVariantColorIds: simpleMarketplaceConfig?.colorIds || [],
                    marketplaceVariantSizeIds: simpleMarketplaceConfig?.sizeIds || [],
                    marketplaceColorImages: marketplaceColorImageConfig,
                },
                variants: createdVariants.map(v => ProductVariantEntity.fromObject(v)),
                images: allImageUrls,
                message: isSimpleMode
                    ? `Producto "${name}" creado exitosamente como producto unico`
                    : isSizeOnlyMode
                        ? `Producto "${name}" creado exitosamente como producto con talla`
                    : `Producto "${name}" creado exitosamente con ${createdVariants.length} variantes`,
            };
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            console.error('Error al crear el producto:', error);
            throw CustomError.internal('Error al crear el producto');
        }
    }

    /**
     * Generar automáticamente variantes basadas en colores y tallas seleccionados
     */
    async generateVariants(generateVariantsDto: GenerateVariantsDto): Promise<Array<{ colorId: number; sizeId: number }>> {
        const { colorIds, sizeIds } = generateVariantsDto;

        try {
            // Validar que los colores existen
            await this.validateColors(colorIds);

            // Validar que las tallas existen
            await this.validateSizes(sizeIds);

            // Generar todas las combinaciones
            const combinations = this.generateVariantCombinations(colorIds, sizeIds);

            return combinations;
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            throw CustomError.internal('Error al generar variantes');
        }
    }

    /**
     * Listar productos con búsqueda y filtros
     */
    async listProducts(listProductDto: ListProductDto): Promise<any> {
        const { skip = 1, take = 10, search, isActive = true } = listProductDto;

        try {
            const where: any = {};

            // Filtro por estado
            if (isActive !== undefined) {
                where.isActive = isActive;
            }

            // Búsqueda parcial por nombre
            if (search && search.trim() !== '') {
                where.name = {
                    contains: search.trim(),
                    mode: 'insensitive',
                };
            }

            // Obtener productos con sus relaciones
            const products = await prisma.product.findMany({
                where,
                skip: (skip - 1) * take,
                take,
                include: {
                    category: true,
                    variants: {
                        where: { isActive: true },
                        include: {
                            color: true,
                            size: true,
                        },
                    },
                    images: true,
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            // Contar total de productos
            const total = await prisma.product.count({ where });
            const marketplaceConfigByProductId = await this.getMarketplaceSimpleVariantConfigs(
                products.map((product) => Number(product.id)),
            );

            // Mapear a entidades
            const mappedProducts = products.map((product: any) => {
                const mappedVariants = (product.variants || []).map((variant: any) => this.mapVariantForResponse(variant));
                const marketplaceConfig = marketplaceConfigByProductId.get(Number(product.id));
                return {
                    ...ProductEntity.fromObject(product),
                    category: product.category,
                    variantCount: mappedVariants.length,
                    imageCount: product.images?.length || 0,
                    variantMode: this.resolveProductVariantMode(product.variants || []),
                    marketplaceVariantColorIds: marketplaceConfig?.colorIds || [],
                    marketplaceVariantSizeIds: marketplaceConfig?.sizeIds || [],
                    marketplaceColorImages: marketplaceConfig?.colorImages || [],
                    variants: mappedVariants,
                    images: (product.images || []).map((i: any) => ProductImageEntity.fromObject(i)),
                };
            });

            return {
                data: mappedProducts,
                total,
                page: skip,
                limit: take,
                hasMore: (skip * take) < total,
            };
        } catch (error) {
            console.error('Error al listar productos:', error);
            throw CustomError.internal('Error al listar productos');
        }
    }

    /**
     * Obtener detalles de un producto específico
     */
    async getProductById(id: number): Promise<any> {
        try {
            const product = await (prisma.product as any).findUnique({
                where: { id },
                include: {
                    category: true,
                    variants: {
                        where: { isActive: true },
                        include: {
                            color: true,
                            size: true,
                        },
                    },
                    images: true,
                },
            });

            if (!product) {
                throw CustomError.notFound(`El producto con ID ${id} no existe`);
            }

            const mappedVariants = (product.variants || []).map((variant: any) => this.mapVariantForResponse(variant));
            const marketplaceConfig = await this.getMarketplaceSimpleVariantConfig(id);

            return {
                ...ProductEntity.fromObject(product),
                category: product.category,
                variantCount: mappedVariants.length,
                imageCount: (product.images || []).length,
                variantMode: this.resolveProductVariantMode(product.variants || []),
                marketplaceVariantColorIds: marketplaceConfig?.colorIds || [],
                marketplaceVariantSizeIds: marketplaceConfig?.sizeIds || [],
                marketplaceColorImages: marketplaceConfig?.colorImages || [],
                variants: mappedVariants,
                images: (product.images || []).map((i: any) => ProductImageEntity.fromObject(i)),
            };
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            console.error('Error al obtener el producto:', error);
            throw CustomError.internal('Error al obtener el producto');
        }
    }

    async listPublicProducts(dto: PublicListProductDto): Promise<any> {
        const { skip, take, search, categoryId, colorId, sizeId, inStock, allowBackorder } = dto;

        const where: Prisma.ProductWhereInput = {
            isActive: true,
            variants: {
                some: {
                    isActive: true,
                },
            },
        };

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ];
        }

        if (categoryId) {
            where.categoryId = categoryId;
        }

        const products = await prisma.product.findMany({
            where,
            include: {
                category: true,
                images: true,
                variants: {
                    where: { isActive: true },
                    include: {
                        color: true,
                        size: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        const marketplaceConfigByProductId = await this.getMarketplaceSimpleVariantConfigs(
            products.map((product) => Number(product.id)),
        );
        const allMarketplaceColorIds = Array.from(
            new Set(
                Array.from(marketplaceConfigByProductId.values()).flatMap((config) => config.colorIds),
            ),
        );
        const allMarketplaceSizeIds = Array.from(
            new Set(
                Array.from(marketplaceConfigByProductId.values()).flatMap((config) => config.sizeIds),
            ),
        );
        const [marketplaceColors, marketplaceSizes] = await Promise.all([
            allMarketplaceColorIds.length > 0
                ? prisma.color.findMany({
                    where: { id: { in: allMarketplaceColorIds }, isActive: true },
                    select: { id: true, name: true, hex: true },
                })
                : Promise.resolve([]),
            allMarketplaceSizeIds.length > 0
                ? prisma.size.findMany({
                    where: { id: { in: allMarketplaceSizeIds }, isActive: true },
                    select: { id: true, name: true },
                })
                : Promise.resolve([]),
        ]);
        const marketplaceColorById = new Map(marketplaceColors.map((color) => [Number(color.id), color]));
        const marketplaceSizeById = new Map(marketplaceSizes.map((size) => [Number(size.id), size]));

        const variantIds = products.flatMap((product) => product.variants.map((variant) => variant.id));
        const stockGroups = variantIds.length > 0
            ? await prisma.inventory.groupBy({
                by: ['variantId'],
                where: { variantId: { in: variantIds } },
                _sum: {
                    stock: true,
                    reservedStock: true,
                },
            })
            : [];

        const stockByVariant = new Map<number, { stock: number; reservedStock: number; availableStock: number }>();
        stockGroups.forEach((group) => {
            const stock = Number(group._sum.stock ?? 0);
            const reservedStock = Number(group._sum.reservedStock ?? 0);
            stockByVariant.set(group.variantId, {
                stock,
                reservedStock,
                availableStock: Math.max(0, stock - reservedStock),
            });
        });

        const mapped = products.map((product) => {
            const realVariants = product.variants.map((variant) => {
                const stock = stockByVariant.get(variant.id) ?? { stock: 0, reservedStock: 0, availableStock: 0 };
                const colorName = variant.color?.name ?? '';
                const sizeName = variant.size?.name ?? '';
                const isSimpleVariant = this.isSimpleVariantByNames(colorName, sizeName);
                const isSizeOnlyVariant = this.isSizeOnlyVariantByNames(colorName, sizeName);

                return {
                    id: variant.id,
                    sourceVariantId: variant.id,
                    sku: variant.sku,
                    barcode: variant.barcode,
                    price: Number(variant.price || 0),
                    imageUrl: variant.imageUrl,
                    color: (isSimpleVariant || isSizeOnlyVariant) ? null : variant.color,
                    size: isSimpleVariant ? null : variant.size,
                    availableStock: stock.availableStock,
                    reservedStock: stock.reservedStock,
                    isSimpleVariant,
                    isSizeOnlyVariant,
                    isVirtualMarketplaceVariant: false,
                };
            });

            const variantMode = this.resolveProductVariantMode(product.variants || []);
            const marketplaceConfig = marketplaceConfigByProductId.get(Number(product.id));
            let variants: any[] = realVariants as any[];

            if (variantMode === 'SIMPLE' && marketplaceConfig && realVariants.length > 0) {
                const baseVariant = realVariants[0];
                const configuredColors = marketplaceConfig.colorIds
                    .map((id) => marketplaceColorById.get(id))
                    .filter((color): color is { id: number; name: string; hex: string | null } => Boolean(color));
                const configuredSizes = marketplaceConfig.sizeIds
                    .map((id) => marketplaceSizeById.get(id))
                    .filter((size): size is { id: number; name: string } => Boolean(size));

                if (baseVariant && configuredColors.length > 0 && configuredSizes.length > 0) {
                    variants = this.buildPublicVariantsForSimpleMode(
                        baseVariant,
                        Number(baseVariant.availableStock || 0),
                        Number(baseVariant.reservedStock || 0),
                        configuredColors,
                        configuredSizes,
                        marketplaceConfig.colorImages || [],
                    );
                }
            }

            const prices = variants.map((variant) => Number(variant.price || 0)).filter((price) => Number.isFinite(price));
            const minPrice = prices.length ? Math.min(...prices) : 0;
            const maxPrice = prices.length ? Math.max(...prices) : minPrice;
            const totalAvailableStock = variants.reduce((sum, variant) => sum + Number(variant.availableStock || 0), 0);
            const hasStock = totalAvailableStock > 0;
            const colorsMap = new Map<number, { id: number; name: string; hex: string | null }>();
            const sizesMap = new Map<number, { id: number; name: string }>();

            variants.forEach((variant) => {
                if (variant.color && !colorsMap.has(variant.color.id)) {
                    colorsMap.set(variant.color.id, {
                        id: variant.color.id,
                        name: variant.color.name,
                        hex: variant.color.hex ?? null,
                    });
                }
                if (variant.size && !sizesMap.has(variant.size.id)) {
                    sizesMap.set(variant.size.id, {
                        id: variant.size.id,
                        name: variant.size.name,
                    });
                }
            });

            const colors = Array.from(colorsMap.values());
            const sizes = Array.from(sizesMap.values());

            return {
                id: product.id,
                name: product.name,
                description: product.description,
                category: product.category ? { id: product.category.id, name: product.category.name } : null,
                imageUrl: product.images?.[0]?.url || variants.find((variant) => !!variant.imageUrl)?.imageUrl || null,
                images: (product.images || []).map((image) => ({ id: image.id, url: image.url })),
                variants,
                colors,
                sizes,
                minPrice,
                maxPrice,
                totalAvailableStock,
                hasStock,
                allowBackorder: true,
                availabilityLabel: hasStock ? 'Disponible' : 'Pedido sujeto a confirmacion',
            };
        });

        const filtered = mapped.filter((product) => {
            if (colorId && !product.colors.some((color) => Number(color.id) === Number(colorId))) {
                return false;
            }
            if (sizeId && !product.sizes.some((size) => Number(size.id) === Number(sizeId))) {
                return false;
            }
            if (inStock === true && !product.hasStock) {
                return false;
            }
            if (inStock === false && product.hasStock) {
                return false;
            }
            if (allowBackorder === false && !product.hasStock) {
                return false;
            }
            return true;
        });

        const start = (skip - 1) * take;
        const paginated = filtered.slice(start, start + take);

        return {
            data: paginated,
            total: filtered.length,
            page: skip,
            limit: take,
            hasMore: (skip * take) < filtered.length,
        };
    }

    async getPublicProductById(id: number): Promise<any> {
        const product = await prisma.product.findFirst({
            where: {
                id,
                isActive: true,
                variants: {
                    some: { isActive: true },
                },
            },
            include: {
                category: true,
                images: true,
                variants: {
                    where: { isActive: true },
                    include: {
                        color: true,
                        size: true,
                    },
                },
            },
        });

        if (!product) {
            throw CustomError.notFound('Producto no encontrado o inactivo');
        }

        const variantIds = product.variants.map((variant) => variant.id);
        const stockGroups = variantIds.length > 0
            ? await prisma.inventory.groupBy({
                by: ['variantId'],
                where: { variantId: { in: variantIds } },
                _sum: {
                    stock: true,
                    reservedStock: true,
                },
            })
            : [];

        const stockByVariant = new Map<number, { stock: number; reservedStock: number; availableStock: number }>();
        stockGroups.forEach((group) => {
            const stock = Number(group._sum.stock ?? 0);
            const reservedStock = Number(group._sum.reservedStock ?? 0);
            stockByVariant.set(group.variantId, {
                stock,
                reservedStock,
                availableStock: Math.max(0, stock - reservedStock),
            });
        });

        const realVariants = product.variants.map((variant) => {
            const stock = stockByVariant.get(variant.id) ?? { stock: 0, reservedStock: 0, availableStock: 0 };
            const colorName = variant.color?.name ?? '';
            const sizeName = variant.size?.name ?? '';
            const isSimpleVariant = this.isSimpleVariantByNames(colorName, sizeName);
            const isSizeOnlyVariant = this.isSizeOnlyVariantByNames(colorName, sizeName);

            return {
                id: variant.id,
                sourceVariantId: variant.id,
                sku: variant.sku,
                barcode: variant.barcode,
                price: Number(variant.price || 0),
                imageUrl: variant.imageUrl,
                color: (isSimpleVariant || isSizeOnlyVariant) ? null : variant.color,
                size: isSimpleVariant ? null : variant.size,
                availableStock: stock.availableStock,
                reservedStock: stock.reservedStock,
                isSimpleVariant,
                isSizeOnlyVariant,
                isVirtualMarketplaceVariant: false,
            };
        });

        const variantMode = this.resolveProductVariantMode(product.variants || []);
        const marketplaceConfig = await this.getMarketplaceSimpleVariantConfig(id);
        let variants: any[] = realVariants as any[];

        if (variantMode === 'SIMPLE' && marketplaceConfig && realVariants.length > 0) {
            const [colorsFromConfig, sizesFromConfig] = await Promise.all([
                prisma.color.findMany({
                    where: { id: { in: marketplaceConfig.colorIds }, isActive: true },
                    select: { id: true, name: true, hex: true },
                }),
                prisma.size.findMany({
                    where: { id: { in: marketplaceConfig.sizeIds }, isActive: true },
                    select: { id: true, name: true },
                }),
            ]);

            const colorById = new Map(colorsFromConfig.map((color) => [Number(color.id), color]));
            const sizeById = new Map(sizesFromConfig.map((size) => [Number(size.id), size]));
            const configuredColors = marketplaceConfig.colorIds
                .map((colorId) => colorById.get(colorId))
                .filter((color): color is { id: number; name: string; hex: string | null } => Boolean(color));
            const configuredSizes = marketplaceConfig.sizeIds
                .map((sizeId) => sizeById.get(sizeId))
                .filter((size): size is { id: number; name: string } => Boolean(size));

            const baseVariant = realVariants[0];
            if (baseVariant && configuredColors.length > 0 && configuredSizes.length > 0) {
                variants = this.buildPublicVariantsForSimpleMode(
                    baseVariant,
                    Number(baseVariant.availableStock || 0),
                    Number(baseVariant.reservedStock || 0),
                    configuredColors,
                    configuredSizes,
                    marketplaceConfig.colorImages || [],
                );
            }
        }

        const prices = variants.map((variant) => Number(variant.price || 0)).filter((price) => Number.isFinite(price));
        const minPrice = prices.length ? Math.min(...prices) : 0;
        const maxPrice = prices.length ? Math.max(...prices) : minPrice;
        const totalAvailableStock = variants.reduce((sum, variant) => sum + Number(variant.availableStock || 0), 0);
        const hasStock = totalAvailableStock > 0;
        const colorsMap = new Map<number, { id: number; name: string; hex: string | null }>();
        const sizesMap = new Map<number, { id: number; name: string }>();

        variants.forEach((variant) => {
            if (variant.color && !colorsMap.has(variant.color.id)) {
                colorsMap.set(variant.color.id, {
                    id: variant.color.id,
                    name: variant.color.name,
                    hex: variant.color.hex ?? null,
                });
            }
            if (variant.size && !sizesMap.has(variant.size.id)) {
                sizesMap.set(variant.size.id, {
                    id: variant.size.id,
                    name: variant.size.name,
                });
            }
        });

        const colors = Array.from(colorsMap.values());
        const sizes = Array.from(sizesMap.values());

        return {
            id: product.id,
            name: product.name,
            description: product.description,
            category: product.category ? { id: product.category.id, name: product.category.name } : null,
            imageUrl: product.images?.[0]?.url || variants.find((variant) => !!variant.imageUrl)?.imageUrl || null,
            images: (product.images || []).map((image) => ({ id: image.id, url: image.url })),
            variants,
            colors,
            sizes,
            minPrice,
            maxPrice,
            totalAvailableStock,
            hasStock,
            allowBackorder: true,
            availabilityLabel: hasStock ? 'Disponible' : 'Pedido sujeto a confirmacion',
        };
    }

    /**
     * Eliminar y recrear las imágenes de producto
     */
    private async replaceProductImages(productId: number, imageUrls: string[] = [], imageFiles: Array<{ filename: string; data: string }> = []) {
        const existingImages = await prisma.productImage.findMany({ where: { productId }, select: { url: true } });
        const uploadedUrls = await this.uploadProductFiles(productId, imageFiles);
        const allImageUrls = [...new Set([...(imageUrls || []), ...uploadedUrls])];

        const removedImages = existingImages
            .map((image) => image.url)
            .filter((url) => !allImageUrls.includes(url));

        await Promise.all(removedImages.map((url) => this.deleteCloudinaryUrl(url)));

        await prisma.productImage.deleteMany({ where: { productId } });

        if (allImageUrls.length > 0) {
            await prisma.productImage.createMany({
                data: allImageUrls.map((url: string) => ({
                    url,
                    productId,
                })),
            });
        }
    }

    /**
     * Reemplazar las variantes de un producto
     */
    private async replaceVariants(productId: number, productName: string, variants: Array<{ colorId: number; sizeId: number; price: number; isActive?: boolean; imageUrl?: string; imageFile?: { filename: string; data: string } }>) {
        const existingVariants = await prisma.productVariant.findMany({
            where: { productId },
            select: { id: true, colorId: true, sizeId: true, imageUrl: true, isActive: true },
        });

        const incomingMap = new Map<string, { colorId: number; sizeId: number; price: number; isActive?: boolean; imageUrl?: string; imageFile?: { filename: string; data: string } }>();
        for (const variant of variants) {
            const key = `${variant.colorId}-${variant.sizeId}`;
            if (incomingMap.has(key)) {
                throw CustomError.badRequest(`Variante duplicada para colorId=${variant.colorId} y sizeId=${variant.sizeId}`);
            }
            incomingMap.set(key, variant);
        }

        const existingByKey = new Map(existingVariants.map((variant) => [`${variant.colorId}-${variant.sizeId}`, variant]));
        const removedVariantImages: string[] = [];

        const colorIds = [...new Set(variants.map((variant) => variant.colorId))];
        const sizeIds = [...new Set(variants.map((variant) => variant.sizeId))];
        const colorRecords = await prisma.color.findMany({ where: { id: { in: colorIds } } });
        const sizeRecords = await prisma.size.findMany({ where: { id: { in: sizeIds } } });
        const colorById = new Map(colorRecords.map(color => [color.id, color.name]));
        const sizeById = new Map(sizeRecords.map(size => [size.id, size.name]));

        const now = new Date();

        const savedVariants = await Promise.all(
            variants.map(async variant => {
                const key = `${variant.colorId}-${variant.sizeId}`;
                const existing = existingByKey.get(key);
                const uploadedImage = await this.uploadVariantImage(productId, variant);
                const colorName = colorById.get(variant.colorId) ?? '';
                const sizeName = sizeById.get(variant.sizeId) ?? '';
                const shouldBeActive = variant.isActive !== false;

                let imageUrlToPersist: string | null = null;
                if (variant.imageFile) {
                    imageUrlToPersist = uploadedImage;
                } else if (variant.imageUrl !== undefined) {
                    imageUrlToPersist = variant.imageUrl || null;
                } else if (existing?.imageUrl) {
                    imageUrlToPersist = existing.imageUrl;
                }

                if (
                    existing?.imageUrl &&
                    imageUrlToPersist &&
                    existing.imageUrl !== imageUrlToPersist &&
                    (variant.imageFile !== undefined || variant.imageUrl !== undefined)
                ) {
                    removedVariantImages.push(existing.imageUrl);
                }

                const variantData = {
                    sku: this.generateSKU(productName, colorName, sizeName, productId, variant.colorId, variant.sizeId),
                    price: new Prisma.Decimal(String(variant.price)),
                    colorId: variant.colorId,
                    sizeId: variant.sizeId,
                    imageUrl: imageUrlToPersist,
                    isActive: shouldBeActive,
                    updatedAt: now,
                };

                if (existing) {
                    return prisma.productVariant.update({
                        where: { id: existing.id },
                        data: variantData,
                    });
                }

                return prisma.productVariant.create({
                    data: {
                        ...variantData,
                        productId,
                    },
                });
            }),
        );

        const variantsToDeactivate = existingVariants
            .filter((existing) => !incomingMap.has(`${existing.colorId}-${existing.sizeId}`) && existing.isActive)
            .map((existing) => existing.id);

        if (variantsToDeactivate.length > 0) {
            await prisma.productVariant.updateMany({
                where: { id: { in: variantsToDeactivate } },
                data: {
                    isActive: false,
                    updatedAt: now,
                },
            });
        }

        const uniqueRemovedImages = [...new Set(removedVariantImages)];
        await Promise.all(uniqueRemovedImages.map((url) => this.deleteCloudinaryUrl(url)));

        return savedVariants;
    }

    private async replaceSimpleVariant(
        productId: number,
        productName: string,
        variant: { price: number; isActive?: boolean; imageUrl?: string; imageFile?: { filename: string; data: string } },
    ) {
        const simpleDimensions = await this.ensureSimpleVariantDimensions();
        const simpleVariant: {
            colorId: number;
            sizeId: number;
            price: number;
            isActive?: boolean;
            imageUrl?: string;
            imageFile?: { filename: string; data: string };
        } = {
            colorId: simpleDimensions.colorId,
            sizeId: simpleDimensions.sizeId,
            price: Number(variant.price),
            isActive: variant.isActive !== false,
        };

        if (variant.imageUrl) {
            simpleVariant.imageUrl = variant.imageUrl;
        }

        if (variant.imageFile) {
            simpleVariant.imageFile = variant.imageFile;
        }

        return this.replaceVariants(productId, productName, [simpleVariant]);
    }

    private async replaceSizeOnlyVariants(
        productId: number,
        productName: string,
        variants: Array<{ sizeId?: number; price: number; isActive?: boolean; imageUrl?: string; imageFile?: { filename: string; data: string } }>,
    ) {
        const simpleColor = await this.ensureSimpleColor();
        const normalizedSizeIds = [...new Set(variants.map((variant) => Number(variant.sizeId || 0)).filter((id) => id > 0))];
        await this.validateSizes(normalizedSizeIds);

        const sizeOnlyVariants = variants.map((variant) => {
            const mapped: {
                colorId: number;
                sizeId: number;
                price: number;
                isActive?: boolean;
                imageUrl?: string;
                imageFile?: { filename: string; data: string };
            } = {
                colorId: simpleColor.id,
                sizeId: Number(variant.sizeId),
                price: Number(variant.price),
                isActive: variant.isActive !== false,
            };

            if (variant.imageUrl) {
                mapped.imageUrl = variant.imageUrl;
            }

            if (variant.imageFile) {
                mapped.imageFile = variant.imageFile;
            }

            return mapped;
        });

        return this.replaceVariants(productId, productName, sizeOnlyVariants);
    }

    /**
     * Actualizar un producto
     */
    async updateProduct(
        id: number,
        updateData: UpdateProductDto,
    ): Promise<ProductEntity> {
        try {
            const product = await prisma.product.findUnique({
                where: { id },
                include: {
                    variants: {
                        where: { isActive: true },
                        include: { color: true, size: true },
                    },
                },
            });

            if (!product) {
                throw CustomError.notFound(`El producto con ID ${id} no existe`);
            }

            if (updateData.categoryId) {
                await this.validateCategory(updateData.categoryId);
            }

            const currentMode = this.resolveProductVariantMode(product.variants || []);
            const nextMode = updateData.variantMode ?? currentMode;
            const isSimpleMode = nextMode === 'SIMPLE';
            const isSizeOnlyMode = nextMode === 'SIZE_ONLY';

            if (updateData.colorIds && !isSimpleMode && !isSizeOnlyMode) {
                await this.validateColors(updateData.colorIds);
            }

            if (updateData.sizeIds && !isSimpleMode) {
                await this.validateSizes(updateData.sizeIds);
            }

            let simpleMarketplaceConfigToPersist: MarketplaceSimpleVariantConfig | null | undefined;
            const hasSimpleMarketplaceChanges =
                updateData.variantMode !== undefined ||
                updateData.colorIds !== undefined ||
                updateData.sizeIds !== undefined ||
                updateData.marketplaceColorImages !== undefined;

            if (hasSimpleMarketplaceChanges) {
                if (isSimpleMode) {
                    const currentMarketplaceConfig = await this.getMarketplaceSimpleVariantConfig(id);
                    const nextColorIds = updateData.colorIds ?? currentMarketplaceConfig?.colorIds ?? [];
                    const nextSizeIds = updateData.sizeIds ?? currentMarketplaceConfig?.sizeIds ?? [];
                    simpleMarketplaceConfigToPersist = await this.resolveSimpleMarketplaceConfig(
                        'SIMPLE',
                        nextColorIds,
                        nextSizeIds,
                    );
                    if (simpleMarketplaceConfigToPersist) {
                        const incomingColorImages = updateData.marketplaceColorImages;
                        const colorImages = incomingColorImages !== undefined
                            ? await this.resolveMarketplaceColorImages(id, simpleMarketplaceConfigToPersist.colorIds, incomingColorImages)
                            : (currentMarketplaceConfig?.colorImages || [])
                                .filter((image) => simpleMarketplaceConfigToPersist?.colorIds.includes(Number(image.colorId)));
                        simpleMarketplaceConfigToPersist = {
                            ...simpleMarketplaceConfigToPersist,
                            colorImages,
                        };
                    }
                } else {
                    simpleMarketplaceConfigToPersist = null;
                }
            }

            if (updateData.imageUrls || updateData.imageFiles) {
                await this.replaceProductImages(id, updateData.imageUrls, updateData.imageFiles);
            }

            if (updateData.variants) {
                const productName = updateData.name ?? product.name;
                if (isSimpleMode) {
                    const firstVariant = updateData.variants[0];
                    if (!firstVariant) {
                        throw CustomError.badRequest('Debe enviar una variante para el modo SIMPLE');
                    }

                    await this.replaceSimpleVariant(id, productName, firstVariant);
                } else if (isSizeOnlyMode) {
                    await this.replaceSizeOnlyVariants(id, productName, updateData.variants);
                } else {
                    await this.replaceVariants(
                        id,
                        productName,
                        updateData.variants.map((variant) => {
                            const matrixVariant: {
                                colorId: number;
                                sizeId: number;
                                price: number;
                                isActive?: boolean;
                                imageUrl?: string;
                                imageFile?: { filename: string; data: string };
                            } = {
                                colorId: Number(variant.colorId),
                                sizeId: Number(variant.sizeId),
                                price: Number(variant.price),
                                isActive: variant.isActive !== false,
                            };

                            if (variant.imageUrl) {
                                matrixVariant.imageUrl = variant.imageUrl;
                            }

                            if (variant.imageFile) {
                                matrixVariant.imageFile = variant.imageFile;
                            }

                            return matrixVariant;
                        }),
                    );
                }
            }

            if (simpleMarketplaceConfigToPersist !== undefined) {
                await this.upsertMarketplaceSimpleVariantConfig(id, simpleMarketplaceConfigToPersist);
            }

            const updated = await prisma.product.update({
                where: { id },
                data: {
                    name: updateData.name ?? product.name,
                    description: updateData.description !== undefined ? updateData.description : product.description,
                    categoryId: updateData.categoryId ?? product.categoryId,
                    isActive: updateData.isActive !== undefined ? updateData.isActive : product.isActive,
                    updatedAt: new Date(),
                },
            });

            return ProductEntity.fromObject(updated);
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            console.error('Error al actualizar el producto:', error);
            throw CustomError.internal('Error al actualizar el producto');
        }
    }

    /**
     * Eliminar un producto
     */
    async deleteProduct(id: number): Promise<void> {
        try {
            const product = await prisma.product.findUnique({ where: { id } });

            if (!product) {
                throw CustomError.notFound(`El producto con ID ${id} no existe`);
            }

            await this.upsertMarketplaceSimpleVariantConfig(id, null);

            // Eliminar producto (las imágenes y variantes se eliminarán en cascada)
            await prisma.product.delete({ where: { id } });
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            console.error('Error al eliminar el producto:', error);
            throw CustomError.internal('Error al eliminar el producto');
        }
    }
}
