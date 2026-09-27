import { normalizePeruPhone } from "../../shared/phone";

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

export const normalizeOwnerPhone = normalizePeruPhone;

export class OwnerSignupDto {
    private constructor(
        public readonly firstName: string,
        public readonly lastName: string,
        public readonly email: string | null,
        public readonly phone: string | null,
        public readonly password: string,
        public readonly businessName: string,
        public readonly termsAccepted: true,
    ) {}

    static create(
        value: unknown,
        options: { emailEnabled?: boolean; whatsappEnabled?: boolean } = {},
    ): [string | undefined, OwnerSignupDto | undefined] {
        const body = requestBody(value);
        const emailEnabled = options.emailEnabled ?? true;
        const whatsappEnabled = options.whatsappEnabled ?? true;
        const firstName = normalizedText(body.firstName, 100);
        const lastName = normalizedText(body.lastName, 100);
        const businessName = normalizedText(body.businessName, 120);
        const email = normalizedEmail(body.email);
        const phone = normalizeOwnerPhone(body.phone);

        if (!firstName) return ["El nombre del propietario no es válido", undefined];
        if (!lastName) return ["El apellido del propietario no es válido", undefined];
        if (!businessName || businessName.length < 2) {
            return ["El nombre comercial no es válido", undefined];
        }
        if (email && phone) return ["Elige correo o WhatsApp, no ambos", undefined];
        if (!email && !phone) {
            return [emailEnabled
                ? "Ingresa un correo o un número de WhatsApp válido"
                : "El número de WhatsApp es obligatorio", undefined];
        }
        if (email && !emailEnabled) return ["El registro por correo está deshabilitado", undefined];
        if (phone && !whatsappEnabled) return ["El registro por WhatsApp está deshabilitado", undefined];
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
            phone,
            body.password,
            businessName,
            true,
        )];
    }
}

export class VerifyOwnerEmailDto {
    private constructor(
        public readonly token: string,
        public readonly identifier: string | null,
    ) {}

    static create(value: unknown): [string | undefined, VerifyOwnerEmailDto | undefined] {
        const body = requestBody(value);
        const token = typeof body.token === "string" ? body.token.trim() : "";
        if (/^\d{6}$/.test(token)) {
            const identifier = normalizeOwnerPhone(body.identifier);
            if (!identifier) {
                return ["Ingresa el número de WhatsApp que recibió el código", undefined];
            }
            return [undefined, new VerifyOwnerEmailDto(token, identifier)];
        }
        if (token.length < 32 || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)) {
            return ["La credencial de verificación es inválida o venció", undefined];
        }
        return [undefined, new VerifyOwnerEmailDto(token, null)];
    }
}
