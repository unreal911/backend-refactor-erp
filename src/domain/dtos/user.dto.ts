export class CreateUserDto {
    private constructor(
        public readonly firstName: string,
        public readonly lastName: string,
        public readonly email: string,
        public readonly password: string,
        public readonly roleId: number,
        public readonly isActive: boolean,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, CreateUserDto | undefined] {
        const { firstName, lastName, email, password, roleId, isActive = true } = object;

        if (!firstName || typeof firstName !== 'string') {
            return ['El nombre es obligatorio y debe ser una cadena', undefined];
        }
        if (!lastName || typeof lastName !== 'string') {
            return ['El apellido es obligatorio y debe ser una cadena', undefined];
        }
        if (!email || typeof email !== 'string') {
            return ['El correo electrónico es obligatorio y debe ser una cadena', undefined];
        }
        if (!password || typeof password !== 'string') {
            return ['La contraseña es obligatoria y debe ser una cadena', undefined];
        }
        if (!roleId || typeof roleId !== 'number') {
            return ['El ID del rol es obligatorio y debe ser un número', undefined];
        }
        if (typeof isActive !== 'boolean') {
            return ['El estado activo debe ser un booleano', undefined];
        }

        return [undefined, new CreateUserDto(firstName, lastName, email, password, roleId, isActive)];
    }
}

export class UpdateUserDto {
    private constructor(
        public readonly firstName?: string,
        public readonly lastName?: string,
        public readonly email?: string,
        public readonly roleId?: number,
        public readonly isActive?: boolean,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, UpdateUserDto | undefined] {
        const { firstName, lastName, email, roleId, isActive } = object;

        if (firstName !== undefined && typeof firstName !== 'string') {
            return ['El nombre debe ser una cadena', undefined];
        }
        if (lastName !== undefined && typeof lastName !== 'string') {
            return ['El apellido debe ser una cadena', undefined];
        }
        if (email !== undefined && typeof email !== 'string') {
            return ['El correo electrónico debe ser una cadena', undefined];
        }
        if (roleId !== undefined && typeof roleId !== 'number') {
            return ['El ID del rol debe ser un número', undefined];
        }
        if (isActive !== undefined && typeof isActive !== 'boolean') {
            return ['El estado activo debe ser un booleano', undefined];
        }

        return [undefined, new UpdateUserDto(firstName, lastName, email, roleId, isActive)];
    }
}