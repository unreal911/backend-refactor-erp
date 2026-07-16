export class CreateOrderDto {
    private constructor(
        public readonly sourceStoreId: number,
        public readonly fulfillmentStoreId?: number,
        public readonly sellerUserId?: number,
        public readonly applyIgv?: boolean,
        public readonly clientName?: string,
        public readonly clientEmail?: string,
        public readonly clientPhone?: string,
        public readonly clienteTipoDoc?: string,
        public readonly clienteNumDoc?: string,
        public readonly comprobanteTipo?: 'BOLETA' | 'FACTURA',
        public readonly items: Array<{
            variantId: number;
            quantity: number;
            unitPrice: number;
            fulfillmentStoreId?: number;
        }> = [],
        public readonly note?: string,
        public readonly idempotencyKey?: string,
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, CreateOrderDto | undefined] {
        const {
            sourceStoreId,
            fulfillmentStoreId,
            sellerUserId,
            applyIgv,
            clientName,
            clientEmail,
            clientPhone,
            clienteTipoDoc,
            clienteNumDoc,
            comprobanteTipo,
            items = [],
            note,
            idempotencyKey,
        } = object;

        // Validar tienda origen
        if (!sourceStoreId || typeof sourceStoreId !== 'number' || sourceStoreId < 1) {
            return ['La tienda origen es obligatoria y debe ser un nÃºmero vÃ¡lido', undefined];
        }

        // Validar items
        if (!Array.isArray(items) || items.length === 0) {
            return ['El pedido debe contener al menos un item', undefined];
        }

        for (const item of items) {
            if (!item.variantId || typeof item.variantId !== 'number' || item.variantId < 1) {
                return ['Cada item debe tener un variantId vÃ¡lido', undefined];
            }
            if (!item.quantity || typeof item.quantity !== 'number' || item.quantity < 1) {
                return ['Cada item debe tener una cantidad vÃ¡lida mayor a 0', undefined];
            }
            if (item.unitPrice === undefined || typeof item.unitPrice !== 'number' || item.unitPrice < 0) {
                return ['Cada item debe tener un precio vÃ¡lido', undefined];
            }
            if (item.fulfillmentStoreId !== undefined && item.fulfillmentStoreId !== null) {
                if (typeof item.fulfillmentStoreId !== 'number' || item.fulfillmentStoreId < 1) {
                    return ['La tienda de fulfillment de cada item debe ser un numero valido', undefined];
                }
            }
        }

        // Validar email si se proporciona
        if (clientEmail && !this.isValidEmail(clientEmail)) {
            return ['El email del cliente no es valido', undefined];
        }

        if (applyIgv !== undefined && typeof applyIgv !== 'boolean') {
            return ['applyIgv debe ser booleano', undefined];
        }

        // Documento del adquirente (opcional; requerido solo al emitir factura).
        const tipoDoc = typeof clienteTipoDoc === 'string' ? clienteTipoDoc.trim() : undefined;
        const numDoc = typeof clienteNumDoc === 'string' ? clienteNumDoc.trim() : undefined;
        if (numDoc && !/^\d{8,11}$/.test(numDoc)) {
            return ['El documento del cliente debe tener entre 8 y 11 digitos', undefined];
        }

        // Comprobante electronico solicitado (opcional). Otros valores (NOTA, etc.) => sin comprobante.
        const compRaw = typeof comprobanteTipo === 'string' ? comprobanteTipo.trim().toUpperCase() : undefined;
        const comprobante = compRaw === 'BOLETA' || compRaw === 'FACTURA' ? compRaw : undefined;
        if (comprobante === 'FACTURA') {
            if (tipoDoc !== '6' || !numDoc || !/^\d{11}$/.test(numDoc)) {
                return ['La factura requiere RUC valido (11 digitos) del adquirente', undefined];
            }
            const nombre = typeof clientName === 'string' ? clientName.trim() : '';
            if (!nombre) {
                return ['La factura requiere razon social del adquirente', undefined];
            }
        }

        // Clave de idempotencia opcional (string acotado). Si no es valida se ignora.
        const idempoRaw = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : undefined;
        const idempo = idempoRaw && idempoRaw.length > 0 && idempoRaw.length <= 100 ? idempoRaw : undefined;

        return [undefined, new CreateOrderDto(
            sourceStoreId,
            fulfillmentStoreId,
            sellerUserId,
            applyIgv,
            clientName,
            clientEmail,
            clientPhone,
            tipoDoc,
            numDoc,
            comprobante,
            items,
            note,
            idempo,
        )];
    }

    private static isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
}

