import { normalizePeruPhone } from "../../shared/phone";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/;

export function validateStrongPassword(password: unknown): string | undefined {
    if (typeof password !== "string") return "La nueva contraseña es obligatoria";
    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
        return "La contraseña debe tener al menos 12 caracteres y como máximo 72 bytes";
    }
    if (
        !/[a-z]/.test(password)
        || !/[A-Z]/.test(password)
        || !/[0-9]/.test(password)
        || !/[^A-Za-z0-9]/.test(password)
    ) {
        return "La contraseña debe incluir mayúscula, minúscula, número y símbolo";
    }
    return undefined;
}

export class PasswordResetRequestDto {
    private constructor(
        public readonly identifier: string,
        public readonly channel: "email" | "whatsapp",
    ) {}

    static create(body: Record<string, unknown>): [string | undefined, PasswordResetRequestDto | undefined] {
        const identifier = typeof body?.identifier === "string"
            ? body.identifier
            : typeof body?.email === "string" ? body.email : "";
        const normalized = identifier.normalize("NFKC").trim();
        if (!normalized) return ["Ingresa un correo o número de WhatsApp válido", undefined];
        if (normalized.includes("@")) {
            const email = normalized.toLowerCase();
            if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
                return ["Ingresa un correo válido", undefined];
            }
            return [undefined, new PasswordResetRequestDto(email, "email")];
        }
        const phone = normalizePeruPhone(normalized);
        if (!phone) return ["Ingresa un correo o número de WhatsApp válido", undefined];
        return [undefined, new PasswordResetRequestDto(phone, "whatsapp")];
    }
}

export class PasswordResetConfirmDto {
    private constructor(
        public readonly token: string,
        public readonly password: string,
        public readonly identifier: string | null,
    ) {}

    static create(body: Record<string, unknown>): [string | undefined, PasswordResetConfirmDto | undefined] {
        const token = typeof body?.token === "string" ? body.token.trim() : "";
        let identifier: string | null = null;
        if (/^\d{6}$/.test(token)) {
            identifier = normalizePeruPhone(body?.identifier);
            if (!identifier) {
                return ["Ingresa el número de WhatsApp que recibió el código", undefined];
            }
        } else if (!TOKEN_PATTERN.test(token)) {
            return ["La credencial de recuperación no es válida", undefined];
        }
        const passwordError = validateStrongPassword(body?.password);
        if (passwordError) return [passwordError, undefined];
        return [undefined, new PasswordResetConfirmDto(token, body.password as string, identifier)];
    }
}
