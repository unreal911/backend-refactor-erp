export class ListProductDto {
    private constructor(
        public readonly skip: number,
        public readonly take: number,
        public readonly search?: string,
        public readonly isActive?: boolean,
    ) { }

    static create(
        skip: number = 1,
        take: number = 10,
        search?: string,
        isActive?: boolean,
    ): [string | undefined, ListProductDto | undefined] {
        if (isNaN(skip) || skip < 1) {
            return ['El número de página debe ser un número entero mayor a 0', undefined];
        }
        if (isNaN(take) || take < 1) {
            return ['El número de elementos por página debe ser un número entero mayor a 0', undefined];
        }

        if (search && typeof search !== 'string') {
            return ['La búsqueda debe ser una cadena válida', undefined];
        }

        return [undefined, new ListProductDto(skip, take, search?.trim(), isActive)];
    }
}
