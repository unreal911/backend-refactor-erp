const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 30;
const MAX_OBJECT_KEYS = 40;
const MAX_STRING_LENGTH = 500;

const REDACTED_KEY_PATTERNS = [
    "password",
    "token",
    "secret",
    "authorization",
    "cookie",
    "apikey",
    "api_key",
    "access",
    "refresh",
    "card",
    "cvv",
    "p12",
    "pfx",
    "cert",
    "email",
    "phone",
    "telefono",
    "address",
    "direccion",
    "document",
    "dni",
    "ruc",
];

function isRedactedKey(key: string): boolean {
    const normalized = key.trim().toLowerCase();
    return REDACTED_KEY_PATTERNS.some(
        (pattern) => normalized.includes(pattern),
    );
}

export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
    if (value === undefined || value === null) return null;
    if (depth >= MAX_DEPTH) return "[depth-limited]";
    if (typeof value === "string") {
        return value.length > MAX_STRING_LENGTH
            ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`
            : value;
    }
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return Number(value);
    if (Array.isArray(value)) {
        return value
            .slice(0, MAX_ARRAY_ITEMS)
            .map((item) => sanitizeAuditValue(item, depth + 1));
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") {
        const sanitized: Record<string, unknown> = {};
        for (const [key, innerValue] of Object.entries(
            value as Record<string, unknown>,
        ).slice(0, MAX_OBJECT_KEYS)) {
            sanitized[key] = isRedactedKey(key)
                ? "[redacted]"
                : sanitizeAuditValue(innerValue, depth + 1);
        }
        return sanitized;
    }
    return String(value);
}
