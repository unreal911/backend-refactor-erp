export function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

export function amount(value: number): string {
    return value.toFixed(2);
}

// Valor/precio unitario admiten hasta 10 decimales; SUNAT usa habitualmente 2-6.
export function unitAmount(value: number): string {
    return value.toFixed(6);
}

export function qty(value: number): string {
    // Cantidad hasta 3 decimales sin ceros innecesarios.
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

// SUNAT exige declarar la codificacion. Usamos ISO-8859-1 para acentos/ enie.
export function xmlDecl(): string {
    return '<?xml version="1.0" encoding="ISO-8859-1" standalone="no"?>';
}

export function ymd(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function hms(date: Date): string {
    return date.toISOString().slice(11, 19);
}
