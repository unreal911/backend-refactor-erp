export class PublicListProductDto {
    private constructor(
        public readonly skip: number,
        public readonly take: number,
        public readonly search?: string,
        public readonly categoryId?: number,
        public readonly colorId?: number,
        public readonly sizeId?: number,
        public readonly inStock?: boolean,
        public readonly allowBackorder?: boolean,
    ) {}

    static create(query: { [key: string]: unknown }): [string | undefined, PublicListProductDto | undefined] {
        const skip = Number(query.skip ?? 1);
        const take = Number(query.take ?? 24);
        const search = typeof query.search === 'string' ? query.search.trim() : undefined;
        const categoryId = query.categoryId !== undefined ? Number(query.categoryId) : undefined;
        const colorId = query.colorId !== undefined ? Number(query.colorId) : undefined;
        const sizeId = query.sizeId !== undefined ? Number(query.sizeId) : undefined;
        const inStock = this.parseBoolean(query.inStock);
        const allowBackorder = this.parseBoolean(query.allowBackorder);

        if (!Number.isInteger(skip) || skip < 1) {
            return ['El parametro skip debe ser un numero entero mayor a 0', undefined];
        }

        if (!Number.isInteger(take) || take < 1 || take > 200) {
            return ['El parametro take debe ser un numero entero entre 1 y 200', undefined];
        }

        if (categoryId !== undefined && (!Number.isInteger(categoryId) || categoryId < 1)) {
            return ['El categoryId debe ser un numero valido', undefined];
        }

        if (colorId !== undefined && (!Number.isInteger(colorId) || colorId < 1)) {
            return ['El colorId debe ser un numero valido', undefined];
        }

        if (sizeId !== undefined && (!Number.isInteger(sizeId) || sizeId < 1)) {
            return ['El sizeId debe ser un numero valido', undefined];
        }

        return [
            undefined,
            new PublicListProductDto(
                skip,
                take,
                search,
                categoryId,
                colorId,
                sizeId,
                inStock,
                allowBackorder,
            ),
        ];
    }

    private static parseBoolean(value: unknown): boolean | undefined {
        if (value === undefined || value === null || value === '') {
            return undefined;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value !== 'string') {
            return undefined;
        }
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') {
            return true;
        }
        if (normalized === 'false' || normalized === '0') {
            return false;
        }
        return undefined;
    }
}

