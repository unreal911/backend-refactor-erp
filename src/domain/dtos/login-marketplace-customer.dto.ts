export class LoginMarketplaceCustomerDto {
    private constructor(
        public readonly email: string,
        public readonly password: string,
    ) {}

    static create(body: { [key: string]: unknown }): [string | undefined, LoginMarketplaceCustomerDto | undefined] {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';

        if (!email) return ['El email es obligatorio', undefined];
        if (!password) return ['La contrasena es obligatoria', undefined];

        return [undefined, new LoginMarketplaceCustomerDto(email, password)];
    }
}

