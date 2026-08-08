const DOCUMENT_TYPES = new Set(['0', '1', '4', '6', '7']);

function optionalText(value: unknown, maxLength: number): string | undefined {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text ? text.slice(0, maxLength) : undefined;
}

function validateDocument(type: string | undefined, number: string | undefined): string | undefined {
    if (!number) return undefined;
    if (!type) return 'Selecciona el tipo de documento';
    if (!DOCUMENT_TYPES.has(type)) return 'El tipo de documento no es valido';
    if (type === '1' && !/^\d{8}$/.test(number)) return 'El DNI debe tener 8 digitos';
    if (type === '6' && !/^\d{11}$/.test(number)) return 'El RUC debe tener 11 digitos';
    if (!/^[A-Za-z0-9-]{4,15}$/.test(number)) return 'El documento debe tener entre 4 y 15 caracteres validos';
    return undefined;
}

function validateEmail(email: string | undefined): string | undefined {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'El correo no es valido';
    return undefined;
}

export class ListCustomerDto {
    private constructor(
        public readonly page: number,
        public readonly limit: number,
        public readonly search?: string,
        public readonly isActive?: boolean,
    ) {}

    static create(input: Record<string, unknown>): [string | undefined, ListCustomerDto | undefined] {
        const page = Number(input.page ?? input.skip ?? 1);
        const limit = Number(input.limit ?? input.take ?? 50);
        if (!Number.isInteger(page) || page < 1) return ['page debe ser un entero mayor a 0', undefined];
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) return ['limit debe estar entre 1 y 200', undefined];

        let isActive: boolean | undefined;
        if (input.isActive !== undefined) {
            if (input.isActive === true || input.isActive === 'true') isActive = true;
            else if (input.isActive === false || input.isActive === 'false') isActive = false;
            else return ['isActive debe ser booleano', undefined];
        }
        return [undefined, new ListCustomerDto(page, limit, optionalText(input.search, 100), isActive)];
    }
}

export class SaveCustomerDto {
    private constructor(
        public readonly name: string,
        public readonly documentType: string | undefined,
        public readonly documentNumber: string | undefined,
        public readonly email: string | undefined,
        public readonly phone: string | undefined,
        public readonly address: string | undefined,
        public readonly isActive: boolean,
    ) {}

    static create(input: Record<string, unknown>): [string | undefined, SaveCustomerDto | undefined] {
        const name = String(input.name ?? '').trim();
        if (name.length < 2 || name.length > 160) return ['El nombre debe tener entre 2 y 160 caracteres', undefined];

        const documentNumber = optionalText(input.documentNumber, 15)?.toUpperCase();
        const documentType = documentNumber ? optionalText(input.documentType, 2) : undefined;
        const documentError = validateDocument(documentType, documentNumber);
        if (documentError) return [documentError, undefined];

        const email = optionalText(input.email, 160)?.toLowerCase();
        const emailError = validateEmail(email);
        if (emailError) return [emailError, undefined];

        const phone = optionalText(input.phone, 30);
        const address = optionalText(input.address, 250);
        const isActive = typeof input.isActive === 'boolean' ? input.isActive : true;
        return [undefined, new SaveCustomerDto(name, documentType, documentNumber, email, phone, address, isActive)];
    }
}
