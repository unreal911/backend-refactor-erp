import "dotenv/config";
import nodemailer from "nodemailer";
import {
    assertGmailSmtpTransport,
    assertSmtpAuthPair,
    normalizeSmtpPassword,
    normalizeSmtpUser,
} from "../config/smtp";

type Check = {
    label: string;
    ok: boolean;
    detail?: string;
};

function envValue(name: string): string {
    return String(process.env[name] ?? "").trim();
}

function boolEnv(name: string): boolean {
    return envValue(name).toLowerCase() === "true";
}

function positiveIntEnv(name: string, fallback: number): number {
    const parsed = Number(envValue(name) || fallback);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function addRequired(checks: Check[], name: string, value: string): void {
    checks.push({
        label: name,
        ok: value.length > 0,
        detail: value.length > 0 ? "configurado" : "faltante",
    });
}

function addFeatureSetting(
    checks: Check[],
    enabled: boolean,
    requiredName: string,
    value: string,
): void {
    if (!enabled) return;
    addRequired(checks, requiredName, value);
}

function addPepperCheck(checks: Check[], name: string, enabled: boolean): void {
    if (!enabled) return;
    const value = envValue(name);
    checks.push({
        label: name,
        ok: value.length >= 32,
        detail: value.length >= 32
            ? "longitud suficiente"
            : "debe tener al menos 32 caracteres",
    });
}

async function main(): Promise<void> {
    const validateOnly = process.argv.includes("--validate-only");
    const nodeEnv = envValue("NODE_ENV") || "development";
    const isProduction = nodeEnv === "production";
    const smtpHost = envValue("SMTP_HOST");
    const smtpPort = positiveIntEnv("SMTP_PORT", 587);
    const smtpSecure = boolEnv("SMTP_SECURE");
    const smtpUser = normalizeSmtpUser(envValue("SMTP_USER"));
    const rawSmtpPassword = String(process.env.SMTP_PASSWORD ?? "");
    const smtpPassword = normalizeSmtpPassword(smtpHost, rawSmtpPassword);
    const smtpFrom = envValue("SMTP_FROM");
    const checks: Check[] = [];

    checks.push({
        label: "OWNER_SIGNUP_ENABLED",
        ok: boolEnv("OWNER_SIGNUP_ENABLED"),
        detail: boolEnv("OWNER_SIGNUP_ENABLED")
            ? "registro habilitado"
            : "si queda false, /api/public/signup devuelve 503",
    });
    addRequired(checks, "OWNER_SIGNUP_TOKEN_PEPPER", envValue("OWNER_SIGNUP_TOKEN_PEPPER"));
    addRequired(checks, "OWNER_SIGNUP_ABUSE_PEPPER", envValue("OWNER_SIGNUP_ABUSE_PEPPER"));
    addRequired(checks, "OWNER_SIGNUP_VERIFY_URL", envValue("OWNER_SIGNUP_VERIFY_URL"));
    addRequired(checks, "OWNER_SIGNUP_TERMS_VERSION", envValue("OWNER_SIGNUP_TERMS_VERSION"));
    addRequired(checks, "TURNSTILE_SECRET_KEY", envValue("TURNSTILE_SECRET_KEY"));
    const ownerSignupEnabled = boolEnv("OWNER_SIGNUP_ENABLED");
    const invitationEnabled = boolEnv("TENANT_INVITATION_ENABLED");
    const passwordResetEnabled = boolEnv("PASSWORD_RESET_ENABLED");
    addFeatureSetting(
        checks,
        invitationEnabled,
        "TENANT_INVITATION_ACCEPT_URL",
        envValue("TENANT_INVITATION_ACCEPT_URL"),
    );
    addFeatureSetting(
        checks,
        passwordResetEnabled,
        "PASSWORD_RESET_URL",
        envValue("PASSWORD_RESET_URL"),
    );
    addPepperCheck(checks, "OWNER_SIGNUP_TOKEN_PEPPER", ownerSignupEnabled);
    addPepperCheck(checks, "OWNER_SIGNUP_ABUSE_PEPPER", ownerSignupEnabled);
    addPepperCheck(checks, "TENANT_INVITATION_TOKEN_PEPPER", invitationEnabled);
    addPepperCheck(checks, "PASSWORD_RESET_TOKEN_PEPPER", passwordResetEnabled);
    addRequired(checks, "SMTP_HOST", smtpHost);
    addRequired(checks, "SMTP_FROM", smtpFrom);

    checks.push({
        label: "SMTP_USER / SMTP_PASSWORD",
        ok: Boolean(smtpUser) === Boolean(smtpPassword),
        detail: smtpUser && smtpPassword
            ? `credenciales presentes, password normalizado len=${smtpPassword.length}`
            : "ambos vacios o ambos configurados",
    });

    if (smtpHost.toLowerCase() === "smtp.gmail.com") {
        const gmailPortOk = (smtpPort === 465 && smtpSecure) || (smtpPort === 587 && !smtpSecure);
        checks.push({
            label: "Gmail puerto/seguridad",
            ok: gmailPortOk,
            detail: gmailPortOk
                ? `SMTP_PORT=${smtpPort}, SMTP_SECURE=${smtpSecure}`
                : "usa 465 con SMTP_SECURE=true, o 587 con SMTP_SECURE=false",
        });
        checks.push({
            label: "Gmail app password",
            ok: smtpPassword.length === 16,
            detail: smtpPassword.length === 16
                ? "longitud esperada"
                : "debe ser la contraseña de aplicación de 16 caracteres, sin espacios",
        });
        checks.push({
            label: "SMTP_FROM Gmail",
            ok: smtpFrom.toLowerCase().includes(smtpUser.toLowerCase()),
            detail: "recomendado que SMTP_FROM use la misma cuenta de SMTP_USER",
        });
    }

    if (isProduction) {
        const verifyUrl = envValue("OWNER_SIGNUP_VERIFY_URL");
        checks.push({
            label: "OWNER_SIGNUP_VERIFY_URL HTTPS",
            ok: verifyUrl.startsWith("https://"),
            detail: "obligatorio en produccion",
        });
        addRequired(checks, "TURNSTILE_EXPECTED_HOSTNAMES", envValue("TURNSTILE_EXPECTED_HOSTNAMES"));
    }

    for (const check of checks) {
        const icon = check.ok ? "OK" : "ERROR";
        console.log(`[${icon}] ${check.label}${check.detail ? ` - ${check.detail}` : ""}`);
    }

    const failed = checks.filter((check) => !check.ok);
    if (failed.length > 0) {
        process.exitCode = 1;
        return;
    }
    assertSmtpAuthPair(smtpUser, smtpPassword);
    assertGmailSmtpTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        user: smtpUser,
        password: smtpPassword,
    });

    if (validateOnly) {
        console.log("[OK] Validacion completada sin probar conexion SMTP");
        return;
    }

    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: smtpUser && smtpPassword
            ? { user: smtpUser, pass: smtpPassword }
            : undefined,
    });

    await transporter.verify();
    console.log("[OK] Conexion SMTP verificada correctamente");
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ERROR] SMTP no verificado: ${message}`);
    process.exitCode = 1;
});
