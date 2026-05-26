export class ListCategoryDto {
    private constructor(
        public readonly skip: number,
        public readonly take: number,
        public readonly isActive?: boolean,
    ) { }
    static create(skip: number = 1, take: number = 10, isActive?: boolean): [string | undefined, ListCategoryDto | undefined] {
        if (isNaN(skip) || skip < 1) {
            return ['El número de página debe ser un número entero mayor a 0', undefined];
        }
        if (isNaN(take) || take < 1) {
            return ['El número de elementos por página debe ser un número entero mayor a 0', undefined];
        }
        return [undefined, new ListCategoryDto(skip, take, isActive)];
    }
}