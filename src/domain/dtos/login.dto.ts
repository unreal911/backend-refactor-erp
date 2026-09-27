export class LoginDto {
    private constructor(
        public readonly email: string,
        public readonly password: string,
        public readonly tenantSlug?: string,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, LoginDto | undefined] {
        const email = object.identifier ?? object.email ?? object.phone;
        const { password, tenantSlug } = object;

        if (!email) {
            return ['El correo o número de teléfono es obligatorio', undefined];
        }
        if (typeof email !== 'string') {
            return ['El correo o número de teléfono debe ser una cadena de texto', undefined];
        }
        if (!password) {
            return ['La contraseña es obligatoria', undefined];
        }
        if (typeof password !== 'string') {
            return ['La contraseña debe ser una cadena de texto', undefined];
        }
        if (tenantSlug !== undefined && typeof tenantSlug !== 'string') {
            return ['La empresa debe ser una cadena de texto', undefined];
        }

        const normalizedTenantSlug = typeof tenantSlug === 'string'
            ? tenantSlug.trim().toLowerCase()
            : undefined;
        if (
            normalizedTenantSlug
            && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedTenantSlug)
        ) {
            return ['La empresa seleccionada no es válida', undefined];
        }

        const normalizedIdentifier = email.includes('@')
            ? email.trim().toLowerCase()
            : (() => {
                let phone = email.normalize('NFKC').trim().replace(/[\s().-]/g, '').replace(/^00/, '+');
                if (/^9\d{8}$/.test(phone)) phone = `+51${phone}`;
                if (/^51\d{9}$/.test(phone)) phone = `+${phone}`;
                return phone;
            })();

        return [undefined, new LoginDto(
            normalizedIdentifier,
            password,
            normalizedTenantSlug || undefined,
        )];
    }
}
