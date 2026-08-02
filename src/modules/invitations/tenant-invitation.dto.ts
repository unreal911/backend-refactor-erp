import { TenantMembershipRole } from "@prisma/client";

type UnknownBody = { [key: string]: unknown };

function bodyOf(value: unknown): UnknownBody {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as UnknownBody;
}

function normalizeEmail(value: unknown): string | null {
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

function normalizeName(value: unknown): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") return undefined;
    const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    return normalized && normalized.length <= 100 ? normalized : undefined;
}

function normalizeToken(value: unknown): string | null {
    if (
        typeof value !== "string"
        || value.length < 32
        || value.length > 256
        || !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
        return null;
    }
    return value;
}

export function strongInvitationPasswordError(password: string): string | null {
    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
        return "La contrase\u00f1a debe tener al menos 12 caracteres y como m\u00e1ximo 72 bytes";
    }
    if (
        !/[a-z]/.test(password)
        || !/[A-Z]/.test(password)
        || !/[0-9]/.test(password)
        || !/[^A-Za-z0-9]/.test(password)
    ) {
        return "La contrase\u00f1a debe incluir may\u00fascula, min\u00fascula, n\u00famero y s\u00edmbolo";
    }
    return null;
}

const INVITABLE_ROLES = new Set<TenantMembershipRole>([
    TenantMembershipRole.ADMIN,
    TenantMembershipRole.SELLER,
    TenantMembershipRole.VIEWER,
]);

export class CreateTenantInvitationDto {
    private constructor(
        public readonly email: string,
        public readonly role: TenantMembershipRole,
    ) {}

    static create(value: unknown): [string | undefined, CreateTenantInvitationDto | undefined] {
        const body = bodyOf(value);
        const email = normalizeEmail(body.email);
        const role = String(body.role || "").trim().toUpperCase() as TenantMembershipRole;
        if (!email) return ["El correo electr\u00f3nico no es v\u00e1lido", undefined];
        if (!INVITABLE_ROLES.has(role)) {
            return ["El rol debe ser ADMIN, SELLER o VIEWER", undefined];
        }
        return [undefined, new CreateTenantInvitationDto(email, role)];
    }
}

export class InvitationTokenDto {
    private constructor(public readonly token: string) {}

    static create(value: unknown): [string | undefined, InvitationTokenDto | undefined] {
        const token = normalizeToken(bodyOf(value).token);
        if (!token) return ["La invitaci\u00f3n es inv\u00e1lida o venci\u00f3", undefined];
        return [undefined, new InvitationTokenDto(token)];
    }
}

export class AcceptTenantInvitationDto {
    private constructor(
        public readonly token: string,
        public readonly password: string,
        public readonly firstName?: string,
        public readonly lastName?: string,
    ) {}

    static create(value: unknown): [string | undefined, AcceptTenantInvitationDto | undefined] {
        const body = bodyOf(value);
        const token = normalizeToken(body.token);
        if (!token) return ["La invitaci\u00f3n es inv\u00e1lida o venci\u00f3", undefined];
        if (
            typeof body.password !== "string"
            || body.password.length < 1
            || Buffer.byteLength(body.password, "utf8") > 72
        ) {
            return ["La contrase\u00f1a es obligatoria y no puede superar 72 bytes", undefined];
        }

        const firstName = normalizeName(body.firstName);
        const lastName = normalizeName(body.lastName);
        if (body.firstName !== undefined && !firstName) {
            return ["El nombre no es v\u00e1lido", undefined];
        }
        if (body.lastName !== undefined && !lastName) {
            return ["El apellido no es v\u00e1lido", undefined];
        }

        return [undefined, new AcceptTenantInvitationDto(
            token,
            body.password,
            firstName,
            lastName,
        )];
    }
}
