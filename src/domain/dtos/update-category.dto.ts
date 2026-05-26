export class UpdateCategoryDto {
    private constructor(
        public readonly id: number,
        public readonly name?: string,
        public readonly isActive?: boolean,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, UpdateCategoryDto | undefined] {
        const { id, name, isActive } = object;

        if (!id || typeof id !== 'number') {
            return ['El id es obligatorio y debe ser un número', undefined];
        }

        if (name && typeof name !== 'string') {
            return ['El nombre debe ser una cadena válida', undefined];
        }

        if (isActive !== undefined && typeof isActive !== 'boolean') {
            return ['isActive debe ser un booleano', undefined];
        }

        if (!name && isActive === undefined) {
            return ['Debe proporcionar al menos un campo para actualizar (name o isActive)', undefined];
        }

        return [undefined, new UpdateCategoryDto(id, name, isActive)];
    }
}
