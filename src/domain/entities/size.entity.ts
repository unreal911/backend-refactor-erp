import { CustomError } from "../errors/custom.error";

export class SizeEntity {
    constructor(
        public readonly id: number | string,
        public readonly name: string,
        public readonly isActive: boolean = true,
        public readonly createdAt: Date = new Date(),
    ) { }

    static fromObject(obj: any): SizeEntity {
        if (!obj) {
            throw new Error("Objeto invalido para crear una talla");
        }

        const rawId = obj._id ?? obj.id;
        const id = typeof rawId === "number"
            ? rawId
            : rawId?.toString?.();

        if (id === undefined || id === null || id === "") {
            throw new Error("talla es requerida");
        }

        const name = obj.name;
        if (!name) throw CustomError.badRequest("el nombre de la talla es requerido");

        const isActive = typeof obj.isActive === "boolean" ? obj.isActive : true;
        const createdAt = obj.createdAt ? new Date(obj.createdAt) : new Date();

        return new SizeEntity(
            id,
            name,
            isActive,
            createdAt,
        );
    }
}
