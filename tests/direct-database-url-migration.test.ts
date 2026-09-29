import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const validationScript = path.resolve(process.cwd(), "scripts/require-direct-database-url.mjs");

function runValidation(env: NodeJS.ProcessEnv) {
    return spawnSync(process.execPath, [validationScript], {
        cwd: process.cwd(),
        env,
        encoding: "utf8",
    });
}

describe("DIRECT_DATABASE_URL para migraciones", () => {
    it("la exige al ejecutar migraciones en producción", () => {
        const env = { ...process.env, NODE_ENV: "production" };
        delete env.DIRECT_DATABASE_URL;

        const result = runValidation(env);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("requiere DIRECT_DATABASE_URL");
    });

    it("permite migraciones de producción cuando está definida", () => {
        const result = runValidation({
            ...process.env,
            NODE_ENV: "production",
            DIRECT_DATABASE_URL: "postgresql://migration:test@db.internal:5432/app",
        });

        expect(result.status).toBe(0);
    });

    it("no la exige en desarrollo", () => {
        const env = { ...process.env, NODE_ENV: "development" };
        delete env.DIRECT_DATABASE_URL;

        const result = runValidation(env);

        expect(result.status).toBe(0);
    });
});
