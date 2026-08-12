export class LoginDto {
    private constructor(
        public readonly email: string,
        public readonly password: string,
        public readonly tenantSlug?: string,
        public readonly mfaCode?: string,
        public readonly recoveryCode?: string,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, LoginDto | undefined] {
        const { email, password, tenantSlug, mfaCode, recoveryCode } = object;

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

        if (mfaCode !== undefined && typeof mfaCode !== 'string') return ['El código MFA no es válido', undefined];
        if (recoveryCode !== undefined && typeof recoveryCode !== 'string') return ['El código de recuperación no es válido', undefined];
        return [undefined, new LoginDto(
            email,
            password,
            normalizedTenantSlug || undefined,
            typeof mfaCode === 'string' ? mfaCode.trim() : undefined,
            typeof recoveryCode === 'string' ? recoveryCode.trim() : undefined,
        )];
    }
}
