import { sanitizeAuditValue } from "../audit-log/sanitize-audit-value";

export function redactOperationalText(value: string): string {
    if (value.trim().startsWith("<")) return "[REDACTED_XML]";
    return value
        .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_CONNECTION]")
        .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
        .replace(/(password|token|secret|authorization|clave|pfx|p12)\s*[=:]\s*\S+/gi, "$1=[REDACTED]")
        .slice(0, 1_000);
}

function redactStrings(value: unknown): unknown {
    if (typeof value === "string") return redactOperationalText(value);
    if (Array.isArray(value)) return value.map(redactStrings);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .map(([key, inner]) => [key, redactStrings(inner)]));
    }
    return value;
}

export function sanitizeOperationalValue(value: unknown): unknown {
    return sanitizeAuditValue(redactStrings(value));
}

export function operationalLog(
    level: "info" | "warn" | "error",
    event: string,
    context: Record<string, unknown> = {},
): void {
    const record = {
        timestamp: new Date().toISOString(),
        level,
        event: String(event || "OPERATIONAL_EVENT").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
        context: sanitizeOperationalValue(context),
    };
    const line = JSON.stringify(record);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
}
