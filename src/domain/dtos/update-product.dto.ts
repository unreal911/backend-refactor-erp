type ProductVariantMode = 'MATRIX' | 'SIMPLE' | 'SIZE_ONLY';

type UpdateVariantInput = {
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

export class UpdateProductDto {
    private constructor(
        public readonly name?: string,
        public readonly description?: string,
        public readonly categoryId?: number,
        public readonly isActive?: boolean,
        public readonly variantMode?: ProductVariantMode,
        public readonly colorIds?: number[],
        public readonly sizeIds?: number[],
        public readonly imageUrls?: string[],
        public readonly imageFiles?: Array<{ filename: string; data: string }>,
        public readonly variants?: UpdateVariantInput[],
        public readonly marketplaceColorImages?: MarketplaceColorImageInput[],
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, UpdateProductDto | undefined] {
        const {
            name,
            description,
            categoryId,
            isActive,
            variantMode,
            colorIds,
            sizeIds,
            imageUrls,
            imageFiles,
            variants,
            marketplaceColorImages,
        } = object;

        const normalizedVariantMode = typeof variantMode === 'string'
            ? variantMode.toUpperCase() as ProductVariantMode
            : undefined;

        if (
            normalizedVariantMode !== undefined &&
            normalizedVariantMode !== 'MATRIX' &&
            normalizedVariantMode !== 'SIMPLE' &&
            normalizedVariantMode !== 'SIZE_ONLY'
        ) {
            return ['variantMode debe ser MATRIX, SIMPLE o SIZE_ONLY', undefined];
        }

        if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
            return ['El nombre del producto debe ser una cadena valida', undefined];
        }

        if (description !== undefined && typeof description !== 'string') {
            return ['La descripcion debe ser una cadena valida', undefined];
        }

        if (categoryId !== undefined && (typeof categoryId !== 'number' || categoryId < 1)) {
            return ['La categoria debe ser un numero valido', undefined];
        }

        if (isActive !== undefined && typeof isActive !== 'boolean') {
            return ['isActive debe ser un booleano', undefined];
        }

        const effectiveMode: ProductVariantMode = normalizedVariantMode ?? 'MATRIX';

        if (colorIds !== undefined) {
            if (!Array.isArray(colorIds)) {
                return ['colorIds debe ser un array', undefined];
            }

            if (effectiveMode === 'MATRIX' && colorIds.length === 0) {
                return ['Debe seleccionar al menos un color', undefined];
            }

            if (!colorIds.every((id: any) => typeof id === 'number' && id > 0)) {
                return ['Los IDs de colores deben ser numeros validos', undefined];
            }
        }

        if (sizeIds !== undefined) {
            if (!Array.isArray(sizeIds)) {
                return ['sizeIds debe ser un array', undefined];
            }

            if ((effectiveMode === 'MATRIX' || effectiveMode === 'SIZE_ONLY') && sizeIds.length === 0) {
                return ['Debe seleccionar al menos una talla', undefined];
            }

            if (!sizeIds.every((id: any) => typeof id === 'number' && id > 0)) {
                return ['Los IDs de tallas deben ser numeros validos', undefined];
            }
        }

        if (imageUrls !== undefined) {
            if (!Array.isArray(imageUrls)) {
                return ['Las imagenes deben ser un array de URLs', undefined];
            }
            if (imageUrls.some((url: any) => typeof url !== 'string')) {
                return ['Todas las imagenes deben ser URLs validas', undefined];
            }
        }

        if (imageFiles !== undefined) {
            if (!Array.isArray(imageFiles)) {
                return ['imageFiles debe ser un array', undefined];
            }
            for (const file of imageFiles) {
                if (!file || typeof file.filename !== 'string' || typeof file.data !== 'string') {
                    return ['Cada archivo debe incluir filename y data en base64', undefined];
                }
            }
        }

        if (marketplaceColorImages !== undefined) {
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
        }

        if (variants !== undefined) {
            if (!Array.isArray(variants)) {
                return ['Las variantes deben ser un array', undefined];
            }

            if (variants.length === 0) {
                return ['Debe haber al menos una variante', undefined];
            }

            if (effectiveMode === 'SIMPLE' && variants.length !== 1) {
                return ['En modo SIMPLE debe enviar exactamente una variante', undefined];
            }

            for (const variant of variants as UpdateVariantInput[]) {
                if (!variant || typeof variant !== 'object') {
                    return ['Cada variante debe ser un objeto valido', undefined];
                }

                if (!variant.price || typeof variant.price !== 'number' || variant.price <= 0) {
                    return ['Cada variante debe tener un precio mayor a 0', undefined];
                }

                if (variant.isActive !== undefined && typeof variant.isActive !== 'boolean') {
                    return ['isActive de la variante debe ser booleano', undefined];
                }

                if (variant.imageUrl !== undefined && typeof variant.imageUrl !== 'string') {
                    return ['La URL de la imagen de variante debe ser valida', undefined];
                }

                if (variant.imageFile !== undefined) {
                    if (
                        typeof variant.imageFile !== 'object' ||
                        typeof variant.imageFile.filename !== 'string' ||
                        typeof variant.imageFile.data !== 'string'
                    ) {
                        return ['Cada archivo de variante debe incluir filename y data en base64', undefined];
                    }
                }

                if (effectiveMode === 'MATRIX') {
                    if (!variant.colorId || typeof variant.colorId !== 'number' || variant.colorId < 1) {
                        return ['Cada variante debe tener un colorId valido', undefined];
                    }

                    if (!variant.sizeId || typeof variant.sizeId !== 'number' || variant.sizeId < 1) {
                        return ['Cada variante debe tener un sizeId valido', undefined];
                    }
                } else if (effectiveMode === 'SIZE_ONLY') {
                    if (!variant.sizeId || typeof variant.sizeId !== 'number' || variant.sizeId < 1) {
                        return ['Cada variante debe tener un sizeId valido', undefined];
                    }
                }
            }
        }

        return [undefined, new UpdateProductDto(
            name?.trim(),
            description?.trim(),
            categoryId,
            isActive,
            normalizedVariantMode,
            colorIds,
            sizeIds,
            imageUrls,
            imageFiles,
            variants as UpdateVariantInput[] | undefined,
            marketplaceColorImages as MarketplaceColorImageInput[] | undefined,
        )];
    }
}
