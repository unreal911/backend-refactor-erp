export class ListMarketplaceOrdersDto {
    private constructor(
        public readonly phone: string,
        public readonly email?: string,
        public readonly take: number = 20,
    ) {}

    static create(query: { [key: string]: unknown }): [string | undefined, ListMarketplaceOrdersDto | undefined] {
        const phone = typeof query.phone === 'string' ? query.phone.trim() : '';
        const email = typeof query.email === 'string' ? query.email.trim() : undefined;
        const takeRaw = query.take;
        const take = takeRaw !== undefined ? Number(takeRaw) : 20;

        if (!phone) {
            return ['El telefono es obligatorio', undefined];
        }

        if (email && !this.isValidEmail(email)) {
            return ['El email no es valido', undefined];
        }

        if (!Number.isInteger(take) || take < 1 || take > 50) {
            return ['take debe ser un numero entero entre 1 y 50', undefined];
        }

        return [undefined, new ListMarketplaceOrdersDto(phone, email, take)];
    }

    private static isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
}

