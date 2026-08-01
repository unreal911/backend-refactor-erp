import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runStartupBootstraps } from "../bootstrap/startup";
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";
import {
    BackfillClosureReport,
    reconcileBackfillClosure,
} from "../modules/tenant/backfill-closure-reconciliation";

function markdown(report: BackfillClosureReport, jsonName: string): string {
    const coverage = report.coverage.map((row) =>
        `| ${row.storyId} | ${row.table} | ${row.sourceRows} | `
        + `${row.destinationRows} | ${row.postBaselineRows} |`
    ).join("\n");
    const sequences = report.sequences.map((row) =>
        `| ${row.table} | ${row.maximumId ?? "vacía"} | `
        + `${row.lastValue ?? "sin usar"} | ${row.nextValueSafe ? "sí" : "no"} |`
    ).join("\n");
    return `# Reporte de cierre MIG-011

- Generado: ${report.execution.completedAt}
- Duración: ${report.execution.durationMs} ms
- Tenant: \`${report.tenantId}\`
- JSON verificable: \`${jsonName}\`
- Huella final: \`${report.fingerprints.report}\`
- Resultado: **READY**

## Cobertura origen/destino

| Lote | Tabla | Origen | Destino | Filas posteriores |
|---|---|---:|---:|---:|
${coverage}

## Integridad

- Tablas tenant con \`tenantId NOT NULL\`: ${report.integrity.tenantTableCount}
- Tablas tenant indexadas: ${report.integrity.tenantIndexedTables}
- Restricciones no validadas: ${report.integrity.unvalidatedConstraints}
- Huérfanos: ${report.integrity.orphanRows}
- Relaciones cruzadas: ${report.integrity.crossTenantRows}
- Conflictos no explicados: ${report.conflicts.unexplainedChanges}

## Cuarentena aprobada

- Código: \`${report.quarantine.reasonCode}\`
- Origen: \`${report.quarantine.sourceTable}#${report.quarantine.sourceKey}\`
- Resolución: \`${report.quarantine.resolution}\`
- Detalles relacionados preservados: ${report.quarantine.relatedPickingDetails}
- Huella original: \`${report.quarantine.originalHash}\`

## Secuencias

| Tabla | Máximo | Posición | Próximo ID seguro |
|---|---:|---:|---|
${sequences}
`;
}

async function writeReport(report: BackfillClosureReport): Promise<string> {
    const reportDirectory = path.resolve(
        process.cwd(),
        "reports",
        "migration-closure",
    );
    await mkdir(reportDirectory, { recursive: true });
    const baseName = "mig-011-closure";
    const jsonName = `${baseName}.json`;
    const markdownName = `${baseName}.md`;
    await Promise.all([
        writeFile(
            path.join(reportDirectory, jsonName),
            `${JSON.stringify(report, null, 2)}\n`,
            "utf8",
        ),
        writeFile(
            path.join(reportDirectory, markdownName),
            markdown(report, jsonName),
            "utf8",
        ),
    ]);
    return path.join("reports", "migration-closure", markdownName);
}

async function main(): Promise<void> {
    await runStartupBootstraps(envs.DATABASE_URL);
    const report = await reconcileBackfillClosure();
    const reportPath = await writeReport(report);

    console.info("[backfill-close] READY");
    console.info(
        `[backfill-close] Lotes/tablas: `
        + `${report.prerequisites.length}/${report.coverage.length}`,
    );
    console.info(
        `[backfill-close] Tenant NOT NULL/indexadas: `
        + `${report.integrity.tenantTableCount}/`
        + report.integrity.tenantIndexedTables,
    );
    console.info(
        `[backfill-close] Secuencias seguras: `
        + `${report.sequences.filter((row) => row.nextValueSafe).length}/`
        + report.sequences.length,
    );
    console.info(
        `[backfill-close] Huérfanos/cruces/conflictos: `
        + `${report.integrity.orphanRows}/`
        + `${report.integrity.crossTenantRows}/`
        + report.conflicts.unexplainedChanges,
    );
    console.info(`[backfill-close] Reporte: ${reportPath}`);
    console.info("[backfill-close] Checkpoint MIG-011: COMPLETED");
}

main()
    .catch((error) => {
        console.error("[backfill-close] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
