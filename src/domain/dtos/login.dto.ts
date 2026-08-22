export class LoginDto {
    private constructor(
        public readonly email: string,
        public readonly password: string,
        public readonly tenantSlug?: string,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, LoginDto | undefined] {
        const { email, password, tenantSlug } = object;

        if (!email) {
            return ['El correo electrónico es obligatorio', undefined];
        }
        if (typeof email !== 'string') {
            return ['El correo electrónico debe ser una cadena de texto', undefined];
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

        return [undefined, new LoginDto(
            email,
            password,
            normalizedTenantSlug || undefined,
        )];
    }
}
