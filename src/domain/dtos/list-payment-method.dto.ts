export class ListPaymentMethodDto {
    private constructor(
        public readonly skip: number = 1,
        public readonly take: number = 50,
        public readonly isActive?: boolean,
        public readonly search?: string,
    ) {}

    static create(object: { [key: string]: unknown }): [string | undefined, ListPaymentMethodDto | undefined] {
        const rawSkip = object.skip;
        const rawTake = object.take;
        const rawIsActive = object.isActive;
        const rawSearch = object.search;

        const skip = rawSkip !== undefined ? Number(rawSkip) : 1;
        const take = rawTake !== undefined ? Number(rawTake) : 50;

        if (!Number.isInteger(skip) || skip < 1) {
            return ['skip debe ser un numero entero mayor a 0', undefined];
        }

        if (!Number.isInteger(take) || take < 1 || take > 200) {
            return ['take debe ser un numero entero entre 1 y 200', undefined];
        }

        let isActive: boolean | undefined;
        if (rawIsActive !== undefined) {
            if (typeof rawIsActive === 'boolean') {
                isActive = rawIsActive;
            } else if (typeof rawIsActive === 'string') {
                isActive = rawIsActive === 'true';
            } else {
                return ['isActive debe ser booleano', undefined];
            }
        }

        const search = typeof rawSearch === 'string' && rawSearch.trim().length > 0
            ? rawSearch.trim()
            : undefined;

        return [undefined, new ListPaymentMethodDto(skip, take, isActive, search)];
    }
}
