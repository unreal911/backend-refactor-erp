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

export const envs = {
    NODE_ENV,
    IS_PRODUCTION: isProduction,
    PORT: env.get("PORT").default("3000").asPortNumber(),
    DATABASE_URL: env.get("DATABASE_URL").required().asString(),
    CLOUDINARY_CLOUD_NAME: env.get("CLOUDINARY_CLOUD_NAME").required().asString(),
    CLOUDINARY_API_KEY: env.get("CLOUDINARY_API_KEY").required().asString(),
    CLOUDINARY_API_SECRET: env.get("CLOUDINARY_API_SECRET").required().asString(),
    JWT_SECRET: env.get("JWT_SECRET").required().asString(),
    PUBLIC_PATH: env.get("PUBLIC_PATH").required().asString(),

    // Seed controls
    SEED_ENDPOINT_ENABLED: env.get("SEED_ENDPOINT_ENABLED").default(isProduction ? "false" : "true").asBool(),
    SEED_TRIGGER_KEY: env.get("SEED_TRIGGER_KEY").asString(),
    SEED_INCLUDE_DEMO_USERS: env.get("SEED_INCLUDE_DEMO_USERS").default(isProduction ? "false" : "true").asBool(),
    SEED_DEMO_PASSWORD: env.get("SEED_DEMO_PASSWORD").default("password123").asString(),
    SEED_ADMIN_EMAIL: env.get("SEED_ADMIN_EMAIL").asString(),
    SEED_ADMIN_PASSWORD: env.get("SEED_ADMIN_PASSWORD").asString(),
    SEED_ADMIN_FIRST_NAME: env.get("SEED_ADMIN_FIRST_NAME").default("Admin").asString(),
    SEED_ADMIN_LAST_NAME: env.get("SEED_ADMIN_LAST_NAME").default("Principal").asString(),
    SEED_ADMIN_RESET_PASSWORD: env.get("SEED_ADMIN_RESET_PASSWORD").default("false").asBool(),
};
