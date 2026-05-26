export class CreateRoleDto {
    private constructor(
        public readonly name: string,
        public readonly description?: string,
        public readonly isActive: boolean = true,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, CreateRoleDto | undefined] {
        const { name, description, isActive } = object;

        if (!name || typeof name !== 'string') {
            return ['El nombre del rol es obligatorio y debe ser una cadena', undefined];
        }

        if (description !== undefined && typeof description !== 'string') {
            return ['La descripción del rol debe ser una cadena', undefined];
        }

        if (isActive !== undefined && typeof isActive !== 'boolean') {
            return ['El estado del rol debe ser booleano', undefined];
        }

        return [undefined, new CreateRoleDto(name, description, isActive ?? true)];
    }
}

export class UpdateRoleDto {
    private constructor(
        public readonly name?: string,
        public readonly description?: string,
        public readonly isActive?: boolean,
    ) { }

    static create(object: { [key: string]: any }): [string | undefined, UpdateRoleDto | undefined] {
        const { name, description, isActive } = object;

        if (name !== undefined && typeof name !== 'string') {
            return ['El nombre del rol debe ser una cadena', undefined];
        }

        if (description !== undefined && typeof description !== 'string') {
            return ['La descripción del rol debe ser una cadena', undefined];
        }

        if (isActive !== undefined && typeof isActive !== 'boolean') {
            return ['El estado del rol debe ser booleano', undefined];
        }

        return [undefined, new UpdateRoleDto(name, description, isActive)];
    }
}
