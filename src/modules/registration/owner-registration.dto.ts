type UnknownBody = { [key: string]: unknown };

function requestBody(value: unknown): UnknownBody {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as UnknownBody;
}

function normalizedText(value: unknown, maxLength: number): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!normalized || normalized.length > maxLength) return null;
    return normalized;
}

function normalizedEmail(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const email = value.normalize("NFKC").trim().toLowerCase();
    if (
        email.length < 3
        || email.length > 320
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        return null;
    }
    return email;
}

export class OwnerSignupDto {
    private constructor(
        public readonly firstName: string,
        public readonly lastName: string,
        public readonly email: string,
        public readonly password: string,
        public readonly businessName: string,
        public readonly termsAccepted: true,
    ) {}

    static create(value: unknown): [string | undefined, OwnerSignupDto | undefined] {
        const body = requestBody(value);
        const firstName = normalizedText(body.firstName, 100);
        const lastName = normalizedText(body.lastName, 100);
        const businessName = normalizedText(body.businessName, 120);
        const email = normalizedEmail(body.email);

        if (!firstName) return ["El nombre del propietario no es válido", undefined];
        if (!lastName) return ["El apellido del propietario no es válido", undefined];
        if (!businessName || businessName.length < 2) {
            return ["El nombre comercial no es válido", undefined];
        }
        if (!email) return ["El correo electrónico no es válido", undefined];
        if (typeof body.password !== "string") {
            return ["La contraseña es obligatoria", undefined];
        }
        if (body.password.length < 12 || Buffer.byteLength(body.password, "utf8") > 72) {
            return ["La contraseña debe tener al menos 12 caracteres y como máximo 72 bytes", undefined];
        }
        if (
            !/[a-z]/.test(body.password)
            || !/[A-Z]/.test(body.password)
            || !/[0-9]/.test(body.password)
            || !/[^A-Za-z0-9]/.test(body.password)
        ) {
            return [
                "La contraseña debe incluir mayúscula, minúscula, número y símbolo",
                undefined,
            ];
        }
        if (body.termsAccepted !== true) {
            return ["Debes aceptar los términos y la política de privacidad", undefined];
        }

        return [undefined, new OwnerSignupDto(
            firstName,
            lastName,
            email,
            body.password,
            businessName,
            true,
        )];
    }
}

export class VerifyOwnerEmailDto {
    private constructor(public readonly token: string) {}

    static create(value: unknown): [string | undefined, VerifyOwnerEmailDto | undefined] {
        const body = requestBody(value);
        if (
            typeof body.token !== "string"
            || body.token.length < 32
            || body.token.length > 256
            || !/^[A-Za-z0-9_-]+$/.test(body.token)
        ) {
            return ["El enlace de verificación es inválido o venció", undefined];
        }
        return [undefined, new VerifyOwnerEmailDto(body.token)];
    }
}
