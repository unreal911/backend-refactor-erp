import { CustomError } from "../errors/custom.error";

export class ProductEntity {
    constructor(
        public readonly id: number,
        public readonly name: string,
        public readonly description: string | null,
        public readonly categoryId: number,
        public readonly isActive: boolean = true,
        public readonly createdAt: Date = new Date(),
        public readonly updatedAt: Date = new Date(),
    ) { }

    static fromObject(obj: any): ProductEntity {
        if (!obj) {
            throw new Error("Objeto inválido para crear un producto");
        }

        const id = obj.id;
        if (id === undefined || id === null) {
            throw CustomError.badRequest("El ID del producto es requerido");
        }

        const name = obj.name;
        if (!name || typeof name !== 'string') {
            throw CustomError.badRequest("El nombre del producto es requerido");
        }

        const categoryId = obj.categoryId;
        if (!categoryId || typeof categoryId !== 'number') {
            throw CustomError.badRequest("La categoría del producto es requerida");
        }

        const description = obj.description || null;
        const isActive = typeof obj.isActive === 'boolean' ? obj.isActive : true;
        const createdAt = obj.createdAt ? new Date(obj.createdAt) : new Date();
        const updatedAt = obj.updatedAt ? new Date(obj.updatedAt) : new Date();

        return new ProductEntity(
            id,
            name,
            description,
            categoryId,
            isActive,
            createdAt,
            updatedAt,
        );
    }
}
