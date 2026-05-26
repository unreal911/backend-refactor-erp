export class CreateStoreDto {
    private constructor(
        public readonly name: string,
        public readonly code: string,
        public readonly type: 'STORE' | 'WAREHOUSE',
        public readonly address?: string,
        public readonly isActive: boolean = true,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, CreateStoreDto | undefined] {
        const { name, code, type, address, isActive = true } = object;
        let isActiveValue: boolean = isActive;
        let typeValue: 'STORE' | 'WAREHOUSE' = 'STORE';

        if (!name) {
            return ['El nombre de la tienda es obligatorio', undefined];
        }
        if (typeof name !== 'string') {
            return ['El nombre de la tienda debe ser una cadena válida', undefined];
        }

        if (!code) {
            return ['El código de la tienda es obligatorio', undefined];
        }
        if (typeof code !== 'string') {
            return ['El código de la tienda debe ser una cadena válida', undefined];
        }

        if (!type) {
            return ['El tipo de tienda es obligatorio', undefined];
        }
        if (typeof type !== 'string') {
            return ['El tipo de tienda debe ser una cadena válida', undefined];
        }

        const normalizedType = type.toUpperCase();
        if (normalizedType !== 'STORE' && normalizedType !== 'WAREHOUSE') {
            return ['El tipo de tienda debe ser STORE o WAREHOUSE', undefined];
        }
        typeValue = normalizedType as 'STORE' | 'WAREHOUSE';

        if (typeof isActive !== 'boolean') {
            isActiveValue = isActive === 'true';
        }

        if (address !== undefined && typeof address !== 'string') {
            return ['La dirección debe ser una cadena válida', undefined];
        }

        return [undefined, new CreateStoreDto(name.trim(), code.trim(), typeValue, address?.trim(), isActiveValue)];
    }
}
