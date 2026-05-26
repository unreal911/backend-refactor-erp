import { CustomError } from "../errors/custom.error";

export class CategoryEntity {
    constructor(
        public readonly id: number | string,
        public readonly name: string,
        public readonly isActive: boolean = true,
        public readonly createdAt: Date = new Date(),
    ) { }

    static fromObject(obj: any): CategoryEntity {
        if (!obj) {
            throw new Error("Objeto invalido para crear una categoría");
        }

        const rawId = obj._id ?? obj.id;
        const id = typeof rawId === "number"
            ? rawId
            : rawId?.toString?.();

        if (id === undefined || id === null || id === "") {
            throw new Error("categoria es requerida");
        }

        const name = obj.name;
        if (!name) throw CustomError.badRequest("el nombre de la categoria es requerido");

        const isActive = typeof obj.isActive === "boolean" ? obj.isActive : true;
        const createdAt = obj.createdAt ? new Date(obj.createdAt) : new Date();

        return new CategoryEntity(
            id,
            name,
            isActive,
            createdAt,
        );
    }
}
