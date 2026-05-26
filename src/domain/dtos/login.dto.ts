export class LoginDto {
    private constructor(
        public readonly email: string,
        public readonly password: string,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, LoginDto | undefined] {
        const { email, password } = object;

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

        return [undefined, new LoginDto(email, password)];
    }
}