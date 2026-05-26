export class GenerateVariantsDto {
    private constructor(
        public readonly colorIds: number[],
        public readonly sizeIds: number[],
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, GenerateVariantsDto | undefined] {
        const { colorIds = [], sizeIds = [] } = object;

        if (!Array.isArray(colorIds) || colorIds.length === 0) {
            return ['Debe seleccionar al menos un color', undefined];
        }

        if (!colorIds.every(id => typeof id === 'number' && id > 0)) {
            return ['Los IDs de colores deben ser números válidos', undefined];
        }

        if (!Array.isArray(sizeIds) || sizeIds.length === 0) {
            return ['Debe seleccionar al menos una talla', undefined];
        }

        if (!sizeIds.every(id => typeof id === 'number' && id > 0)) {
            return ['Los IDs de tallas deben ser números válidos', undefined];
        }

        return [undefined, new GenerateVariantsDto(colorIds, sizeIds)];
    }
}
