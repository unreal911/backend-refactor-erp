import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(scriptsDirectory, "..");
const vitestEntry = path.join(backendDirectory, "node_modules", "vitest", "vitest.mjs");

const result = spawnSync(
    process.execPath,
    [vitestEntry, "run", "tests/sunat-infrastructure-moto.test.ts"],
    {
        cwd: backendDirectory,
        env: {
            ...process.env,
            RUN_MOTO_TESTS: "true",
            NODE_ENV: "test",
            CLOUD_MODE: "moto",
            AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL || "http://127.0.0.1:5000",
            AWS_REGION: process.env.AWS_REGION || "us-east-1",
            AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || "test",
            AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || "test",
            SUNAT_S3_BUCKET: process.env.SUNAT_S3_BUCKET || "sunat-dev",
            SUNAT_KMS_KEY_ID: process.env.SUNAT_KMS_KEY_ID || "alias/sunat-dev",
            S3_FORCE_PATH_STYLE: "true",
        },
        stdio: "inherit",
    },
);

if (result.error) {
    console.error(result.error);
    process.exitCode = 1;
} else {
    process.exitCode = result.status ?? 1;
}
