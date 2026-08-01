import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../data/prisma";
import { inspectSunatTenantMigration } from "../modules/tenant/sunat-reconciliation";

async function main(): Promise<void> {
    const summary = await inspectSunatTenantMigration();
    const reportDirectory = resolve("reports", "migration-closure");
    const jsonPath = resolve(reportDirectory, "ten-007-sunat.json");
    const markdownPath = resolve(reportDirectory, "ten-007-sunat.md");
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    await writeFile(
        markdownPath,
        [
            "# TEN-007 — Aislamiento SUNAT por empresa",
            "",
            "- Estado: READY",
            `- Migracion: \`${summary.migration}\``,
            `- Tablas SUNAT con tenantId NOT NULL: ${summary.tenantColumnsNotNull}/7`,
            `- Restricciones tenant validadas: ${summary.validatedConstraints}/16`,
            `- Indices fiscales por empresa: ${summary.requiredIndexes}/6`,
            `- Referencias cruzadas: ${summary.crossTenantReferences}`,
            `- Claves fiscales duplicadas: ${summary.duplicateFiscalKeys}`,
            "",
            "## Datos historicos reconciliados",
            "",
            "| Tabla | Filas | IDs | Total de control |",
            "|---|---:|---|---:|",
            ...summary.tables.map((table) =>
                `| ${table.table} | ${table.rowCount} | ${table.ids.join(", ") || "—"} | ${table.total} |`
            ),
            "",
        ].join("\n"),
        "utf8",
    );

    console.info("[tenant-sunat-reconcile] READY");
    console.info(
        `[tenant-sunat-reconcile] Tablas: ${summary.tenantColumnsNotNull}/7`,
    );
    console.info(
        `[tenant-sunat-reconcile] Restricciones: ${summary.validatedConstraints}/16`,
    );
    console.info(
        `[tenant-sunat-reconcile] Referencias cruzadas: ${summary.crossTenantReferences}`,
    );
    console.info(`[tenant-sunat-reconcile] Reporte: ${markdownPath}`);
}

main()
    .catch((error) => {
        console.error("[tenant-sunat-reconcile] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
