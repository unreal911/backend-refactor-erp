export class CreateReservationDto {
    private constructor(
        public readonly inventoryId: number,
        public readonly quantity: number,
        public readonly orderId?: number,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, CreateReservationDto | undefined] {
        const inventoryId = Number(object.inventoryId);
        const quantity = Number(object.quantity);
        const orderId = object.orderId !== undefined ? Number(object.orderId) : undefined;

        if (!inventoryId || isNaN(inventoryId) || inventoryId <= 0) {
            return ['El ID de inventario es obligatorio y debe ser un número válido', undefined];
        }
        if (isNaN(quantity) || quantity <= 0) {
            return ['La cantidad a reservar debe ser mayor a cero', undefined];
        }
        if (orderId !== undefined && (isNaN(orderId) || orderId <= 0)) {
            return ['El ID de la orden debe ser un número válido', undefined];
        }

        return [undefined, new CreateReservationDto(inventoryId, quantity, orderId)];
    }
}
