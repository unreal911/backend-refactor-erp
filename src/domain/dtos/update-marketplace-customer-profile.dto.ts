export class UpdateMarketplaceCustomerProfileDto {
    private constructor(
        public readonly firstName?: string,
        public readonly lastName?: string,
        public readonly phone?: string,
        public readonly address?: string | null,
    ) {}

    static create(body: { [key: string]: unknown }): [string | undefined, UpdateMarketplaceCustomerProfileDto | undefined] {
        const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : undefined;
        const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : undefined;
        const phone = typeof body.phone === 'string' ? body.phone.trim() : undefined;
        const address = body.address === null
            ? null
            : (typeof body.address === 'string' ? body.address.trim() : undefined);

        if (
            firstName === undefined
            && lastName === undefined
            && phone === undefined
            && address === undefined
        ) {
            return ['Debes enviar al menos un campo para actualizar', undefined];
        }

        if (firstName !== undefined && !firstName) {
            return ['El nombre no puede estar vacio', undefined];
        }
        if (lastName !== undefined && !lastName) {
            return ['El apellido no puede estar vacio', undefined];
        }
        if (phone !== undefined && !phone) {
            return ['El telefono no puede estar vacio', undefined];
        }

        return [undefined, new UpdateMarketplaceCustomerProfileDto(firstName, lastName, phone, address)];
    }
}

