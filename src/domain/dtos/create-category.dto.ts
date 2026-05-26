export class CategoryDto {
    private constructor(
        public readonly name: string,
        public readonly isActive: boolean,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, CategoryDto | undefined] {
        const { name, isActive = true } = object;
        let isActiveValue: boolean = isActive;

        if (!name) {
            return ['el nombre de la categoria es obligatoria', undefined];
        }
        if (typeof name !== 'string') {
            return ['La categoría debe tener un nombre válido', undefined];
        }
        if (typeof isActive !== 'boolean') {
            isActiveValue = isActive === 'true';
        }

        return [undefined, new CategoryDto(name, isActiveValue)];
    }
}
