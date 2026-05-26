export class RegisterMarketplaceCustomerDto {
    private constructor(
        public readonly firstName: string,
        public readonly lastName: string,
        public readonly email: string,
        public readonly phone: string,
        public readonly address: string | undefined,
        public readonly password: string,
    ) {}

    static create(body: { [key: string]: unknown }): [string | undefined, RegisterMarketplaceCustomerDto | undefined] {
        const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
        const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
        const address = typeof body.address === 'string' ? body.address.trim() : undefined;
        const password = typeof body.password === 'string' ? body.password : '';

        if (!firstName) return ['El nombre es obligatorio', undefined];
        if (!lastName) return ['El apellido es obligatorio', undefined];
        if (!email) return ['El email es obligatorio', undefined];
        if (!this.isValidEmail(email)) return ['El email no es valido', undefined];
        if (!phone) return ['El telefono es obligatorio', undefined];
        if (password.length < 6) return ['La contrasena debe tener al menos 6 caracteres', undefined];

        return [undefined, new RegisterMarketplaceCustomerDto(firstName, lastName, email, phone, address, password)];
    }

    private static isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
}
