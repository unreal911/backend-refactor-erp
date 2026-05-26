export class CreatePaymentMethodDto {
    private constructor(
        public readonly name: string,
        public readonly code?: string,
        public readonly isActive: boolean = true,
    ) {}

    static create(object: { [key: string]: unknown }): [string | undefined, CreatePaymentMethodDto | undefined] {
        const rawName = object.name;
        const rawCode = object.code;
        const rawIsActive = object.isActive;

        if (typeof rawName !== 'string' || rawName.trim().length < 2) {
            return ['El nombre del metodo de pago es obligatorio', undefined];
        }

        let isActive = true;
        if (typeof rawIsActive === 'boolean') {
            isActive = rawIsActive;
        } else if (typeof rawIsActive === 'string') {
            isActive = rawIsActive === 'true';
        }

        const code = typeof rawCode === 'string' && rawCode.trim().length > 0
            ? rawCode.trim().toUpperCase()
            : undefined;

        return [undefined, new CreatePaymentMethodDto(rawName.trim(), code, isActive)];
    }
}
