export interface StockTransferItemInput {
    variantId: number;
    quantity: number;
}

export class CreateStockTransferDto {
    private constructor(
        public readonly fromStoreId: number,
        public readonly toStoreId: number,
        public readonly items: StockTransferItemInput[],
        public readonly note?: string,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, CreateStockTransferDto | undefined] {
        const fromStoreId = Number(object.fromStoreId);
        const toStoreId = Number(object.toStoreId);
        const note = object.note ? String(object.note) : undefined;
        const items = Array.isArray(object.items) ? object.items.map((item) => ({
            variantId: Number(item.variantId),
            quantity: Number(item.quantity),
        })) : [];

        if (!fromStoreId || isNaN(fromStoreId) || fromStoreId <= 0) {
            return ['El ID de la tienda de origen es obligatorio y debe ser un número válido', undefined];
        }
        if (!toStoreId || isNaN(toStoreId) || toStoreId <= 0) {
            return ['El ID de la tienda de destino es obligatorio y debe ser un número válido', undefined];
        }
        if (fromStoreId === toStoreId) {
            return ['La tienda de origen y destino no pueden ser la misma', undefined];
        }
        if (!items.length) {
            return ['La transferencia debe incluir al menos un artículo', undefined];
        }

        for (const item of items) {
            if (!item.variantId || isNaN(item.variantId) || item.variantId <= 0) {
                return ['Cada artículo debe incluir un ID de variante válido', undefined];
            }
            if (isNaN(item.quantity) || item.quantity <= 0) {
                return ['Cada artículo debe incluir una cantidad mayor a cero', undefined];
            }
        }

        return [undefined, new CreateStockTransferDto(fromStoreId, toStoreId, items, note)];
    }
}
