export class UpdateOrderPickingDto {
    private constructor(
        public readonly orderId: number,
        public readonly items: Array<{
            variantId: number;
            pickedQuantity: number;
        }> = [],
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, UpdateOrderPickingDto | undefined] {
        const { orderId, items = [] } = object;

        // Validar pedido
        if (!orderId || typeof orderId !== 'number' || orderId < 1) {
            return ['El ID del pedido es obligatorio y debe ser un número válido', undefined];
        }

        // Validar items
        if (!Array.isArray(items) || items.length === 0) {
            return ['Debe proporcionar al menos un item para actualizar el picking', undefined];
        }

        for (const item of items) {
            if (!item.variantId || typeof item.variantId !== 'number' || item.variantId < 1) {
                return ['Cada item debe tener un variantId válido', undefined];
            }
            if (item.pickedQuantity === undefined || typeof item.pickedQuantity !== 'number' || item.pickedQuantity < 0) {
                return ['Cada item debe tener una cantidad pickeada válida', undefined];
            }
        }

        return [undefined, new UpdateOrderPickingDto(orderId, items)];
    }
}
