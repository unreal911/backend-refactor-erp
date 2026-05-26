export type MarketplaceDeliveryType = 'PICKUP' | 'DELIVERY';

export class CreateMarketplaceOrderDto {
    private constructor(
        public readonly sourceStoreId: number,
        public readonly deliveryType: MarketplaceDeliveryType,
        public readonly clientName: string,
        public readonly clientPhone: string,
        public readonly clientEmail: string | undefined,
        public readonly companyName: string | undefined,
        public readonly ruc: string | undefined,
        public readonly pickupStoreId: number | undefined,
        public readonly deliveryAddress: string | undefined,
        public readonly deliveryReference: string | undefined,
        public readonly paymentMethodId: number | undefined,
        public readonly note: string | undefined,
        public readonly items: Array<{
            variantId: number;
            quantity: number;
            unitPrice?: number;
            colorName?: string;
            sizeName?: string;
            displayVariantId?: number;
        }>,
    ) {}

    static create(payload: { [key: string]: unknown }): [string | undefined, CreateMarketplaceOrderDto | undefined] {
        const sourceStoreId = Number(payload.sourceStoreId);
        const deliveryTypeRaw = typeof payload.deliveryType === 'string' ? payload.deliveryType.trim().toUpperCase() : 'PICKUP';
        const deliveryType = deliveryTypeRaw === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
        const clientName = typeof payload.clientName === 'string' ? payload.clientName.trim() : '';
        const clientPhone = typeof payload.clientPhone === 'string' ? payload.clientPhone.trim() : '';
        const clientEmail = typeof payload.clientEmail === 'string' ? payload.clientEmail.trim() : undefined;
        const companyName = typeof payload.companyName === 'string' ? payload.companyName.trim() : undefined;
        const ruc = typeof payload.ruc === 'string' ? payload.ruc.trim() : undefined;
        const pickupStoreId = payload.pickupStoreId !== undefined && payload.pickupStoreId !== null
            ? Number(payload.pickupStoreId)
            : undefined;
        const deliveryAddress = typeof payload.deliveryAddress === 'string' ? payload.deliveryAddress.trim() : undefined;
        const deliveryReference = typeof payload.deliveryReference === 'string' ? payload.deliveryReference.trim() : undefined;
        const paymentMethodId = payload.paymentMethodId !== undefined && payload.paymentMethodId !== null
            ? Number(payload.paymentMethodId)
            : undefined;
        const note = typeof payload.note === 'string' ? payload.note.trim() : undefined;
        const items = Array.isArray(payload.items) ? payload.items : [];

        if (!Number.isInteger(sourceStoreId) || sourceStoreId < 1) {
            return ['La tienda origen es obligatoria', undefined];
        }

        if (!clientName) {
            return ['El nombre del cliente es obligatorio', undefined];
        }

        if (!clientPhone) {
            return ['El telefono del cliente es obligatorio', undefined];
        }

        if (clientEmail && !this.isValidEmail(clientEmail)) {
            return ['El email del cliente no es valido', undefined];
        }

        if (deliveryType === 'DELIVERY' && !deliveryAddress) {
            return ['La direccion es obligatoria para delivery', undefined];
        }

        if (deliveryType === 'PICKUP' && pickupStoreId !== undefined && (!Number.isInteger(pickupStoreId) || pickupStoreId < 1)) {
            return ['La tienda de recojo no es valida', undefined];
        }
        if (paymentMethodId !== undefined && (!Number.isInteger(paymentMethodId) || paymentMethodId < 1)) {
            return ['El metodo de pago no es valido', undefined];
        }

        if (items.length === 0) {
            return ['El pedido debe incluir al menos una variante', undefined];
        }

        const normalizedItems: Array<{
            variantId: number;
            quantity: number;
            unitPrice?: number;
            colorName?: string;
            sizeName?: string;
            displayVariantId?: number;
        }> = [];
        for (const item of items) {
            const rawItem = item as { [key: string]: unknown };
            const variantId = Number(rawItem.variantId);
            const quantity = Number(rawItem.quantity);
            const unitPrice = rawItem.unitPrice !== undefined ? Number(rawItem.unitPrice) : undefined;
            const colorName = typeof rawItem.colorName === 'string' ? rawItem.colorName.trim() : undefined;
            const sizeName = typeof rawItem.sizeName === 'string' ? rawItem.sizeName.trim() : undefined;
            const displayVariantId = rawItem.displayVariantId !== undefined
                ? Number(rawItem.displayVariantId)
                : undefined;

            if (!Number.isInteger(variantId) || variantId < 1) {
                return ['Cada item debe incluir variantId valido', undefined];
            }
            if (!Number.isInteger(quantity) || quantity < 1) {
                return ['Cada item debe incluir quantity mayor a 0', undefined];
            }
            if (unitPrice !== undefined && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
                return ['unitPrice no es valido', undefined];
            }

            const normalizedItem: {
                variantId: number;
                quantity: number;
                unitPrice?: number;
                colorName?: string;
                sizeName?: string;
                displayVariantId?: number;
            } = {
                variantId,
                quantity,
            };
            if (unitPrice !== undefined) {
                normalizedItem.unitPrice = unitPrice;
            }
            if (colorName) {
                normalizedItem.colorName = colorName;
            }
            if (sizeName) {
                normalizedItem.sizeName = sizeName;
            }
            if (displayVariantId !== undefined && Number.isInteger(displayVariantId) && displayVariantId > 0) {
                normalizedItem.displayVariantId = displayVariantId;
            }

            normalizedItems.push(normalizedItem);
        }

        return [
            undefined,
            new CreateMarketplaceOrderDto(
                sourceStoreId,
                deliveryType,
                clientName,
                clientPhone,
                clientEmail,
                companyName,
                ruc,
                pickupStoreId,
                deliveryAddress,
                deliveryReference,
                paymentMethodId,
                note,
                normalizedItems,
            ),
        ];
    }

    private static isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
}
