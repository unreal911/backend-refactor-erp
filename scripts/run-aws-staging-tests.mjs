import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitest = path.join(directory, "node_modules", "vitest", "vitest.mjs");
const required = ["AWS_REGION", "SUNAT_S3_BUCKET", "SUNAT_S3_KMS_KEY_ID", "SUNAT_KMS_KEY_ID"];
const missing = required.filter((name) => !String(process.env[name] ?? "").trim());
if (missing.length > 0) {
    console.error(`Faltan variables AWS staging: ${missing.join(", ")}`);
    process.exit(2);
}
if (process.env.CLOUD_MODE !== "aws") {
    console.error("CLOUD_MODE=aws es obligatorio para los contratos staging");
    process.exit(2);
}

const result = spawnSync(process.execPath, [vitest, "run", "tests/sunat-infrastructure-aws.test.ts"], {
    cwd: directory,
    env: { ...process.env, RUN_AWS_STAGING_TESTS: "true", NODE_ENV: "test" },
    stdio: "inherit",
});
process.exitCode = result.status ?? 1;
