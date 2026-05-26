export class TrackMarketplaceOrderDto {
    private constructor(
        public readonly code: string,
        public readonly phone: string,
    ) {}

    static create(query: { [key: string]: unknown }): [string | undefined, TrackMarketplaceOrderDto | undefined] {
        const code = typeof query.code === 'string' ? query.code.trim().toUpperCase() : '';
        const phone = typeof query.phone === 'string' ? query.phone.trim() : '';

        if (!code) {
            return ['El codigo de pedido es obligatorio', undefined];
        }

        if (!phone) {
            return ['El telefono de validacion es obligatorio', undefined];
        }

        return [undefined, new TrackMarketplaceOrderDto(code, phone)];
    }
}

