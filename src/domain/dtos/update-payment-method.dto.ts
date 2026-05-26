export class UpdatePaymentMethodDto {
    private constructor(
        public readonly id: number,
        public readonly name?: string,
        public readonly isActive?: boolean,
    ) {}

    static create(object: { [key: string]: unknown }): [string | undefined, UpdatePaymentMethodDto | undefined] {
        const rawId = object.id;
        const rawName = object.name;
        const rawIsActive = object.isActive;

        const id = Number(rawId);
        if (!Number.isInteger(id) || id <= 0) {
            return ['El id del metodo de pago es invalido', undefined];
        }

        let name: string | undefined;
        if (rawName !== undefined) {
            if (typeof rawName !== 'string' || rawName.trim().length < 2) {
                return ['El nombre del metodo de pago no es valido', undefined];
            }
            name = rawName.trim();
        }

        let isActive: boolean | undefined;
        if (rawIsActive !== undefined) {
            if (typeof rawIsActive === 'boolean') {
                isActive = rawIsActive;
            } else if (typeof rawIsActive === 'string') {
                isActive = rawIsActive === 'true';
            } else {
                return ['isActive debe ser booleano', undefined];
            }
        }

        if (name === undefined && isActive === undefined) {
            return ['Debe enviar al menos name o isActive', undefined];
        }

        return [undefined, new UpdatePaymentMethodDto(id, name, isActive)];
    }
}
