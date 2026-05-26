export class SizeDto {
    private constructor(
        public readonly name: string,
        public readonly isActive: boolean,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, SizeDto | undefined] {
        const { name, isActive = true } = object;
        let isActiveValue: boolean = isActive;

        if (!name) {
            return ['el nombre de la talla es obligatorio', undefined];
        }
        if (typeof name !== 'string') {
            return ['La talla debe tener un nombre válido', undefined];
        }
        if (typeof isActive !== 'boolean') {
            isActiveValue = isActive === 'true';
        }
        return [undefined, new SizeDto(name, isActiveValue)];
    }
}
