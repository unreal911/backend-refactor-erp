import { sanitizeProductDescriptionHtml } from '../sanitization/product-description';

type ProductVariantMode = 'MATRIX' | 'SIMPLE' | 'SIZE_ONLY';

type CreateVariantInput = {
    sku?: string;
    barcode?: string;
    colorId?: number;
    sizeId?: number;
    price: number;
    isActive?: boolean;
    imageUrl?: string;
    imageFile?: { filename: string; data: string };
};

type MarketplaceColorImageInput = {
    colorId: number;
    imageUrl?: string;
    imageFile?: { filename: string; data: string };
};

type OrderedProductImageInput = {
    url?: string;
    imageFile?: { filename: string; data: string };
};

export class CreateProductDto {
    private constructor(
        public readonly name: string,
        public readonly categoryId: number,
        public readonly description: string | undefined,
        public readonly isActive: boolean,
        public readonly afectacionIgv: string,
        public readonly variantMode: ProductVariantMode,
        public readonly colorIds: number[] = [],
        public readonly sizeIds: number[] = [],
        public readonly imageUrls: string[] = [],
        public readonly imageFiles: Array<{ filename: string; data: string }> = [],
        public readonly orderedImages: OrderedProductImageInput[] = [],
        public readonly variants: CreateVariantInput[] = [],
        public readonly marketplaceColorImages: MarketplaceColorImageInput[] = [],
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, CreateProductDto | undefined] {
        const {
            name,
            categoryId,
            description,
            colorIds = [],
            sizeIds = [],
            imageUrls = [],
            imageFiles = [],
            orderedImages = [],
            variants = [],
            marketplaceColorImages = [],
        } = object;

        const rawVariantMode = typeof object.variantMode === 'string' ? object.variantMode.toUpperCase() : 'MATRIX';
        const variantMode = rawVariantMode as ProductVariantMode;

        if (variantMode !== 'MATRIX' && variantMode !== 'SIMPLE' && variantMode !== 'SIZE_ONLY') {
            return ['variantMode debe ser MATRIX, SIMPLE o SIZE_ONLY', undefined];
        }

        if (!name || typeof name !== 'string' || name.trim() === '') {
            return ['El nombre del producto es obligatorio y debe ser una cadena valida', undefined];
        }

        if (!categoryId || typeof categoryId !== 'number' || categoryId < 1) {
            return ['La categoria es obligatoria y debe ser un numero valido', undefined];
        }

        if (description !== undefined && typeof description !== 'string') {
            return ['La descripcion debe ser una cadena valida', undefined];
        }

        const isActive = object.isActive === undefined ? true : object.isActive;
        if (typeof isActive !== 'boolean') {
            return ['isActive debe ser un booleano', undefined];
        }

        // Afectacion IGV (catalogo SUNAT 07). Opcional; default gravado (10).
        const afectacionIgv = object.afectacionIgv !== undefined ? String(object.afectacionIgv) : '10';
        if (!['10', '20', '30'].includes(afectacionIgv)) {
            return ['afectacionIgv debe ser 10 (gravado), 20 (exonerado) o 30 (inafecto)', undefined];
        }

        if (!Array.isArray(colorIds)) {
            return ['colorIds debe ser un array', undefined];
        }

        if (!Array.isArray(sizeIds)) {
            return ['sizeIds debe ser un array', undefined];
        }

        if (!colorIds.every((id: any) => typeof id === 'number' && id > 0)) {
            return ['Los IDs de colores deben ser numeros validos', undefined];
        }

        if (!sizeIds.every((id: any) => typeof id === 'number' && id > 0)) {
            return ['Los IDs de tallas deben ser numeros validos', undefined];
        }

        if (variantMode === 'MATRIX') {
            if (colorIds.length === 0) {
                return ['Debe seleccionar al menos un color', undefined];
            }
            if (sizeIds.length === 0) {
                return ['Debe seleccionar al menos una talla', undefined];
            }
        } else if (variantMode === 'SIZE_ONLY') {
            if (sizeIds.length === 0) {
                return ['Debe seleccionar al menos una talla', undefined];
            }
        }

        if (!Array.isArray(imageUrls)) {
            return ['Las imagenes deben ser un array de URLs', undefined];
        }

        if (imageUrls.some((url: any) => typeof url !== 'string')) {
            return ['Todas las imagenes deben ser URLs validas', undefined];
        }

        if (!Array.isArray(imageFiles)) {
            return ['imageFiles debe ser un array', undefined];
        }

        if (imageFiles.some((file: any) => !file || typeof file.filename !== 'string' || typeof file.data !== 'string')) {
            return ['Cada archivo debe incluir filename y data en base64', undefined];
        }

        if (!Array.isArray(orderedImages)) {
            return ['orderedImages debe ser un array', undefined];
        }
        for (const image of orderedImages as OrderedProductImageInput[]) {
            const hasUrl = typeof image?.url === 'string' && image.url.trim().length > 0;
            const hasFile = Boolean(
                image?.imageFile
                && typeof image.imageFile.filename === 'string'
                && typeof image.imageFile.data === 'string',
            );
            if (!hasUrl && !hasFile) {
                return ['Cada imagen ordenada debe incluir una URL o un archivo valido', undefined];
            }
        }

        if (!Array.isArray(marketplaceColorImages)) {
            return ['marketplaceColorImages debe ser un array', undefined];
        }

        for (const image of marketplaceColorImages as MarketplaceColorImageInput[]) {
            if (!image || typeof image !== 'object') {
                return ['Cada imagen marketplace debe ser un objeto valido', undefined];
            }

            if (!image.colorId || typeof image.colorId !== 'number' || image.colorId < 1) {
                return ['Cada imagen marketplace debe tener un colorId valido', undefined];
            }

            if (image.imageUrl !== undefined && typeof image.imageUrl !== 'string') {
                return ['La URL de imagen marketplace debe ser valida', undefined];
            }

            if (image.imageFile !== undefined) {
                if (
                    typeof image.imageFile !== 'object' ||
                    typeof image.imageFile.filename !== 'string' ||
                    typeof image.imageFile.data !== 'string'
                ) {
                    return ['Cada archivo de imagen marketplace debe incluir filename y data en base64', undefined];
                }
            }
        }

        if (!Array.isArray(variants)) {
            return ['Las variantes deben ser un array', undefined];
        }

        if (variants.length === 0) {
            return ['Debe haber al menos una variante', undefined];
        }

        if (variantMode === 'SIMPLE' && variants.length !== 1) {
            return ['En modo SIMPLE debe enviar exactamente una variante', undefined];
        }

        for (const variant of variants as CreateVariantInput[]) {
            if (!variant || typeof variant !== 'object') {
                return ['Cada variante debe ser un objeto valido', undefined];
            }

            if (!variant.price || typeof variant.price !== 'number' || variant.price <= 0) {
                return ['Cada variante debe tener un precio mayor a 0', undefined];
            }

            if (variant.sku !== undefined && (typeof variant.sku !== 'string' || variant.sku.trim().length > 64)) {
                return ['El SKU de cada variante debe ser texto de hasta 64 caracteres', undefined];
            }

            if (variant.barcode !== undefined && (typeof variant.barcode !== 'string' || variant.barcode.trim().length > 128)) {
                return ['El codigo de barras de cada variante debe ser texto de hasta 128 caracteres', undefined];
            }

            if (variant.isActive !== undefined && typeof variant.isActive !== 'boolean') {
                return ['isActive de la variante debe ser booleano', undefined];
            }

            if (variant.imageUrl !== undefined && typeof variant.imageUrl !== 'string') {
                return ['La URL de la imagen de variante debe ser valida', undefined];
            }

            if (variantMode === 'MATRIX') {
                if (!variant.colorId || typeof variant.colorId !== 'number' || variant.colorId < 1) {
                    return ['Cada variante debe tener un colorId valido', undefined];
                }

                if (!variant.sizeId || typeof variant.sizeId !== 'number' || variant.sizeId < 1) {
                    return ['Cada variante debe tener un sizeId valido', undefined];
                }
            } else if (variantMode === 'SIZE_ONLY') {
                if (!variant.sizeId || typeof variant.sizeId !== 'number' || variant.sizeId < 1) {
                    return ['Cada variante debe tener un sizeId valido', undefined];
                }
            }
        }

        const requestedSkus = (variants as CreateVariantInput[])
            .map((variant) => String(variant.sku || '').trim().toUpperCase())
            .filter(Boolean);
        if (new Set(requestedSkus).size !== requestedSkus.length) {
            return ['No puede haber variantes con el mismo SKU', undefined];
        }

        const requestedBarcodes = (variants as CreateVariantInput[])
            .map((variant) => String(variant.barcode || '').trim())
            .filter(Boolean);
        if (new Set(requestedBarcodes).size !== requestedBarcodes.length) {
            return ['No puede haber variantes con el mismo codigo de barras', undefined];
        }

        return [undefined, new CreateProductDto(
            name.trim(),
            categoryId,
            description === undefined ? undefined : sanitizeProductDescriptionHtml(description),
            isActive,
            afectacionIgv,
            variantMode,
            colorIds,
            sizeIds,
            imageUrls,
            imageFiles,
            orderedImages as OrderedProductImageInput[],
            variants as CreateVariantInput[],
            marketplaceColorImages as MarketplaceColorImageInput[],
        )];
    }
}
