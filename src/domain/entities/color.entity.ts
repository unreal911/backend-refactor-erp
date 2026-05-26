import { CustomError } from "../errors/custom.error";

export class ColorEntity {
    constructor(
        public readonly id: number | string,
        public readonly name: string,
        public readonly hex?: string,
        public readonly isActive: boolean = true,
        public readonly createdAt: Date = new Date(),
    ) { }

    static fromObject(obj: any): ColorEntity {
        if (!obj) {
            throw new Error("Objeto invalido para crear un color");
        }

        const rawId = obj._id ?? obj.id;
        const id = typeof rawId === "number"
            ? rawId
            : rawId?.toString?.();

        if (id === undefined || id === null || id === "") {
            throw new Error("color es requerido");
        }

        const name = obj.name;
        if (!name) throw CustomError.badRequest("el nombre del color es requerido");

        const hex = obj.hex;
        const isActive = typeof obj.isActive === "boolean" ? obj.isActive : true;
        const createdAt = obj.createdAt ? new Date(obj.createdAt) : new Date();

        return new ColorEntity(
            id,
            name,
            hex,
            isActive,
            createdAt,
        );
    }
}