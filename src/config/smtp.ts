export function normalizeSmtpPassword(host: string, password: string): string {
    const normalized = password.trim();
    if (host.trim().toLowerCase() === "smtp.gmail.com") {
        return normalized.replace(/\s+/g, "");
    }
    return normalized;
}

export function normalizeSmtpUser(user: string): string {
    return user.trim();
}

export function assertSmtpAuthPair(user: string, password: string): void {
    if (Boolean(user) !== Boolean(password)) {
        throw new Error("SMTP_USER y SMTP_PASSWORD deben configurarse juntos");
    }
}

export type SmtpTransportSettings = {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
};

/**
 * Gmail no acepta la contraseña normal de la cuenta para SMTP autenticado.
 * La contraseña de aplicación se muestra agrupada, por eso se normaliza antes
 * de llegar aquí y se valida solo su longitud efectiva.
 */
export function assertGmailSmtpTransport(settings: SmtpTransportSettings): void {
    if (settings.host.trim().toLowerCase() !== "smtp.gmail.com") return;

    if (!settings.user || !settings.password) {
        throw new Error(
            "Gmail SMTP requiere SMTP_USER y SMTP_PASSWORD con una contraseña de aplicación",
        );
    }

    const validTransport =
        (settings.port === 465 && settings.secure)
        || (settings.port === 587 && !settings.secure);
    if (!validTransport) {
        throw new Error(
            "Gmail SMTP requiere puerto 465 con SMTP_SECURE=true o puerto 587 con SMTP_SECURE=false",
        );
    }

    if (settings.user && settings.password.length !== 16) {
        throw new Error(
            "SMTP_PASSWORD para Gmail debe ser una contraseña de aplicación de 16 caracteres",
        );
    }
}
