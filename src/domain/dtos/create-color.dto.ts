export class ColorDto {
    private constructor(
        public readonly name: string,
        public readonly isActive: boolean,
        public readonly hex?: string,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, ColorDto | undefined] {
        const { name, hex, isActive = true } = object;
        let isActiveValue: boolean = isActive;

        if (!name) {
            return ['el nombre del color es obligatorio', undefined];
        }
        if (typeof name !== 'string') {
            return ['El color debe tener un nombre válido', undefined];
        }
        if (hex && typeof hex !== 'string') {
            return ['El hex debe ser una cadena válida', undefined];
        }
        if (typeof isActive !== 'boolean') {
            isActiveValue = isActive === 'true';
        }
        return [undefined, new ColorDto(name, isActiveValue, hex)];
    }
}