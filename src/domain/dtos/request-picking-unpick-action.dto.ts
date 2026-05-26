export class RequestPickingUnpickActionDto {
    private constructor(
        public readonly quantity: number,
        public readonly note?: string,
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, RequestPickingUnpickActionDto | undefined] {
        const parsedQuantity = typeof object?.quantity === 'string'
            ? Number(object.quantity.trim())
            : Number(object?.quantity);
        const note = typeof object?.note === 'string' ? object.note.trim() : undefined;

        if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
            return ['La cantidad solicitada debe ser un numero entero mayor a 0', undefined];
        }

        return [
            undefined,
            new RequestPickingUnpickActionDto(
                parsedQuantity,
                note || undefined,
            ),
        ];
    }
}

