import { CustomError } from "../errors/custom.error";

export class ProductImageEntity {
    constructor(
        public readonly id: number,
        public readonly url: string,
        public readonly productId: number,
        public readonly createdAt: Date = new Date(),
    ) { }

    static fromObject(obj: any): ProductImageEntity {
        if (!obj) {
            throw new Error("Objeto inválido para crear una imagen de producto");
        }

        const id = obj.id;
        if (id === undefined || id === null) {
            throw CustomError.badRequest("El ID de la imagen es requerido");
        }

        const url = obj.url;
        if (!url || typeof url !== 'string') {
            throw CustomError.badRequest("La URL de la imagen es requerida");
        }

        const productId = obj.productId;
        if (!productId || typeof productId !== 'number') {
            throw CustomError.badRequest("El ID del producto es requerido");
        }

        const createdAt = obj.createdAt ? new Date(obj.createdAt) : new Date();

        return new ProductImageEntity(id, url, productId, createdAt);
    }
}
