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
    private constructor(public readonly email: string) {}

    static create(body: Record<string, unknown>): [string | undefined, PasswordResetRequestDto | undefined] {
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!email || email.length > 320 || !EMAIL_PATTERN.test(email)) {
            return ["Ingresa un correo válido", undefined];
        }
        return [undefined, new PasswordResetRequestDto(email)];
    }
}

export class PasswordResetConfirmDto {
    private constructor(
        public readonly token: string,
        public readonly password: string,
    ) {}

    static create(body: Record<string, unknown>): [string | undefined, PasswordResetConfirmDto | undefined] {
        const token = typeof body?.token === "string" ? body.token.trim() : "";
        if (!TOKEN_PATTERN.test(token)) {
            return ["El enlace de recuperación no es válido", undefined];
        }
        const passwordError = validateStrongPassword(body?.password);
        if (passwordError) return [passwordError, undefined];
        return [undefined, new PasswordResetConfirmDto(token, body.password as string)];
    }
}
