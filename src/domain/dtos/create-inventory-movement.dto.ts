import { InventoryMovementType } from "@prisma/client";

const validTypes: InventoryMovementType[] = [
    InventoryMovementType.IN,
    InventoryMovementType.OUT,
    InventoryMovementType.ADJUSTMENT,
    InventoryMovementType.TRANSFER_OUT,
    InventoryMovementType.TRANSFER_IN,
    InventoryMovementType.RESERVED,
    InventoryMovementType.UNRESERVED,
];

export class CreateInventoryMovementDto {
    private constructor(
        public readonly storeId: number,
        public readonly variantId: number,
        public readonly type: InventoryMovementType,
        public readonly quantity: number,
        public readonly note?: string,
        public readonly transferId?: number,
        public readonly reservationId?: number,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, CreateInventoryMovementDto | undefined] {
        const storeId = Number(object.storeId);
        const variantId = Number(object.variantId);
        const type = object.type as InventoryMovementType;
        const quantity = Number(object.quantity);
        const note = object.note ? String(object.note) : undefined;
        const transferId = object.transferId !== undefined ? Number(object.transferId) : undefined;
        const reservationId = object.reservationId !== undefined ? Number(object.reservationId) : undefined;

        if (!storeId || isNaN(storeId) || storeId <= 0) {
            return ['El ID de la tienda es obligatorio y debe ser un número válido', undefined];
        }
        if (!variantId || isNaN(variantId) || variantId <= 0) {
            return ['El ID de la variante es obligatorio y debe ser un número válido', undefined];
        }
        if (!type || !validTypes.includes(type)) {
            return ['El tipo de movimiento no es válido', undefined];
        }
        if (isNaN(quantity) || quantity === 0) {
            return ['La cantidad debe ser un número válido distinto de cero', undefined];
        }

        if (([
            InventoryMovementType.IN,
            InventoryMovementType.OUT,
            InventoryMovementType.TRANSFER_OUT,
            InventoryMovementType.TRANSFER_IN,
            InventoryMovementType.RESERVED,
            InventoryMovementType.UNRESERVED,
        ] as InventoryMovementType[]).includes(type) && quantity <= 0) {
            return ['La cantidad debe ser mayor a cero para este tipo de movimiento', undefined];
        }

        return [undefined, new CreateInventoryMovementDto(storeId, variantId, type, quantity, note, transferId, reservationId)];
    }
}
