export class UpdateColorDto {
    private constructor(
        public readonly id: number,
        public readonly name?: string,
        public readonly hex?: string,
        public readonly isActive?: boolean,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, UpdateColorDto | undefined] {
        const { id, name, hex, isActive } = object;

        if (!id || typeof id !== 'number') {
            return ['El id es obligatorio y debe ser un número', undefined];
        }

        if (name && typeof name !== 'string') {
            return ['El nombre debe ser una cadena válida', undefined];
        }

        if (hex !== undefined && typeof hex !== 'string') {
            return ['El hex debe ser una cadena válida', undefined];
        }

        if (isActive !== undefined && typeof isActive !== 'boolean') {
            return ['isActive debe ser un booleano', undefined];
        }

        if (!name && hex === undefined && isActive === undefined) {
            return ['Debe proporcionar al menos un campo para actualizar (name, hex o isActive)', undefined];
        }

        return [undefined, new UpdateColorDto(id, name, hex, isActive)];
    }
}