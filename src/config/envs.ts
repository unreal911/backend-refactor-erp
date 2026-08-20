import "dotenv/config";
import env from "env-var";

type RuntimeEnvironment = "development" | "test" | "production";

function parseRuntimeEnvironment(): RuntimeEnvironment {
    const raw = env.get("NODE_ENV").default("development").asString().toLowerCase();
    if (raw === "production" || raw === "test" || raw === "development") {
        return raw;
    }
    return "development";
}

const NODE_ENV = parseRuntimeEnvironment();
const isProduction = NODE_ENV === "production";
const JWT_SECRET = env.get("JWT_SECRET").required().asString();

export const envs = {
    NODE_ENV,
    IS_PRODUCTION: isProduction,
    PORT: env.get("PORT").default("3000").asPortNumber(),
    DATABASE_URL: env.get("DATABASE_URL").required().asString(),
    CLOUDINARY_CLOUD_NAME: env.get("CLOUDINARY_CLOUD_NAME").required().asString(),
    CLOUDINARY_API_KEY: env.get("CLOUDINARY_API_KEY").required().asString(),
    CLOUDINARY_API_SECRET: env.get("CLOUDINARY_API_SECRET").required().asString(),
    JWT_SECRET,
    PLATFORM_MFA_REQUIRED: env.get("PLATFORM_MFA_REQUIRED").default(isProduction ? "true" : "false").asBool(),
    PLATFORM_MFA_ENC_KEY: env.get("PLATFORM_MFA_ENC_KEY").default("").asString(),
    PAYMENT_PROOF_ENC_KEY: env.get("PAYMENT_PROOF_ENC_KEY").default("").asString(),
    PLATFORM_MFA_ISSUER: env.get("PLATFORM_MFA_ISSUER").default("Tienda ERP Plataforma").asString(),
    PUBLIC_PATH: env.get("PUBLIC_PATH").required().asString(),

    // EMP-001: el registro queda cerrado hasta configurar entrega de correo.
    OWNER_SIGNUP_ENABLED: env.get("OWNER_SIGNUP_ENABLED").default("false").asBool(),
    OWNER_SIGNUP_TOKEN_PEPPER: env.get("OWNER_SIGNUP_TOKEN_PEPPER").default("").asString(),
    OWNER_SIGNUP_ABUSE_PEPPER: env.get("OWNER_SIGNUP_ABUSE_PEPPER").default("").asString(),
    OWNER_SIGNUP_VERIFY_URL: env.get("OWNER_SIGNUP_VERIFY_URL").default("").asString(),
    OWNER_SIGNUP_TERMS_VERSION: env.get("OWNER_SIGNUP_TERMS_VERSION").default("").asString(),
    OWNER_SIGNUP_TOKEN_TTL_MINUTES: env.get("OWNER_SIGNUP_TOKEN_TTL_MINUTES").default("30").asIntPositive(),
    OWNER_TRIAL_TOKEN_TTL_MINUTES: env.get("OWNER_TRIAL_TOKEN_TTL_MINUTES").default("1440").asIntPositive(),
    OWNER_SIGNUP_IP_LIMIT: env.get("OWNER_SIGNUP_IP_LIMIT").default("5").asIntPositive(),
    OWNER_SIGNUP_IP_WINDOW_MINUTES: env.get("OWNER_SIGNUP_IP_WINDOW_MINUTES").default("60").asIntPositive(),
    OWNER_SIGNUP_EMAIL_LIMIT: env.get("OWNER_SIGNUP_EMAIL_LIMIT").default("3").asIntPositive(),
    OWNER_SIGNUP_EMAIL_WINDOW_MINUTES: env.get("OWNER_SIGNUP_EMAIL_WINDOW_MINUTES").default("1440").asIntPositive(),
    OWNER_SIGNUP_DEVICE_LIMIT: env.get("OWNER_SIGNUP_DEVICE_LIMIT").default("3").asIntPositive(),
    OWNER_SIGNUP_DEVICE_WINDOW_MINUTES: env.get("OWNER_SIGNUP_DEVICE_WINDOW_MINUTES").default("1440").asIntPositive(),
    TURNSTILE_SECRET_KEY: env.get("TURNSTILE_SECRET_KEY").default("").asString(),
    TURNSTILE_EXPECTED_HOSTNAMES: env.get("TURNSTILE_EXPECTED_HOSTNAMES").default("").asString(),
    TURNSTILE_EXPECTED_ACTION: env.get("TURNSTILE_EXPECTED_ACTION").default("owner_signup").asString(),
    TURNSTILE_TIMEOUT_MS: env.get("TURNSTILE_TIMEOUT_MS").default("5000").asIntPositive(),
    SMTP_HOST: env.get("SMTP_HOST").default("").asString(),
    SMTP_PORT: env.get("SMTP_PORT").default("587").asPortNumber(),
    SMTP_SECURE: env.get("SMTP_SECURE").default("false").asBool(),
    SMTP_USER: env.get("SMTP_USER").default("").asString(),
    SMTP_PASSWORD: env.get("SMTP_PASSWORD").default("").asString(),
    SMTP_FROM: env.get("SMTP_FROM").default("").asString(),

    // Recuperación de contraseña del panel administrativo.
    PASSWORD_RESET_ENABLED: env.get("PASSWORD_RESET_ENABLED").default("false").asBool(),
    PASSWORD_RESET_TOKEN_PEPPER: env.get("PASSWORD_RESET_TOKEN_PEPPER").default("").asString(),
    PASSWORD_RESET_URL: env.get("PASSWORD_RESET_URL").default("").asString(),
    PASSWORD_RESET_TTL_MINUTES: env.get("PASSWORD_RESET_TTL_MINUTES").default("30").asIntPositive(),
    PASSWORD_RESET_COOLDOWN_SECONDS: env.get("PASSWORD_RESET_COOLDOWN_SECONDS").default("60").asIntPositive(),

    // EMP-005: invitaciones tenant por correo, cerradas hasta configurar SMTP.
    TENANT_INVITATION_ENABLED: env.get("TENANT_INVITATION_ENABLED").default("false").asBool(),
    TENANT_INVITATION_TOKEN_PEPPER: env.get("TENANT_INVITATION_TOKEN_PEPPER").default("").asString(),
    TENANT_INVITATION_ACCEPT_URL: env.get("TENANT_INVITATION_ACCEPT_URL").default("").asString(),
    TENANT_INVITATION_TTL_HOURS: env.get("TENANT_INVITATION_TTL_HOURS").default("72").asIntPositive(),

    // BIL-001: webhook genérico firmado para el proveedor de pagos elegido.
    BILLING_WEBHOOK_ENABLED: env.get("BILLING_WEBHOOK_ENABLED").default("false").asBool(),
    BILLING_WEBHOOK_SECRET: env.get("BILLING_WEBHOOK_SECRET").default("").asString(),
    TRIAL_EXPORT_URL: env.get("TRIAL_EXPORT_URL").default("").asString(),

    // Allowlist de origenes para CORS (coma-separado). Vacio = permitir todos
    // (comportamiento actual); definirlo en produccion para restringir.
    CORS_ORIGINS: env.get("CORS_ORIGINS").default("").asString(),
    REALTIME_REDIS_URL: env.get("REALTIME_REDIS_URL").default("").asString(),
    API_INSTANCE_COUNT: env.get("API_INSTANCE_COUNT").default("1").asIntPositive(),

    // Seed controls
    SEED_ENDPOINT_ENABLED: env.get("SEED_ENDPOINT_ENABLED").default(isProduction ? "false" : "true").asBool(),
    SEED_TRIGGER_KEY: env.get("SEED_TRIGGER_KEY").asString(),
    SEED_INCLUDE_DEMO_USERS: env.get("SEED_INCLUDE_DEMO_USERS").default(isProduction ? "false" : "true").asBool(),
    SEED_INCLUDE_PRODUCTS: env.get("SEED_INCLUDE_PRODUCTS").default(isProduction ? "false" : "true").asBool(),
    SEED_DEMO_PASSWORD: env.get("SEED_DEMO_PASSWORD").default("password123").asString(),
    SEED_ADMIN_EMAIL: env.get("SEED_ADMIN_EMAIL").asString(),
    SEED_ADMIN_PASSWORD: env.get("SEED_ADMIN_PASSWORD").asString(),
    SEED_ADMIN_FIRST_NAME: env.get("SEED_ADMIN_FIRST_NAME").default("Admin").asString(),
    SEED_ADMIN_LAST_NAME: env.get("SEED_ADMIN_LAST_NAME").default("Principal").asString(),
    SEED_ADMIN_RESET_PASSWORD: env.get("SEED_ADMIN_RESET_PASSWORD").default("false").asBool(),

    // Clave maestra para cifrar secretos SUNAT (Clave SOL, .pfx) en la BD.
    // Opcional: sin ella el emisor cae al fallback de env (solo BETA).
    SUNAT_CONFIG_ENC_KEY: env.get("SUNAT_CONFIG_ENC_KEY").default("").asString(),
};
