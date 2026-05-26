export class ListSizeDto {
    private constructor(
        public readonly skip?: number,
        public readonly take?: number,
        public readonly isActive?: boolean,
    ) { }

    static create(skip?: number, take?: number, isActive?: boolean): [string | undefined, ListSizeDto | undefined] {
        if (skip !== undefined && (isNaN(skip) || skip < 1)) {
            return ['El número de página debe ser un número entero mayor a 0', undefined];
        }
        if (take !== undefined && (isNaN(take) || take < 1)) {
            return ['El número de elementos por página debe ser un número entero mayor a 0', undefined];
        }
        return [undefined, new ListSizeDto(skip, take, isActive)];
    }
}
