export class ListStoreDto {
    private constructor(
        public readonly skip: number,
        public readonly take: number,
        public readonly search?: string,
        public readonly type?: 'STORE' | 'WAREHOUSE',
        public readonly includeInactive?: boolean,
    ) { }

    static create(
        skip: number = 1,
        take: number = 10,
        search?: string,
        type?: string,
        includeInactive?: boolean,
    ): [string | undefined, ListStoreDto | undefined] {
        if (isNaN(skip) || skip < 1) {
            return ['El número de página debe ser un número entero mayor a 0', undefined];
        }
        if (isNaN(take) || take < 1) {
            return ['El número de elementos por página debe ser un número entero mayor a 0', undefined];
        }

        if (search !== undefined && typeof search !== 'string') {
            return ['La búsqueda debe ser una cadena válida', undefined];
        }

        let typeValue: 'STORE' | 'WAREHOUSE' | undefined;
        if (type !== undefined && type !== null && type !== '') {
            if (typeof type !== 'string') {
                return ['El tipo de tienda debe ser una cadena válida', undefined];
            }
            const normalizedType = type.toUpperCase();
            if (normalizedType !== 'STORE' && normalizedType !== 'WAREHOUSE') {
                return ['El tipo de tienda debe ser STORE o WAREHOUSE', undefined];
            }
            typeValue = normalizedType as 'STORE' | 'WAREHOUSE';
        }

        return [undefined, new ListStoreDto(skip, take, search?.trim(), typeValue, includeInactive)];
    }
}
