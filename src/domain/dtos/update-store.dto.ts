export class UpdateStoreDto {
    private constructor(
        public readonly name?: string,
        public readonly code?: string,
        public readonly type?: 'STORE' | 'WAREHOUSE',
        public readonly address?: string,
        public readonly isActive?: boolean,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, UpdateStoreDto | undefined] {
        const { name, code, type, address, isActive } = object;
        let typeValue: 'STORE' | 'WAREHOUSE' | undefined = undefined;
        let isActiveValue: boolean | undefined = undefined;

        if (name !== undefined && typeof name !== 'string') {
            return ['El nombre de la tienda debe ser una cadena válida', undefined];
        }

        if (code !== undefined && typeof code !== 'string') {
            return ['El código de la tienda debe ser una cadena válida', undefined];
        }

        if (type !== undefined) {
            if (typeof type !== 'string') {
                return ['El tipo de tienda debe ser una cadena válida', undefined];
            }
            const normalizedType = type.toUpperCase();
            if (normalizedType !== 'STORE' && normalizedType !== 'WAREHOUSE') {
                return ['El tipo de tienda debe ser STORE o WAREHOUSE', undefined];
            }
            typeValue = normalizedType as 'STORE' | 'WAREHOUSE';
        }

        if (address !== undefined && typeof address !== 'string') {
            return ['La dirección debe ser una cadena válida', undefined];
        }

        if (isActive !== undefined) {
            if (typeof isActive !== 'boolean') {
                isActiveValue = isActive === 'true';
            } else {
                isActiveValue = isActive;
            }
        }

        return [undefined, new UpdateStoreDto(name?.trim(), code?.trim(), typeValue, address?.trim(), isActiveValue)];
    }
}
