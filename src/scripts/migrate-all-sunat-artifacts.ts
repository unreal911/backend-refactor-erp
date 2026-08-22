import path from "node:path";
import { spawnSync } from "node:child_process";
import { platformPrisma } from "../data/platform-prisma";

type BatchResult = {
    rows: number;
    artifacts: number;
    failures: Array<{ source: string; id: number; code: string }>;
    nextAfterId: number;
};

const SOURCES = ["DISPATCH", "RESUMEN", "BAJA"] as const;

function positiveBatch(): number {
    const raw = process.env.SUNAT_ARTIFACT_MIGRATION_BATCH ?? "100";
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 500) {
        throw new Error("SUNAT_ARTIFACT_MIGRATION_BATCH debe estar entre 1 y 500");
    }
    return value;
}

function parseResult(stdout: string): BatchResult {
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const value = JSON.parse(lines.at(-1) ?? "{}") as Partial<BatchResult>;
    if (
        !Number.isInteger(value.rows)
        || !Number.isInteger(value.artifacts)
        || !Number.isInteger(value.nextAfterId)
        || !Array.isArray(value.failures)
    ) {
        throw new Error("El migrador SUNAT no devolvio un checkpoint valido");
    }
    return value as BatchResult;
}

async function main(): Promise<void> {
    const batch = positiveBatch();
    const tenants = await platformPrisma.tenant.findMany({
        where: {
            status: { not: "PURGED" },
            OR: [
                {
                    sunatDispatches: {
                        some: {
                            OR: [
                                { xmlBase64: { not: null } },
                                { cdrZipBase64: { not: null } },
                                { rawResponseXml: { not: null } },
                            ],
                        },
                    },
                },
                {
                    resumenesDiarios: {
                        some: {
                            OR: [
                                { xmlBase64: { not: null } },
                                { cdrZipBase64: { not: null } },
                                { rawResponseXml: { not: null } },
                            ],
                        },
                    },
                },
                {
                    comunicacionesBaja: {
                        some: {
                            OR: [
                                { xmlBase64: { not: null } },
                                { cdrZipBase64: { not: null } },
                                { rawResponseXml: { not: null } },
                            ],
                        },
                    },
                },
            ],
        },
        select: { id: true },
        orderBy: { id: "asc" },
    });
    const tsxCli = require.resolve("tsx/cli");
    const migrationScript = path.resolve(__dirname, "migrate-sunat-artifacts.ts");
    let rows = 0;
    let artifacts = 0;

    for (const tenant of tenants) {
        for (const source of SOURCES) {
            let afterId = 0;
            do {
                const result = spawnSync(process.execPath, [
                    tsxCli,
                    migrationScript,
                    "--tenant", tenant.id,
                    "--source", source,
                    "--batch", String(batch),
                    "--after-id", String(afterId),
                ], {
                    cwd: process.cwd(),
                    env: process.env,
                    encoding: "utf8",
                    timeout: 20 * 60 * 1000,
                });
                if (result.status !== 0) {
                    const safeError = String(result.stderr || result.stdout || result.error?.message || "")
                        .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_CONNECTION]")
                        .slice(-2000);
                    throw new Error(`Migracion ${tenant.id}/${source} fallo: ${safeError}`);
                }
                const checkpoint = parseResult(String(result.stdout || ""));
                rows += checkpoint.rows;
                artifacts += checkpoint.artifacts;
                if (checkpoint.failures.length > 0) {
                    throw new Error(`${tenant.id}/${source} dejo ${checkpoint.failures.length} filas en cuarentena`);
                }
                if (checkpoint.rows === 0) break;
                if (checkpoint.nextAfterId <= afterId) {
                    throw new Error(`El cursor ${tenant.id}/${source} no avanzo`);
                }
                afterId = checkpoint.nextAfterId;
            } while (true);
        }
    }
    console.log(JSON.stringify({ tenants: tenants.length, sources: SOURCES.length, rows, artifacts, status: "VERIFIED" }));
}

void main()
    .catch((caught) => {
        console.error("[sunat-artifact-migration-all]", caught instanceof Error ? caught.message : "migration failed");
        process.exitCode = 1;
    })
    .finally(() => platformPrisma.$disconnect());
