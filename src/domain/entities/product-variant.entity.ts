import { CustomError } from "../errors/custom.error";

export class ProductVariantEntity {
    constructor(
        public readonly id: number,
        public readonly sku: string,
        public readonly price: number,
        public readonly productId: number,
        public readonly colorId: number,
        public readonly sizeId: number,
        public readonly imageUrl: string | null = null,
        public readonly barcode: string | null = null,
        public readonly isActive: boolean = true,
        public readonly createdAt: Date = new Date(),
        public readonly updatedAt: Date = new Date(),
    ) { }

    static fromObject(obj: any): ProductVariantEntity {
        if (!obj) {
            throw new Error("Objeto inválido para crear una variante de producto");
        }

        const id = obj.id;
        if (id === undefined || id === null) {
            throw CustomError.badRequest("El ID de la variante es requerido");
        }

        const sku = obj.sku;
        if (!sku || typeof sku !== 'string') {
            throw CustomError.badRequest("El SKU de la variante es requerido");
        }

        const price = obj.price;
        if (price === undefined || price === null || price <= 0) {
            throw CustomError.badRequest("El precio debe ser mayor a 0");
        }

        const productId = obj.productId;
        if (!productId || typeof productId !== 'number') {
            throw CustomError.badRequest("El ID del producto es requerido");
        }

        const colorId = obj.colorId;
        if (!colorId || typeof colorId !== 'number') {
            throw CustomError.badRequest("El ID del color es requerido");
        }

        const sizeId = obj.sizeId;
        if (!sizeId || typeof sizeId !== 'number') {
            throw CustomError.badRequest("El ID de la talla es requerido");
        }

        const imageUrl = obj.imageUrl || null;
        const barcode = obj.barcode || null;
        const isActive = typeof obj.isActive === 'boolean' ? obj.isActive : true;
        const createdAt = obj.createdAt ? new Date(obj.createdAt) : new Date();
        const updatedAt = obj.updatedAt ? new Date(obj.updatedAt) : new Date();

        return new ProductVariantEntity(
            id,
            sku,
            price,
            productId,
            colorId,
            sizeId,
            imageUrl,
            barcode,
            isActive,
            createdAt,
            updatedAt,
        );
    }
}
