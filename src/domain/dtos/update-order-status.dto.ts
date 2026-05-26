export enum OrderStatusEnum {
    PENDING = 'PENDING',
    CONFIRMED = 'CONFIRMED',
    WAITING_TRANSFER = 'WAITING_TRANSFER',
    PREPARING = 'PREPARING',
    READY = 'READY',
    DELIVERED = 'DELIVERED',
    RETURN_PENDING = 'RETURN_PENDING',
    CANCELLED = 'CANCELLED',
    WAITING_STOCK = 'WAITING_STOCK',
}

export const ORDER_STATUS_VALUES = Object.values(OrderStatusEnum) as OrderStatusEnum[];

export class UpdateOrderStatusDto {
    private constructor(
        public readonly status: OrderStatusEnum,
        public readonly note?: string,
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, UpdateOrderStatusDto | undefined] {
        const { status, note } = object;
        const normalizedStatus = typeof status === 'string' ? status.trim().toUpperCase() : '';

        if (!normalizedStatus) {
            return ['El estado es obligatorio y debe ser una cadena valida', undefined];
        }

        if (!ORDER_STATUS_VALUES.includes(normalizedStatus as OrderStatusEnum)) {
            return [
                `El estado debe ser uno de: ${ORDER_STATUS_VALUES.join(', ')}`,
                undefined,
            ];
        }

        const normalizedNote = typeof note === 'string' ? note.trim() : undefined;

        return [
            undefined,
            new UpdateOrderStatusDto(
                normalizedStatus as OrderStatusEnum,
                normalizedNote?.length ? normalizedNote : undefined,
            ),
        ];
    }
}
